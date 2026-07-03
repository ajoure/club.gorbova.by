да, согласен, с учетом правок:

Все пункты плана сохраняются по принципу add-only/no-loss. Ниже — обязательные уточнения перед реализацией.

## **1. Сначала подтвердить все callers RPC**

Перед изменением дефолта `p_provider` с `'bepaid'` на `'all'` выполнить поиск всех вызовов:

```text
admin_get_payments_stats_v1
usePaymentsServerStats
PaymentsStatsPanel
```

Нужно вернуть таблицу:

```text
caller
текущий provider
ожидаемое поведение после правки
риск изменения цифр
нужна ли адаптация
```

Если есть caller, который рассчитывает на дефолт `'bepaid'`, его нужно явно перевести на `p_provider: 'bepaid'`, а не ломать поведение молча.

## **2. Дефолт RPC менять только если нет legacy-зависимостей**

Предпочтительный вариант:

```sql
p_provider text DEFAULT 'all'
```

допустим только после caller-аудита.

Если обнаружится хоть один legacy caller без `p_provider`, где исторически ожидался bePaid-only, тогда:

- дефолт RPC оставить `'bepaid'`;
- frontend `/admin/payments` должен явно передавать `'all'`;
- отдельно зафиксировать backlog на миграцию legacy caller.

Цель — не изменить скрыто старые отчёты, если они завязаны на старый дефолт.

## **3. Валидировать provider на уровне RPC**

Добавить безопасную нормализацию:

```sql
v_provider := COALESCE(NULLIF(p_provider, ''), 'all');
```

И явно разрешить только:

```text
all
bepaid
stripe
```

Для неизвестного значения — либо вернуть ошибку `INVALID_PROVIDER`, либо трактовать как `'all'` только если так принято в текущих RPC. Предпочтительно — ошибка, чтобы не скрывать баг frontend.

Фильтр:

```sql
WHERE
  (v_provider = 'all' OR provider = v_provider)
```

## **4. Даты и paid_at**

Проверить, что текущая RPC уже корректно обрабатывает:

- `paid_at IS NOT NULL`;
- границы периода;
- timezone;
- payments со статусом refund/cancel/error;
- refunded payments, где `paid_at` есть, но статус уже другой.

Не менять бизнес-логику статусов и комиссий в этом патче, но зафиксировать, что Stripe-платёж попадает в те же правила агрегации, что и bePaid.

## **5. Комиссия и чистая выручка Stripe**

В плане указано «не меняем расчёты комиссии/чистой выручки» — это правильно.

Но перед PASS нужно явно подтвердить:

```text
если Stripe fee отсутствует/NULL, текущая RPC считает его так же безопасно, как bePaid;
NULL не ломает net revenue;
Stripe amount/currency не смешивает BYN/PLN/USD без правил;
```

Если в выбранном периоде есть разные валюты, не суммировать их в одну цифру без существующего currency-policy. Если текущая панель исторически BYN-only, зафиксировать это в proof.

## **6. Query key frontend**

`queryKey` должен включать оба параметра:

```ts
['payments-server-stats', dateFilter, provider]
```

или фактический canonical key проекта.

Иначе переключение `Все / bePaid / Stripe` может показывать кэшированные цифры.

## **7. Provider filter должен быть единым SOT**

`PaymentsStatsPanel` должен получать ровно тот же provider, что таблица платежей:

```text
filters.provider
```

Не заводить отдельный локальный state для статистики.

Если таблица использует `"all"` как UI-значение, именно оно должно уходить в RPC.

## **8. Tests**

Добавить минимальные проверки:

### **DB/RPC**

```text
p_provider = 'all' → bePaid + Stripe
p_provider = NULL → bePaid + Stripe, если дефолт/нормализация all утверждены
p_provider = 'bepaid' → только bePaid
p_provider = 'stripe' → только Stripe
p_provider = 'unknown' → INVALID_PROVIDER / ожидаемая ошибка
```

### **Frontend**

```text
usePaymentsServerStats включает provider в queryKey
PaymentsStatsPanel передаёт provider в hook
PaymentsTabContent передаёт filters.provider
переключение provider invalidates/refetches stats
```

## **9. Runtime proof**

Для июля 2026 вернуть фактическую таблицу сверки:

```text
provider filter
successful_count
successful_amount
refund_count
refund_amount
fee
net_revenue
expected source rows
verdict
```

Минимум:

```text
all
bepaid
stripe
```

Важно: «29 вместо 28» принимать только если это подтверждено текущими данными на момент runtime. Если за время проверки появились новые платежи, использовать актуальные counts и приложить SQL-сверку.

## **10. Deploy scope**

Разрешено менять только:

```text
migration/RPC admin_get_payments_stats_v1
src/hooks/usePaymentsServerStats.ts
PaymentsStatsPanel
PaymentsTabContent
tests/proof
```

Запрещено менять:

```text
payments_v2 schema кроме RPC
Stripe/bePaid webhooks
refund logic
documents
grant-access
CRM
payment table rows
```

## **11. Финальный отчёт**

Вернуть:

```text
Отчёт о выполненной работе: PATCH-PAYMENTS-STATS-PROVIDER-FILTER-V1
```

С матрицей:

```text
RPC all/null/bepaid/stripe
frontend provider propagation
runtime July 2026 all/bepaid/stripe
no webhook/lifecycle changes
tests
verdict
```

Следующие Stripe/платёжные патчи автоматически не начинать.

&nbsp;

План: учесть Stripe в верхних карточках статистики платежей

## Diagnose

- В `src/hooks/usePaymentsServerStats.ts` вызов RPC `admin_get_payments_stats_v1` **жёстко захардкожен** `p_provider: 'bepaid'` → в карточках «Успешные / Возвраты / Отмены / Ошибки / Комиссия / Чистая выручка» видны только bePaid-платежи, Stripe игнорируется.
- В БД функция `public.admin_get_payments_stats_v1(p_from, p_to, p_provider text default 'bepaid')` фильтрует `WHERE provider = p_provider`. Значения `'all'` она НЕ поддерживает — при передаче `'all'` вернёт нули.
- В таблице (`PaymentsTabContent.tsx`) есть фильтр `filters.provider` со значениями `"all" | "bepaid" | "stripe"`, но в панель статистики он не пробрасывается.
- Проверено данными: за июль 2026 в `payments_v2` — 28 bePaid + 1 Stripe. Пользователь видит агрегаты только по 28 bePaid.

## Fix

### 1. Миграция БД: разрешить `p_provider = 'all' / NULL` = оба провайдера

Обновить `public.admin_get_payments_stats_v1` — оставить существующие защиты и метрики, изменить только последний блок:

```sql
FROM public.payments_v2
WHERE (p_provider IS NULL OR p_provider = 'all' OR provider = p_provider)
  AND paid_at >= p_from AND paid_at <= p_to;
```

Дефолт параметра поменять на `'all'`, чтобы «без фильтра» = агрегация по всем провайдерам (bePaid + Stripe). Сигнатура и возвращаемый JSON не меняются, все остальные вызовы совместимы.

### 2. Frontend: пробросить выбранного провайдера в панель статистики

- `usePaymentsServerStats(dateFilter, provider)` — добавить второй аргумент `provider?: string`, положить в `queryKey`, передать в RPC (`p_provider: provider ?? 'all'`).
- `PaymentsStatsPanel` — принять новый проп `provider` и прокинуть в хук.
- `PaymentsTabContent` — передать `provider={filters.provider}` в `<PaymentsStatsPanel>`.

Поведение:

- Фильтр «Все» → карточки суммируют bePaid + Stripe.
- Фильтр «bePaid» → только bePaid (как сейчас).
- Фильтр «Stripe» → только Stripe.

## Проверка (DoD)

1. Открыть `/admin/payments`, фильтр периода = июль 2026, провайдер = «Все». В карточке «Успешные» количество и сумма увеличиваются на успешный Stripe-платёж (сверить с таблицей внизу — 29 успешных вместо 28).
2. Переключить фильтр на «Stripe» — карточки показывают только Stripe-транзакции.
3. Переключить на «bePaid» — цифры совпадают с текущим поведением до правки.
4. `admin_get_payments_stats_v1(from, to)` без параметра провайдера возвращает объединённые метрики.

## Что НЕ делаем

- Не меняем расчёты комиссии/чистой выручки, стили карточек, таблицу платежей, вебхуки Stripe/bePaid.
- Не заводим отдельные RPC под каждого провайдера.