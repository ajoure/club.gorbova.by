# INV-22 Block 1 — Backfill Executed (v3.1)

**Date:** 2026-05-02
**Snapshot:** `_inv22_overshoot_snapshot` v3.1
**Action:** `overshoot_fix_2026_05.access_backfilled`

## Reclassification (snapshot v3 → v3.1)
- 1 «Платная консультация» (`0df57f31`) → **skip** (silent backfill would extend past current_end_at)
- 7 «Подоходный налог ИП» silent → **business** (notify+backfill, no revoke), `correct_end_at = now()+48h grace`

## Final SOT v3.1
| Cohort | Rows | Notify | Backfill | Revoke |
|---|---|---|---|---|
| club | 75 | 75 | 0 | 52 |
| business | 39 | 39 | 39 | 2 |
| silent | 3 | 0 | 3 | 0 |
| skip | 1 | 0 | 0 | 0 |
| **Total** | **118** | **114** | **42** | **54** |

## Block 1 results
- subscriptions_v2 updated: **42 / 42** ✅
- entitlements updated: **41** (1 already aligned via LEAST guard)
- audit_logs inserted: **42** (1 per subscription)
- aligned post-update: **42 / 42** ✅

## Cohort overshoot stats
| Cohort | Rows | Avg overshoot | Max overshoot |
|---|---|---|---|
| business | 39 | 11.08 d | 51.40 d |
| silent | 3 | 59.79 d | 119.42 d |

## Next blocks
- **Block 2:** Notify edge function (Club 75 + Business 39 = 114), dry-run + execute
- **Block 3:** Revoke 54 dry-run with alternative-access guard
- **Block 4:** Revoke execute + verify

## Idempotency
Repeat Block 1 → 0 rows updated (subscriptions already aligned, entitlements LEAST blocks).
