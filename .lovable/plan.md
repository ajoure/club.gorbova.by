Да, согласен, с учетом правок:

1. content_month валидировать CHECK-условием формата YYYY-MM.
2. Бэкфилл orders_[v2.meta.deal](http://v2.meta.deal)_month делать только для status='paid', без перезаписи существующего значения.
3. Для slug DDMMYYYY обязательно валидировать реальную дату, а не только regex.
4. В audit_logs не писать на каждый просмотр карточки, иначе будет шум. Логировать только на серверном access-check/resolve, с дедупом по user_id + content_id + month + day.

&nbsp;

1. grant-access-for-order не должен менять старые paid orders; только новые заказы получают deal_month при создании/fulfillment.
2. Перед execute нужен dry-run:
  - сколько уроков получат content_month;
  - сколько live_events получат metadata.content_month;
  - сколько paid orders получат deal_month;
  - сколько правил уже имеют match_purchase_month=true.

Можно выполнять после этих уточнений.

&nbsp;

# План: Помесячная привязка контента к сделкам клуба «Бизнес»

## Бизнес-формулировка

У контента (уроки/модули/вебинары) появляется поле **«Месяц контента»** в формате `YYYY-MM`. У сделки в `orders_v2` появляется **«Месяц сделки»** (`meta.deal_month`). Контент виден пользователю только если:

1. Подписка/право на продукт+тариф активна (как сейчас).
2. **И** у пользователя есть paid-сделка по тому же тарифу с `deal_month == content.content_month` (если правило доступа явно требует этой проверки).

Платный «докуп» пропущенного месяца — отдельная задача в будущем.

## Что переиспользуем (НИЧЕГО НЕ ДУБЛИРУЕМ)


| Сущность             | Где живёт                                                                         | Как используем                                                                                  |
| -------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Сделка               | `orders_v2.meta.deal_month` (новое поле в `meta`)                                 | Источник «месяца сделки»                                                                        |
| Дефолт месяца сделки | существующий `deal_date` / `created_at`                                           | Для бэкфилла и автозаполнения                                                                   |
| Контент              | `training_lessons`, `training_modules`, `live_events`                             | Добавляем `content_month` (text `YYYY-MM`)                                                      |
| Правила доступа      | существующее `access_rules.conditions jsonb` + аналог в `live_event_access_rules` | Добавляем флаг `match_purchase_month: true`                                                     |
| UI редактор правил   | `ProductAccessRulesTab.tsx`, `LiveEventAccessRulesEditor.tsx`                     | Один Switch                                                                                     |
| Резолвер             | `live-resolve/index.ts`, `_shared/access-resolver.ts`                             | Новый month-gate                                                                                |
| Канон prior-purchase | `_shared/check-prior-purchase.ts`                                                 | Создаём sibling `check-month-purchase.ts` (тот же контракт, фильтр по `deal_month + tariff_id`) |
| UI редактор сделки   | `EditDealDialog.tsx`                                                              | Поле «Месяц сделки»                                                                             |


## Модель данных

### 1. `orders_v2.meta.deal_month`

- Формат `YYYY-MM`, Europe/Minsk.
- Дефолт: `to_char((coalesce(deal_date::timestamptz, created_at) at time zone 'Europe/Minsk'),'YYYY-MM')`.
- Helper `_shared/deal-month.ts` → `resolveDealMonth(order)`. Используется в `grant-access-for-order` и админских insert/update сделок.

### 2. `training_lessons.content_month`, `training_modules.content_month` (text, nullable)

### 3. `live_events.metadata.content_month` (без новой колонки)

### 4. `live_event_access_rules.conditions jsonb not null default '{}'` (новая колонка)

### 5. `access_rules.conditions.match_purchase_month: boolean` (поле в существующем jsonb)

## Бэкфилл «месяца контента» из slug

**Точное состояние БД** (проверено):

- `training_lessons` — всего 396; **ровно 9 строк** имеют slug формата `DDMMYYYY` (`01022025`, `01032025`, …, `01122025`). Это и есть «вебинары-тренинги» бизнес-клуба.
- Других числовых форматов slug (`DDMMYY`, `YYYY-MM…`) — 0.

**Правило бэкфилла (один SQL в миграции):**

```sql
update public.training_lessons
set content_month = substring(slug from 5 for 4) || '-' || substring(slug from 3 for 2)
where content_month is null
  and slug ~ '^[0-3][0-9][0-1][0-9][0-9]{4}$';
```

Это даст:

- `01022025` → `2025-02` (Февраль 2025)
- `01032025` → `2025-03`
- … `01122025` → `2025-12`

Дополнительный бэкфилл (для остальных, если позже появятся): `content_month = to_char(coalesce(published_at, created_at) at time zone 'Europe/Minsk','YYYY-MM')` — **только** для уроков, попавших под правило с `match_purchase_month` (запускается отдельным скриптом по требованию админа, не автоматически, чтобы не «помечать месяцами» весь курсный контент).

Для `live_events` (если есть клубные вебинары как `live_events`):

```sql
update public.live_events
set metadata = coalesce(metadata,'{}'::jsonb)
  || jsonb_build_object('content_month',
       to_char(scheduled_at at time zone 'Europe/Minsk','YYYY-MM'))
where (metadata->>'content_month') is null
  and scheduled_at is not null
  and event_type in ('live_webinar','recorded_webinar','autowebinar');
```

**Бэкфилл `orders_v2.meta.deal_month**` — одной миграцией для всех `status='paid'`, где поле ещё не задано (см. предыдущую итерацию плана).

После миграции — **proof**: SELECT с группировкой `content_month, count(*)` по 9 уроков, чтобы админ глазами проверил соответствие.

## Резолвер — единый helper

Новый `_shared/check-month-purchase.ts` (близнец `check-prior-purchase.ts`):

```
checkMonthPurchase(supabase, userId, tariffId, month) -> { found, order_id }
```

Запрос: `orders_v2 where user_id=? and tariff_id=? and status='paid' and meta->>'deal_month' = ? limit 1`.

Подключение:

- `live-resolve/index.ts` — после прохождения `productOk`, если `rule.conditions.match_purchase_month === true`, читаем `event.metadata.content_month` и зовём helper. Без совпадения → `productOk=false`.
- `access-resolver.ts` — то же для `grant_target_type='training_content'`: берём `content_month` целевого урока/модуля.

Поведение по умолчанию (без флага в правиле) **не меняется** — старые правила продолжают работать.

## UI

### A. Новый компонент `src/components/ui/MonthYearPicker.tsx`

Один Popover: выбор `Месяц` + `Год`. Значение — строка `YYYY-MM`. Переиспользуется во всех точках.

### B. `EditDealDialog.tsx`

Поле «Месяц сделки» (`MonthYearPicker`). По умолчанию — из `meta.deal_month` или вычисленное из `deal_date`. Сохранение в `meta.deal_month` (через существующий update-путь сделки).

### C. Форма урока (`LessonFormFields.tsx`), форма модуля, `LiveEventForm.tsx`

Поле «Месяц контента» (`MonthYearPicker`). Запись в колонку `content_month` (для уроков/модулей) или `metadata.content_month` (для `live_events`). Hint: «Используется для гейта доступа по месяцу покупки».

### D. `ProductAccessRulesTab.tsx` и `LiveEventAccessRulesEditor.tsx`

Switch: **«Только для тех, кто покупал тариф в том же месяце, что и контент»**. Запись `conditions.match_purchase_month`. Превью-текст с явным объяснением.

### E. Карточки в кабинете

В `LessonCard` / списке вебинаров — три состояния:

- **Открыт**: подписка активна И месяцы совпали (или флага нет).
- **Закрыт по месяцу**: подписка активна, но в этом месяце сделки не было. Бейдж «Доступно за отдельную плату» (CTA — следующая итерация).
- **Закрыт по подписке**: текущее поведение.

Состояние получаем из существующего `useAccessValidation` / резолвера — отдельной клиентской логики нет.

## Файлы

**Миграция:**

- `alter table training_lessons add column content_month text`
- `alter table training_modules add column content_month text`
- `alter table live_event_access_rules add column conditions jsonb not null default '{}'::jsonb`
- бэкфилл `training_lessons.content_month` из slug `DDMMYYYY` (9 строк)
- бэкфилл `live_events.metadata.content_month` из `scheduled_at`
- бэкфилл `orders_v2.meta.deal_month` из `deal_date`/`created_at`

**Edge Functions:**

- `_shared/deal-month.ts` (helper)
- `_shared/check-month-purchase.ts` (helper)
- правки в `live-resolve/index.ts`
- правки в `_shared/access-resolver.ts` (ветка training_content)
- правки в `grant-access-for-order/index.ts` (вызов `resolveDealMonth` при создании ордера)

**UI:**

- `src/components/ui/MonthYearPicker.tsx`
- `EditDealDialog.tsx`, `LessonFormFields.tsx`, форма модуля, `LiveEventForm.tsx`
- `ProductAccessRulesTab.tsx`, `LiveEventAccessRulesEditor.tsx`
- `LessonCard.tsx` (бейдж «Закрыт по месяцу»)

## DoD

1. Миграция применена. Proof: SELECT `slug, content_month` по 9 уроков-вебинаров — все равны соответствующим `YYYY-MM`.
2. Все paid-ордера получили `meta.deal_month`.
3. `checkMonthPurchase` покрыт юнит-тестом (совпадение / несовпадение / другой тариф).
4. `live-resolve` и `access-resolver` корректно блокируют контент при `match_purchase_month=true` без сделки в нужном месяце; без флага поведение не меняется.
5. UI: «Месяц сделки» редактируется и сохраняется; «Месяц контента» виден в форме урока и автозаполнен у 9 вебинаров; Switch в редакторе правил пишет `conditions.match_purchase_month`.
6. В `audit_logs` пишется `access.month_gate_{passed|blocked}` с `user_id, content_id, tariff_id, month`.
7. Существующие правила без флага и весь не-вебинарный контент продолжают работать без изменений (regress-проверка по 387 урокам без `content_month`).

## Что НЕ делаем

- Не создаём новые таблицы.
- Не дублируем `check-prior-purchase`.
- Не включаем `match_purchase_month` автоматически ни на одно правило — админ ставит галку сам (так ничего не сломаем в текущих доступах).
- Не реализуем платный докуп месяца.
---

## Отчёт о выполнении — Этап 1 (backend access gate)

**Diagnose**: RPC `has_month_purchase(_user_id, _tariff_id, _month)` уже существовала, но требовала non-null `_tariff_id` (равенство NULL = false). Это блокировало правила «любой тариф продукта».

**Изменения**:
1. `supabase/functions/_shared/check-month-purchase.ts` — новый shared helper. Read-only, валидация формата YYYY-MM, единственный путь — RPC `has_month_purchase`. Возвращает `{ passed, reason }`.
2. RPC `has_month_purchase` — расширена: при `_tariff_id IS NULL` ищет любой оплаченный заказ пользователя в указанный месяц (поведение для заданного tariff_id не изменилось).
3. `supabase/functions/live-resolve/index.ts`:
   - Импорт helper.
   - В чтение `live_event_access_rules` добавлено поле `conditions`.
   - Gate срабатывает **только** если `rule.conditions.match_purchase_month === true` и у события есть `metadata.content_month`.
   - Если флаг включён, но у события нет `content_month` — gate пропускает + аудит `month_gate_passed` с `skip_reason='event_has_no_content_month'`.
   - Дедуп аудита через локальный `monthGateAudited` flag → один verdict (`access.month_gate_passed`/`blocked`) на запрос.
4. `supabase/functions/_shared/access-resolver.ts` — `TrainingContentFilter` дополнен полями `match_purchase_month: boolean` и `rule_tariff_id: string | null`. `resolveTrainingContentFilters` пробрасывает их из `conditions`. Downstream-потребителей этих полей в edge-функциях нет (frontend `TrainingContentFilter` — отдельный одноимённый интерфейс), правка обратно-совместимая.

**Verify (DoD Этап 1)**:
- Миграция RPC применена (линтер: только pre-existing INFO/WARN, новых нарушений нет).
- Smoke RPC на 4 кейсах: `t / t / f / f` — корректно.
- `live-resolve` задеплоен; запрос без auth корректно возвращает 401, новые импорты резолвятся.
- Существующих правил с `match_purchase_month=true` ещё нет — поведение всех остальных правил не изменилось (gate выключен по умолчанию, default-deny не нарушен).

**Не сделано в этом этапе (намеренно)**:
- Runtime-применение `match_purchase_month` для уроков/модулей в кабинете — Этап 3.
- UI-переключатели и `MonthYearPicker` — Этап 2.
