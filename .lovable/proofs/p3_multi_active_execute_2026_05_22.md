# P3 multi_active — execute proof (2026-05-22, Minsk)

Status: **EXECUTED.** Rowcount guard прошёл.

## Что сделано
Тариф «Подоходный налог ИП / стандарт» (`tariff_id=0fb3db55-b6ba-44bf-8a0b-37bb040ab01a`).

| reason | offer_id | rows updated | guard |
|---|---|---|---|
| `full_payment_350` | `5dfc9ca5-f601-4cf2-95ab-f0a3511f91cc` | **9** | expected=9 ✓ |
| `installment_195` | `7e9187ea-9b7d-48ed-b6d4-9ebf6284e8ae` | **1** | expected=1 ✓ |
| `gift_manual_review` (skipped) | — | 0 | `GIFT-26-MLQQ8J5Z` нетронут ✓ |

`batch_id`: `p3_offer_id_backfill_multi_active_2026_05_22`.

## Проверки после execute
```sql
SELECT order_number, offer_id, paid_amount, meta->>'offer_id_backfill_reason'
FROM orders_v2
WHERE id IN (10 ids + 1 gift);
```
Результат (verified):

| order_number | offer_id | paid | reason |
|---|---|---|---|
| PAY-26-MN7PE4R2     | 5dfc9ca5… | 350 | full_payment_350 |
| PAY-26-MMUQAY2V     | 5dfc9ca5… | 350 | full_payment_350 |
| PAY-26-MMUQDEPD     | 5dfc9ca5… | 350 | full_payment_350 |
| PAY-26-MMUQOBC8     | 5dfc9ca5… | 350 | full_payment_350 |
| PAY-26-MMUQJ1SZ     | 5dfc9ca5… | 350 | full_payment_350 |
| PAY-26-MMUQM4PF     | 5dfc9ca5… | 350 | full_payment_350 |
| PAY-26-MMUQGCEC     | 5dfc9ca5… | 350 | full_payment_350 |
| ORD-BULK-1774594112562 | 5dfc9ca5… | 350 | full_payment_350 |
| ORD-BULK-1774594112563 | 5dfc9ca5… | 350 | full_payment_350 |
| ORD-LINK-1773078892991 | 7e9187ea… | 195 | installment_195 |
| GIFT-26-MLQQ8J5Z    | NULL      | 0   | NULL (skipped) |

## Что НЕ менялось
- `payments_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `tariff_offers`, `document_scenarios`;
- `paid_amount`, `status`, `tariff_id`, даты оплат;
- никакие записи кроме перечисленных 10 заказов и одной строки `audit_logs`.

## Audit
`audit_logs` (action=`orders.offer_id_backfill_multi_active`, actor_type=`system`,
actor_label=`p3_offer_id_backfill_multi_active_2026_05_22`) содержит:
- `full_payment_350_updates=9`, `installment_195_updates=1`;
- `tariff_id`, оба `offer_id`;
- `skipped_gift_order_id=a0ec1f74-868d-4ec5-8f8e-e926605e3e54`.

## Важно
Кнопка «Сформировать документ» в `/purchases` по этим 10 заказам всё ещё скрыта,
пока в офферах `5dfc9ca5…` и `7e9187ea…` не настроены `document_scenarios`.
Это ожидаемо и в скоупе backlog `document_scenarios`, не P3.
