# INV-22 Overshoot Correction — Snapshot v3 (SOT)

**Snapshot table:** `public._inv22_overshoot_snapshot`
**Created:** 2026-05-02
**Status:** APPROVED — SOT for Notify+Backfill+Revoke

## Selection criteria

- **Cohort A (Club, 75):**
  - `product_id = 11c9f1b8-0355-4753-bd74-40b42aa53616`
  - `meta->>'access_end_at_corrected_by' = 'bepaid_overshoot_backfill_2026_05'`
  - Excluded: `subscription_id = 64067f5d-ca00-4fed-b063-7b0100e203bb` (Екатерина, уже уведомлена)
  - `correct_end_at = current_end_at` (Club уже backfilled)
  - Price source: `tariffs.original_price`
- **Cohort B (4 продукта, 43):**
  - Products: 85046734 (Бух), 9d0d6de8 (Консультация), de36a695 (Подоходный), 9187db54 (Общепит)
  - Link: `subscriptions_v2.user_id+product_id ↔ orders_v2 (paid) ↔ payments_v2 (succeeded)`, MAX(paid_at)
  - Threshold: `access_end_at > last_paid_at + tariffs.access_days` (strict >)
  - `correct_end_at = last_paid_at + tariffs.access_days`
  - Price source: `orders_v2.final_price`
  - Бухгалтерия (32) → cohort=`business`, notify+backfill+revoke
  - Остальные (11) → cohort=`silent`, backfill only

## Totals (STOP-guard reference)

| Metric | Value |
|---|---|
| Total snapshot rows | 118 |
| Backfill (Cohort B) | **43** (32 business + 11 silent) |
| Notify | **107** (75 Club + 32 Business) |
| Revoke | **54** (52 Club + 2 Business; expired AND user_id NOT NULL) |
| Silent backfill | **11** |

## Channel coverage (Бухгалтерия 32)
- both: 32 (100%)
- telegram_only: 0
- email_only: 0
- no_channel: 0

## DoD for execute
- snapshot_id фиксируется в каждом audit_log записи notify/revoke/backfill
- revoke_snapshot_bound=true для всех 118
- Repeat execute revoke = 0 new revokes (idempotent)
- silent (11) — НЕ уведомлять, НЕ ревочить, только backfill
