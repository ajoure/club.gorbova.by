# да, согласен, с учетом правок:

1. **Заголовок оставить как есть**

Формат корректный:

```text
План: BACKFILL-CLEANUP-NO-CARD-TRIAL-SUBS — Dry-run
```

Это именно dry-run, без write-действий.

2. **Добавить safety-правило по heuristic match**

`heuristic_time_match` нельзя смешивать с явными связями как равнозначный кандидат для будущего sweep.

В dry-run таблице нужно разделить:

```text
safe_candidates       = provider_subscriptions / meta.order_id / meta.tracking_id
review_candidates     = heuristic_time_match only
```

Для будущего удаления автоматически допустимы только `safe_candidates`.  
`heuristic_time_match only` — только ручная проверка, без auto-delete.

3. **Проверить, что** `product_id` **реально есть в** `subscriptions_v2`

В плане есть:

```text
subscriptions_v2.user_id + product_id + tariff_id
```

Перед запросом проверить фактические колонки `subscriptions_v2`.

Если `product_id` нет, использовать связку через тариф:

```sql
subscriptions_v2.tariff_id → tariffs.product_id
```

И в отчёте явно указать фактический join.

4. **Provider-linked строки считать risk-сегментом**

Если sub связан с:

```text
provider_subscriptions
payment_methods
provider_subscription_id
bepaid / stripe ids
```

то это не кандидат на автоматический sweep без отдельного разбора.

В dry-run добавить флаг:

```text
risk_provider_linked = true/false
```

и правило:

```text
provider-linked rows excluded from auto-sweep proposal
```

5. **Entitlement coverage недостаточно просто “есть active entitlement”**

Нужно проверить не только наличие entitlement, но и срок:

```text
entitlements.status='active'
entitlements.expires_at >= subscriptions_v2.access_end_at OR entitlements.expires_at >= now()
```

И отдельно вывести:

```text
entitlement_coverage = none / active_shorter / active_ok / expired
```

Чтобы не удалить sub, если он единственный источник видимого срока доступа.

6. **Добавить проверку ledger**

Для каждого кандидата вывести, есть ли grant в `access_grant_ledger` по тому же user/product/order:

```text
ledger_grant_exists = true/false
ledger_grant_status
ledger_source_order_id
```

Цель: доказать, что доступ держится ledger/entitlement, а не sub-row.

7. **Не использовать** `status='paid'` **без** `paid_amount=0`

В контрольном запросе добавить `paid_amount=0`, иначе в список могут попасть trial-заказы, которые по ошибке paid, но не no-card 0 BYN:

```sql
AND paid_amount = 0
```

И желательно:

```sql
AND COALESCE(meta->>'source','') = 'trial_no_card'
```

8. **Агрегаты должны разделять “delete-safe” и “manual-review”**

Второй файл агрегатов должен содержать минимум:

```text
total_no_card_trial_orders
total_candidate_subs
safe_explicit_candidates
heuristic_only_candidates
provider_linked_candidates
entitlement_active_ok
entitlement_missing_or_short
recommended_for_sweep
recommended_for_manual_review
```

9. **CSV не должен содержать лишние персональные данные**

Email/phone в CSV не выводить, если не нужно.

Достаточно:

```text
sub_id
order_id
user_id
product_id
tariff_id
status
dates
link_source
risk flags
```

Если нужен email для ручной проверки — маскировать:

```text
a***@domain.com
```

10. **Финальный отчёт dry-run**

Заголовок:

```text
Отчет о выполненной работе: BACKFILL-CLEANUP-NO-CARD-TRIAL-SUBS — Dry-run
```

В конце:

```text
no-card trial orders inventory: PASS
subscription candidates identified: PASS
explicit vs heuristic split: PASS
provider-linked risk split: PASS
entitlement/ledger coverage: PASS
CSV export: PASS
BACKFILL-CLEANUP-NO-CARD-TRIAL-SUBS — Dry-run: PASS/PARTIAL/FAIL
```

После этих правок dry-run можно выполнять. Sweep — только отдельным планом после просмотра списка.

&nbsp;

План: BACKFILL-CLEANUP-NO-CARD-TRIAL-SUBS — Dry-run

## Цель

Собрать read-only список subscriptions_v2-строк, которые были созданы старой версией `grant-access-for-order` для no-card trial заказов (до фикса PATCH-NO-CARD-TRIAL-NO-SUBSCRIPTION-ROW). Никаких UPDATE/DELETE. Результат — таблица для согласования перед sweep.

## Scope

- Только `SELECT` через `supabase--read_query` / psql.
- Никаких миграций, edge-функций, кода.
- Никаких изменений в `subscriptions_v2`, `entitlements`, `access_grant_ledger`.

## Шаги

### 1. Идентификация маркера no-card trial

Маркер заказа (подтверждён в SOT): `orders_v2.meta->>'source' = 'trial_no_card'` + `is_trial=true` + `paid_amount=0` + `status='paid'`.

### 2. Базовый отчёт по orders_v2 (контрольная цифра)

```sql
SELECT count(*) AS no_card_trial_orders_total,
       min(created_at) AS first_seen,
       max(created_at) AS last_seen
FROM orders_v2
WHERE meta->>'source' = 'trial_no_card'
  AND is_trial = true
  AND status = 'paid';
```

### 3. Кандидатные subscriptions_v2

Связь sub → order ищется по нескольким каналам (используем UNION DISTINCT, не пропускаем ни одного):

- `provider_subscriptions.order_id` → `subscriptions_v2.id`
- `subscriptions_v2.meta->>'order_id'`
- `subscriptions_v2.meta->>'tracking_id'` вида `subv2:<sub_id>:order:<order_id>`
- `subscriptions_v2.user_id + product_id + tariff_id` точно совпадает с no-card trial order, созданным в пределах ±10 минут от `subscriptions_v2.created_at` (страховка для старых строк без явной связи)

Для каждой кандидатной строки вывести:

```text
sub_id, user_id, product_id, tariff_id, status, is_trial,
auto_renew, access_start_at, access_end_at, created_at,
linked_order_id, link_source (provider_subscriptions | meta.order_id | meta.tracking_id | heuristic_time_match),
order.paid_amount, order.is_trial, order.meta->>'source'
```

### 4. Срезы для согласования

- Всего кандидатных subs.
- Разбивка по `link_source` (явная связь vs heuristic).
- Разбивка по `status` (active / canceled / expired / past_due / прочие).
- Разбивка по `is_trial` в самой sub-строке (true/false — ожидаем преимущественно false, что и есть семантический баг).
- Сколько из них имеют активный `entitlement` для того же `user_id + product_id` (т.е. удаление sub не повредит entitlement).
- Сколько подвязаны на `payment_methods` / `provider_subscriptions` с реальным платёжным каналом (флаг риска — такие не трогаем без отдельного разбора).

### 5. Экспорт

CSV в `/mnt/documents/backfill_no_card_trial_subs_dryrun_<date>.csv` с полной таблицей кандидатов + второй файл — агрегаты по срезам.

### 6. Что НЕ делаем

- Не удаляем и не модифицируем ни одной строки.
- Не трогаем `entitlements` / `access_grant_ledger`.
- Не пишем audit-логи о sweep (нечего логировать).
- Не запускаем edge-функции.

## DoD dry-run

- Контрольная цифра no-card trial orders получена.
- Список subscriptions_v2-кандидатов сформирован с указанием `link_source` для каждой.
- Срезы по статусу / entitlement-coverage / провайдерскому каналу готовы.
- CSV выгружен.
- Отчёт отправлен пользователю на согласование. Sweep — отдельным планом после approve списка.

## Технические детали

- Edge function: нет.
- Миграции: нет.
- Изменения кода: нет.
- Все запросы — через `supabase--read_query` либо psql read-only.