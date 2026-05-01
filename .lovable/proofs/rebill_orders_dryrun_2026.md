# Dry-run rebill-материализации 2026 — Шаг 3

**Run:** `rebill_orders_materialization_2026`

## Инварианты dry-run (все ✅)

| Инвариант | Значение | Статус |
|---|---|---|
| total_to_materialize | 200 | ✅ |
| already_materialized (skip) | 0 | ✅ |
| bad_deal_month | 0 | ✅ |
| missing pipeline/stage у parent | 0 | ✅ |
| duplicate provider_payment_id среди кандидатов | 0 | ✅ |
| distinct parents | 150 | (ожидаемо, см. п.1 audit) |
| distinct users | 125 | |
| distinct (product_id, tariff_id) | 4 | ✅ скоуп не дрейфит |
| sum_amount к материализации | 42 422.00 BYN | |
| без provider_payment_id (admin manual) | 18 | ✅ partial UNIQUE allows |

## UNIQUE constraints на orders_v2
- `pkey(id)` — генерим новые UUID;
- `order_number_key` — генерим формат `REBILL-<first12chars(payment_id)>`;
- `idx_orders_v2_provider_payment_unique (provider, provider_payment_id) WHERE NOT NULL` — partial; для bePaid pid совпадение исключено (см. идемпотентность); admin manual получают `provider='admin', provider_payment_id=NULL` → не попадают в индекс.

## Payload child-orders

Для каждого rebill-payment создаётся `orders_v2` с:
```
id              = gen_random_uuid()
order_number    = 'REBILL-' || substr(payment_id::text,1,12)
user_id         = parent.user_id
profile_id      = parent.profile_id
product_id      = parent.product_id
tariff_id       = parent.tariff_id
currency        = parent.currency (BYN)
status          = 'paid'
final_price     = payment.amount
paid_amount     = payment.amount
provider        = payment.provider     -- 'bepaid' или 'admin'
provider_payment_id = payment.provider_payment_id -- может быть NULL (admin)
bepaid_subscription_id = parent.bepaid_subscription_id
created_at      = payment.paid_at
updated_at      = now()
deal_date       = payment.paid_at
pipeline_id        = parent.pipeline_id
pipeline_stage_id  = parent.pipeline_stage_id
meta            = jsonb_build_object(
  'deal_month', to_char(payment.paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM'),
  'payment_flow', 'bepaid_subscription_charge',
  'source', 'rebill_materialization',
  'parent_order_id', parent.id,
  'materialized_from_payment_id', payment.id,
  'original_parent_deal_month', parent.meta->>'deal_month',
  'do_not_grant_access', true,
  'materialization_run', 'rebill_orders_materialization_2026'
)
```
Затем: `payments_v2.order_id` для этого payment переключается с parent на новый child-order.

## Что НЕ трогается
- `subscriptions_v2` — все строки и `access_end_at` сохраняются (контрольная сумма 1 129 125 365 741);
- `entitlements` — все строки и `expires_at` сохраняются (контрольная сумма 1 059 390 108 283);
- `access_rules` — не меняем;
- `grant-access-for-order` — НЕ вызываем (по правке пользователя, `do_not_grant_access=true` в meta).
- `parent` orders — остаются с `deal_month` как был, оставляем самый ранний платёж.

## Аудит
Один INSERT в `audit_logs`:
```
action='orders.rebill_materialized'
actor_type='system', actor_user_id=NULL,
actor_label='rebill_orders_materialization_2026'
meta = { run, total_inserted, total_repointed_payments,
         distinct_parents, distinct_users, sum_amount }
```
