# H5-final-bulk-remaining — execute + verify (SUCCESS)

**Snapshot UTC:** 2026-05-17 ~13:17 UTC
**Run id:** `h5_final_bulk_remaining_2026_05`
**Итог:** ✅ Все 70 green-кандидатов материализованы одним патчем. Collective orphan guard добавлен. Все verify-инварианты зелёные. subscriptions_v2 / entitlements / provider_subscriptions побайтово равны pre-execute baseline.

## 1. Финальный scope (70 платежей / 16 060.00 BYN)

Источник: `.lovable/proofs/h5_refresh_v2_frozen_candidates_2026_05.csv` (73 green)
− `ffb88444` (skip_done, апрельский, уже материализован)
− `b9d946d4` (Хрущёва, manual_review:refund_or_tariff_upgrade_flow)
− `8c78c039` (kept_as_parent_initial_collective_guard, см. п.2)
= **70 / 16 060.00 BYN**.

| месяц | rows | сумма BYN |
| --- | ---:| ---:|
| 2026-03 | 1 | 250.00 |
| 2026-05 | 69 | 15 810.00 |
| **итого** | **70** | **16 060.00** |

## 2. Collective orphan guard (новый)

Логика:

> Для каждого `parent_order_id`:
> если `count(candidates_to_move_from_parent) >= count(succeeded_non_refund_payments_on_parent)`,
> то самый ранний successful non-refund payment остаётся на parent с reason
> `kept_as_parent_initial_collective_guard`, остальные кандидаты идут в REBILL.

Применено к одному parent:

| parent | order_number | succ_payments | candidates | kept | materialized |
| --- | --- | ---:| ---:| --- | --- |
| `efe58870-…` | SUB-LINK-MLNYCZPF | 2 | 2 | `8c78c039` (2026-03-17, earliest) | `5fc22e49` → REBILL-5fc22e49-9e1 |

## 3. Preflight (read-only) — все guards зелёные

```
total              = 70
missing_payments   = 0
already_mat        = 0
refunded           = 0
collective_orphan  = 0   ← новый guard
parent_is_rebill   = 0
order_number_clash = 0
missing_pipeline   = 0
total_amount       = 16 060.00 BYN
distinct_parents   = 70  (1 candidate per parent)
```

## 4. Execute (одним патчем, single batch)

Атомарная CTE-транзакция:

1. `INSERT orders_v2` (REBILL) × 70 — с `base_price = final_price = paid_amount = payment.amount`, наследование `user_id/profile_id/product_id/tariff_id/pipeline_id/pipeline_stage_id/bepaid_subscription_id/currency` от parent.
2. `UPDATE payments_v2.order_id` × 70 — payment → новый REBILL.id; в `meta.rebill_materialization` записаны `run/new_order_id/new_order_number/moved_at`.
3. `INSERT audit_logs` × 70 (per-payment `orders.rebill_materialized`).
4. `INSERT audit_logs` × 1 (summary `orders.rebill_materialized_summary`, в `meta` зафиксирован `collective_guard_kept=[8c78c039-…]`).

REBILL-order meta:
```json
{
  "deal_month": "YYYY-MM (Europe/Minsk)",
  "payment_flow": "bepaid_subscription_charge",
  "source": "rebill_materialization",
  "parent_order_id": "<uuid>",
  "parent_order_number": "<string>",
  "materialized_from_payment_id": "<uuid>",
  "do_not_grant_access": true,
  "run": "h5_final_bulk_remaining_2026_05",
  "batch": "single"
}
```

## 5. Verify post-execute

| invariant | expected | actual | OK |
| --- | --- | --- |:---:|
| created REBILL-orders (run) | 70 | 70 | ✅ |
| repointed payments_v2 (run) | 70 | 70 | ✅ |
| audit per-payment | 70 | 70 | ✅ |
| audit summary | 1 | 1 | ✅ |
| orphan_parents (collective) | 0 | 0 | ✅ |
| rebill orders with ≠1 payment | 0 | 0 | ✅ |
| `b458870d…cfad` → expected | REBILL-b458870d-cfa | REBILL-b458870d-cfa | ✅ |
| `5fc22e49…` → its own REBILL | REBILL-5fc22e49-9e1 | REBILL-5fc22e49-9e1 | ✅ |
| `8c78c039…` остался на parent | SUB-LINK-MLNYCZPF | SUB-LINK-MLNYCZPF | ✅ |

## 6. Невидимость для доступов (sanity vs baseline)

| метрика | baseline | post-execute | OK |
| --- | ---:| ---:|:---:|
| `subscriptions_v2` active/trial/past_due | 449 | 449 | ✅ |
| `entitlements` total | 931 | 931 | ✅ |
| `subscriptions_v2` Σepoch(access_end_at) | 1 943 707 329 318 | 1 943 707 329 318 | ✅ |
| `entitlements` Σepoch(expires_at) | 1 654 710 914 606 | 1 654 710 914 606 | ✅ |
| `provider_subscriptions` | 565 | 565 | ✅ |
| `orders_v2` REBILL-% | 202 | 272 (+70) | ✅ |

## 7. Что НЕ выполнялось (намеренно)

- `subscriptions_v2`, `entitlements`, `provider_subscriptions`, `telegram_club_members`, `access_rules`, `refunds` — без touch.
- `grant-access-for-order`, provider API, secrets / mode — без touch.
- Parent orders (`UPDATE`) — без touch.

## 8. Excluded из run

| payment_id | reason |
| --- | --- |
| `ffb88444-c5dc-47dd-af0d-1dfe8a5d897a` | skip_done (уже материализован 2026-04 batch) |
| `b9d946d4-e775-40e8-b5b7-f606d2e71642` | manual_review:refund_or_tariff_upgrade_flow (Хрущёва) |
| `0f854c28-…` | filtered v1: refund-related |
| `6bfead3b-1365-4306-9f96-abaf66a7011e` | manual_review:parent_would_be_orphaned (январь) |
| `ab0ffa83-…` | manual_review:parent_would_be_orphaned (май, edge) |
| `8c78c039-7c22-46b5-a47e-f3067aef9007` | **kept_as_parent_initial_collective_guard** (новое) |

## 9. Rollback (не использован, остаётся в backlog)

`.lovable/proofs/h5_final_bulk_rollback_2026_05.sql` — generic rollback by `meta->>'run'='h5_final_bulk_remaining_2026_05'`. Для отмены этого run выполнить:
```sql
UPDATE payments_v2 p
SET order_id = (p.meta->'rebill_materialization'->>'new_order_id')::uuid -- placeholder, нужен parent_order_id
...
```
(Полный rollback SQL по этому run генерируется out-of-band из `orders_v2.meta->>'parent_order_id'`.)

## 10. Итог

**SUCCESS.** 70 REBILL-orders созданы, 70 payments repointed, доступы не пострадали, collective orphan guard сработал на 1 parent (SUB-LINK-MLNYCZPF), Хрущёва осталась manual_review.

`remaining clean green = 0` (кроме intentionally kept `8c78c039`).
