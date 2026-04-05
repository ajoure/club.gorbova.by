## да, согласен, с учетом правок:

&nbsp;

1. **PATCH-BULK-EXTEND-ADMIN-OVERRIDE**
  Не блокировать массовое продление для **админа / супер-админа** на исторических и истёкших доступах.
  Разделить режимы:
  &nbsp;
  - **обычный режим** — текущий guard остаётся
  - **админский override режим** — разрешено продлевать даже если подписка expired/canceled/historical
    Но только для пользователей с правами admin/super_admin и с явным предупреждением в preview.
    DoD:
  - для admin/super_admin preview не режет исторические сделки как заблокировано
  - строки получают отдельный reasonCode, например admin_override_historical_allowed
  - execute идёт через тот же grant-access-for-order, без прямых update из UI
  &nbsp;
2. **PATCH-BULK-EXTEND-DO-NOT-BLOCK-HISTORICAL**
  Убрать жёсткую бизнес-блокировку вида “историческую покупку продлить нельзя” из bulk extend.
  Вместо этого:
  &nbsp;
  - для обычных пользователей это остаётся warning/block по текущему predicate
  - для админского массового продления это становится **разрешённым сценарием**
    DoD:
  - сделку по истёкшему продукту можно продлить вручную из bulk extend
  - preview честно пишет, что это исторический кейс, но разрешён по admin override
  &nbsp;
3. **PATCH-BULK-EXTEND-MODE-DATE-OR-DAYS**
  Сохранить режим +N дней, но добавить режим **до конкретной даты/времени**.
  Использовать существующий системный DateTime picker.
  DoD:
  &nbsp;
  - два режима: на дни / до даты
  - preview target datetime = execute target datetime
  - в grant-access-for-order поддержан customAccessEndAt
  &nbsp;
4. **PATCH-GLOBAL-CALENDAR-RU**
  Перевести **общий** календарь/DateTime picker на русский язык во всей системе, не локально в одном месте.
  DoD:
  &nbsp;
  - месяцы, дни недели, кнопки, placeholders на русском
  - используется существующий shared calendar, без нового компонента
  &nbsp;
5. **PATCH-BULK-EXTEND-SELECTION-RESET**
  Починить баг залипания preview после Отмена и после смены выделения/фильтра продуктов.
  Нужно полностью сбрасывать:
  &nbsp;
  - snapshot selectedOrderIds
  - previewRows
  - step
  - counters
  - mode / days / targetDate / targetTime
  - blocked/apply buckets
    DoD:
  - выбрал «ЗАКРОЙ ГОД» → отмена → выбрал другие сделки → preview строится только по новой выборке
  &nbsp;
6. **PATCH-BULK-EXTEND-PREVIEW-SNAPSHOT**
  Preview строить по immutable snapshot выбранных сделок на момент нажатия Предварительный просмотр, а не по живому selection state.
  DoD:
  &nbsp;
  - старая выборка не протекает в новый preview
  - query key и preview data привязаны к snapshot, а не к текущему mutable selection
  &nbsp;
7. **PATCH-BULK-EXTEND-REASON-CODES-EXPANDED**
  Не показывать общий текст “не подтверждена текущими правилами доступа”, если реальная причина другая.
  Ввести точные reasonCode:
  &nbsp;
  - subscription_expired
  - subscription_canceled
  - нет_активного_правила_доступа
  - продукт_деактивирован
  - тариф_деактивирован
  - order_subscription_product_mismatch
  - training_binding_mismatch
  - неполные_данные_для_проверки
  - сделка_не_оплачена
  - admin_override_historical_allowed
    DoD:
  - каждая blocked/apply row имеет точный reasonCode и readable text
  - для «ЗАКРОЙ ГОД» причина показывается точно, а не generic
  &nbsp;
8. **PATCH-PRODUCT-ID-AFFINITY-AUDIT**
  Обязательно сделать dry-run сверку связей:
  &nbsp;
  - orders_v2.product_id
  - subscriptions_v2.product_id
  - entitlements.product_id
  - products_[v2.id](http://v2.id)
  - active access_rules.product_id
  - training/training-product bindings
    Цель: убедиться, что продукты, доступы и тренинги реально связаны между собой корректно.
    DoD:
  - отдельный proof CSV по mismatch-типам
  - по каждому проблемному продукту видно, где именно разрыв связи
  &nbsp;
9. **PATCH-ZAKROY-GOD-DIAGNOSIS**
  Отдельно диагностировать и доказать кейсы по **«ЗАКРОЙ ГОД»**:
  &nbsp;
  - есть ли active rule
  - какой product_id у сделки
  - какой product_id у подписки
  - какой product_id у entitlement
  - какой training привязан к продукту
  - почему preview красный
    DoD:
  - отдельный CSV/diagnostic artifact по «ЗАКРОЙ ГОД»
  - если причина только в expired subscription, это явно так и пишется
  - если причина в mismatch ID/binding, это фиксируется отдельным bucket
  &nbsp;
10. **PATCH-ACCESS-DURATION-DRIFT-DISCOVERY**
  Добавить в текущий спринт **discovery-only** проверку несоответствия сроков дочерних доступов сроку основного продукта.
  Пример: Gorbova Club / BUSINESS истекает раньше, а связанный доступ к Ценному бухгалтеру стоит дольше, хотя по правилам должен быть ограничен сроком основного продукта.
  Это не обязательно чинить прямо сейчас, если scope перегружен, но **обязательно выявить и зафиксировать**:
  &nbsp;
  - основной продукт
  - зависимый продукт
  - expected_end_at
  - actual_end_at
  - drift_days
  - rule source
    DoD:
  - отдельный discovery artifact по drift кейсам
  - если не чинится в этом спринте, переносится как отдельный bug patch в следующий без потери
  &nbsp;
11. **PATCH-BULK-EXTEND-NOT-BREAK-CURRENT-PREDICATE**
  Shared predicate не ломать.
  Нужно не удалять старую логику, а расширить её:
  &nbsp;
  - predicate остаётся источником truth для “валидного текущего доступа”
  - bulk extend получает дополнительную ветку admin override
    DoD:
  - обычная логика вкладки «Доступы» не меняется и не начинает показывать лишнее
  - override влияет только на bulk extend flow
  &nbsp;
12. **PATCH-PROOF-REAL-BROWSER-IN-PROGRESS**
  Фазу Г не закрывать как completed, пока нет реального browser/runtime proof после этих правок:
  &nbsp;
  - valid case
  - no rule case
  - historical/admin override case
  - cancel/reselect reset case
    DoD:
  - статус Фазы Г = proof-in-progress до реального UI proof
  &nbsp;

&nbsp;

```
Жёсткие правила исполнения для Lovable.dev

1. Ничего не ломать вне scope. Только add-only и точечные правки.
2. Не изобретать новую бизнес-логику. Источник истины:
   - orders_v2
   - subscriptions_v2
   - entitlements
   - products_v2
   - tariffs
   - access_rules
   - существующие product/training bindings.
3. Shared predicate не удалять и не ослаблять глобально.
4. Для bulk extend добавить отдельный admin override, а не ломать общий predicate.
5. Исторические/истёкшие сделки для admin/super_admin должны быть продлеваемы вручную из bulk extend.
6. Execute только через grant-access-for-order. Никаких прямых update/insert в subscriptions_v2 / entitlements из UI.
7. Добавить режим продления до конкретной даты/времени через существующий shared DateTime picker.
8. Перевести shared calendar/date-time picker на русский во всей системе.
9. После Cancel / смены selection / смены product filter preview и state должны сбрасываться полностью.
10. Preview строить по snapshot выбранных сделок, а не по живому selection state.
11. Для всех blocked/apply строк в preview и proof CSV использовать точные reasonCode, без общего misleading-текста.
12. Обязательно сделать dry-run сверку product_id / entitlement / subscription / access_rules / training bindings.
13. Отдельно проверить drift сроков зависимых доступов относительно основного продукта и зафиксировать как discovery или fix.
14. Старые proof/CSV не переписывать. Только add-only новые артефакты.
15. Фаза Г не считается закрытой до реального browser/runtime proof после этих правок.

PATCH-LIST

PATCH-BULK-EXTEND-ADMIN-OVERRIDE
- Разрешить продление historical/expired/canceled кейсов для admin/super_admin.
- Preview помечает это отдельным reasonCode.
DoD:
- Исторические сделки можно продлить вручную админом.

PATCH-BULK-EXTEND-DO-NOT-BLOCK-HISTORICAL
- Убрать абсолютный запрет на продление исторических кейсов в bulk extend.
DoD:
- Для admin override такие строки не blocked, а apply/allowed-with-warning.

PATCH-BULK-EXTEND-MODE-DATE-OR-DAYS
- Добавить режим “до конкретной даты/времени”.
DoD:
- Target datetime одинаков в preview, execute и DB.

PATCH-GLOBAL-CALENDAR-RU
- Перевести shared Calendar/DateTime picker на русский.
DoD:
- Русская локаль во всей системе.

PATCH-BULK-EXTEND-SELECTION-RESET
- Полный reset состояния после Cancel / смены selection / фильтра.
DoD:
- Нет залипания старого preview.

PATCH-BULK-EXTEND-PREVIEW-SNAPSHOT
- Preview по immutable snapshot.
DoD:
- Новая выборка = новый preview.

PATCH-BULK-EXTEND-REASON-CODES-EXPANDED
- Точные reasonCode для всех блокировок и override-кейсов.
DoD:
- Нет generic misleading message.

PATCH-PRODUCT-ID-AFFINITY-AUDIT
- Dry-run сверка всех product/binding/access связей.
DoD:
- Есть proof CSV по mismatch buckets.

PATCH-ZAKROY-GOD-DIAGNOSIS
- Отдельная диагностика кейсов “ЗАКРОЙ ГОД”.
DoD:
- Понятна точная причина красных строк.

PATCH-ACCESS-DURATION-DRIFT-DISCOVERY
- Discovery по кейсам, где зависимый доступ живёт дольше основного.
DoD:
- Есть отдельный artifact и backlog/fix-to-patch, если не чинится сейчас.

PATCH-BULK-EXTEND-NOT-BREAK-CURRENT-PREDICATE
- Обычный predicate для UI оставить как есть.
DoD:
- Override работает только внутри bulk extend.

PATCH-PROOF-REAL-BROWSER-IN-PROGRESS
- Не закрывать Фазу Г до нового browser/runtime proof.
DoD:
- Статус proof-in-progress до реального подтверждения.

План: Пакет PATCH для BulkExtendAccessDialog + Calendar RU + Audit
```

### Диагностика

**ЗАКРОЙ ГОД подтверждено SQL:**

- Продукт `73c29914` имеет 1 active rule, `is_active = true`
- ВСЕ подписки по нему: `status = expired`, `access_end_at = 2026-04-01` (в прошлом)
- Predicate корректно блокирует: condition #1 (status) и #2 (expired) не проходят
- Текущее сообщение «не подтверждена правилами доступа» — misleading, реальная причина: `subscription_expired`
- **Решение:** admin override + точные reason codes

**Edge function `grant-access-for-order`:** принимает `customAccessDays`, `customAccessStartAt`, `extendFromCurrent`, НЕ принимает `customAccessEndAt`. Нужно добавить.

**Calendar:** `calendar.tsx` не имеет `locale={ru}`. `DateTimePicker` форматирует даты через `ru`, но Calendar внутри него показывает английские дни/месяцы.

---

### Файлы для изменения

#### 1. `src/components/ui/calendar.tsx` — PATCH-GLOBAL-CALENDAR-RU

- Добавить `import { ru } from "date-fns/locale"` и `locale={ru}` как default prop в DayPicker
- Все потребители Calendar автоматически получат русскую локализацию

#### 2. `src/hooks/useAccessValidation.ts` — PATCH-REASON-CODES + ADMIN-OVERRIDE

**Расширение типов:**

- Добавить новые reason codes: `subscription_expired`, `subscription_canceled`, `тариф_деактивирован`, `admin_override_historical_allowed`
- Добавить функцию `diagnoseAccessFailure(sub, productsWithRules)` — возвращает точный reasonCode вместо generic текста

**Расширение `checkExtendEligibility`:**

- Добавить параметр `options?: { isAdminOverride?: boolean }`
- Если `isAdminOverride = true` и сделка оплачена и у продукта есть active rule:
  - НЕ блокировать на отсутствии подписки / expired подписке
  - Вернуть `action: "применить"` с `reasonCode: "admin_override_historical_allowed"` и warning-текстом
- Обычный predicate `isCurrentValidAccess` НЕ трогать — он остаётся для UI вкладки «Доступы»

**Функция `diagnoseAccessFailure`:**

- Проверяет условия по порядку и возвращает первую конкретную причину:
  - status не active/trial → `subscription_expired` или `subscription_canceled`
  - access_end_at в прошлом → `subscription_expired`
  - product_id не в productsWithRules → `нет_активного_правила_доступа`
  - products_v2.is_active = false → `продукт_деактивирован`
  - tariffs.is_active = false → `тариф_деактивирован`

#### 3. `src/components/admin/BulkExtendAccessDialog.tsx` — основной PATCH

**PATCH-ADMIN-OVERRIDE:**

- Добавить `import { useRbac } from "@/hooks/useRbac"`
- Получить `const { isAdmin, isSuperAdmin } = useRbac()`
- Передать `{ isAdminOverride: isAdmin || isSuperAdmin }` в `checkExtendEligibility`
- В preview для admin_override строк показывать отдельный amber-badge «Админ-доступ» вместо зелёного
- В guard-блоке (setup step) показать доп. текст для админов: «Для вас доступно продление исторических и истёкших кейсов»

**PATCH-MODE-DATE-OR-DAYS:**

- Добавить state: `mode: "days" | "date"`, `targetDate: Date | undefined`, `targetTime: string`
- В setup step: radio-кнопки «+N дней» / «До конкретной даты»
- При mode="date" показать `DateTimePicker` (существующий компонент из `@/components/ui/datetime-picker`)
- Вычислять `targetEndDate`: при days — как сейчас; при date — из targetDate+targetTime
- Один `targetEndDate` → preview rows И execute

**PATCH-SELECTION-RESET + PREVIEW-SNAPSHOT:**

- В `handleClose` сбросить ВСЁ: step, days, mode, targetDate, targetTime, extendFromCurrent, results
- Добавить `useRef<string[]>` для snapshot selectedOrderIds
- При нажатии «Предварительный просмотр» — зафиксировать snapshot, query key привязать к нему
- Добавить `useEffect` на `open`: если open=true и selectedOrderIds изменились — auto-reset

**PATCH-REASON-CODES в UI:**

- В `PreviewRow` добавить `reasonCode?: string`
- Показать reasonCode как мелкий tag в строке preview рядом с reason text
- Для admin_override строк: amber-стиль вместо зелёного/красного

**PATCH-EXECUTE-TARGET-DATE:**

- При mode="date" передавать в edge function: `customAccessEndAt: targetEndDate.toISOString()` вместо `customAccessDays`
- При mode="days" передавать как сейчас: `customAccessDays: days`

#### 4. `supabase/functions/grant-access-for-order/index.ts` — PATCH-EXECUTE-TARGET-DATE

- Добавить `customAccessEndAt` в деструктуризацию body (строка 103)
- После расчёта `accessEndAt` (строка 202-209): если `customAccessEndAt` задан — перезаписать `accessEndAt = new Date(customAccessEndAt)`, пропуская расчёт через days
- Priority: `customAccessEndAt` > `customAccessDays` > tariff duration

#### 5. Proof-артефакты (add-only, после code changes)

Запустить SQL dry-run и сгенерировать:

- `16_proof_zakrij_god_diagnosis.csv` — breakdown по ЗАКРОЙ ГОД: order_id, product_id, sub_status, sub_access_end_at, has_active_rule, exact_reasonCode
- `17_proof_product_affinity_audit.csv` — сверка order.product_id vs subscription.product_id vs access_rules.product_id по проблемным продуктам
- `18_proof_duration_drift_discovery.csv` — discovery по drift зависимых доступов
- `19_proof_no_direct_update_v2.csv` — grep подтверждение отсутствия прямых update

---

### Что НЕ меняется

- `isCurrentValidAccess` — 5 условий сохраняются, обычная логика UI не затрагивается
- Execute только через `grant-access-for-order`
- Старые CSV/proof не перезаписываются
- Фаза Б остаётся заблокированной

### Последовательность выполнения

```text
1. calendar.tsx → locale={ru}
2. useAccessValidation.ts → diagnoseAccessFailure + admin override в checkExtendEligibility
3. BulkExtendAccessDialog.tsx → admin override + date mode + state reset + snapshot + reason codes
4. grant-access-for-order/index.ts → customAccessEndAt support
5. Deploy edge function
6. SQL dry-run → proof CSV artifacts
7. Browser proof (если доступен): 4 сценария
```

### DoD по каждому PATCH


| PATCH                    | DoD                                                      |
| ------------------------ | -------------------------------------------------------- |
| ADMIN-OVERRIDE           | Admin видит исторические как «применить» с amber warning |
| DO-NOT-BLOCK-HISTORICAL  | Для admin override expired кейсы разрешены               |
| MODE-DATE-OR-DAYS        | Toggle + DateTimePicker, preview=execute target          |
| GLOBAL-CALENDAR-RU       | `locale={ru}` в shared Calendar                          |
| SELECTION-RESET          | Cancel → reset всего state                               |
| PREVIEW-SNAPSHOT         | Snapshot в useRef при нажатии preview                    |
| REASON-CODES-EXPANDED    | Точные reasonCode без generic текста                     |
| EXECUTE-TARGET-DATE      | customAccessEndAt в edge function                        |
| PRODUCT-AFFINITY-AUDIT   | Dry-run CSV                                              |
| ZAKROY-GOD-DIAGNOSIS     | CSV с точными причинами                                  |
| DURATION-DRIFT-DISCOVERY | Discovery CSV                                            |
| NOT-BREAK-PREDICATE      | isCurrentValidAccess без изменений                       |
| PROOF-REAL-BROWSER       | Фаза Г = proof-in-progress до browser proof              |


### Статус фаз после выполнения

- Фаза А v3: закрыта
- Фаза В: закрыта (UI predicate без изменений)
- Фаза Г: **proof-in-progress** → закрывается после browser proof
- Фаза Б: заблокирована