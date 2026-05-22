# Proof: backfill orders_v2.offer_id 2026 — Gorbova Club + «Бухгалтерия как бизнес»

- **Batch ID:** `89ed9a32-8f53-48ec-80d8-3b7e2f06e2da`
- **Audit row:** `audit_logs.id = a381699c-4b38-445f-8fca-fb0891177e46`
- **Дата:** 2026-05-22 13:58 UTC
- **Скоуп:** `orders_v2` за `[2026-01-01, 2027-01-01)`, `product_id ∈ { 11c9f1b8-… (Gorbova Club), 85046734-… (Бухгалтерия как бизнес) }`

## Mapping (tariff_id → canonical offer_id)

| Продукт | Тариф | tariff_id | canonical offer_id |
|---|---|---|---|
| Gorbova Club | BUSINESS  | 7c748940-dcad-4c7c-a92e-76a2344622d3 | bc0f7a90-df41-4a86-b2ea-2a1234d0d534 |
| Gorbova Club | CHAT      | 31f75673-a7ae-420a-b5ab-5906e34cbf84 | 6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e |
| Gorbova Club | FULL      | b276d8a5-8e5f-4876-9f99-36f818722d6c | c5781abf-0376-4e1f-91dc-99773906ee77 |
| Gorbova Club | ИДЕОЛОГИЯ | b018e9be-53ce-4840-8034-e09f8e319080 | d307b438-758c-4f1e-b7d5-fe32df7cae1c |
| Бухгалтерия как бизнес | Стандартный | c5981337-242b-49e8-8c99-64ccf8fac13e | 88c6f10d-a0c6-47f3-9d90-980b3a86fe1c |

## Before / After

| Метрика | Before | After |
|---|---:|---:|
| Заказов 2026 двух продуктов без `offer_id` | 188 | **0** |
| Paid >50 BYN, оффер с 0 `document_scenarios` | 0 | **0** |

## Изменения

- Stage 1 (NULL → canonical): **188 строк** UPDATE.
- Stage 2 (paid >50 с пустыми сценариями): **0 строк** (нечего обновлять).
- Каждый заказ помечен `meta.offer_id_backfill_2026 = { batch_id, prev_offer_id, reason, applied_at }`.

## DoD

- 0 заказов 2026 по двум продуктам без `offer_id` ✅
- 0 paid >50 BYN, привязанных к офферу без `document_scenarios` ✅
- В `audit_logs` одна сводная запись с `batch_id`, mapping, before/after и списком 188 `order_id` (stage 1) ✅
- Не затрагивались `subscriptions_v2`, `entitlements`, `access_rules`, `payments_v2`, `payment_sessions`, `payment_links`, `status`, `paid_amount`, `final_price`, `tariff_id`, `product_id`, `user_id` ✅

## Rollback note

При необходимости откат точечно по `meta->'offer_id_backfill_2026'->>'batch_id' = '89ed9a32-…'`:
заказы с `reason='offer_id_null'` → `offer_id := NULL`;
с `reason='trial_offer_without_scenarios'` → `offer_id := meta->'offer_id_backfill_2026'->>'prev_offer_id'`.
