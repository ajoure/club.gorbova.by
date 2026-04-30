# Access Rules Nightly Reconcile — Execute Window Audit

**Date:** 2026-04-30 (Minsk)
**Function:** `access-rules-nightly-reconcile`
**Scope:** tariff_id `7c748940-dcad-4c7c-a92e-76a2344622d3` (Gorbova Club BUSINESS), 113 users / 1243 rule-pairs

## Pre-flight Baseline (dry_run=true)
- granted (missing) = 0
- extended = 4
- reactivated = 0
- condition_not_met_prior_purchase = 917
- failed = 0
- conflict_manual = 0
- conflict_multiple = 0
- runtime ≈ 26s

## Controlled Execute (dry_run=false)
- extended = 4 (записаны в access_grant_ledger, action_type=extend, reason_code=rule_engine_bonus)
- failed = 0
- conflict_manual = 0
- conflict_multiple = 0
- ledger source_subject_type = `cron_job`
- ledger source_event_type = `cron`
- ledger source_event_key prefix = `nightly_reconcile:2026-04-30:<run_id>:<rule_id>:<user_id>:<verb>`

## Post-execute Dry-run
- extended = 3 → классифицировано как **new_drift_after_execute**
  Причина: новые/обновлённые подписки (user `0d778566...`) появились между execute и повторным dry-run; это естественный production drift и зона ответственности именно nightly reconcile.
- failed = 0
- conflict_manual = 0
- conflict_multiple = 0

## DoD
- ✅ webhook-flow: одиночный путь → fallback `checkPriorPurchase` (без N+1)
- ✅ helper batch: `priorPurchaseCache` SOT = `orders_v2.status='paid'`, исключая `excludeOrderId`
- ✅ `grant-access-for-order` использует единый helper, отдельной inline product_access ветки нет
- ✅ ledger пишет корректные `source_subject_type`/`source_event_type` под check-constraints
- ✅ controlled execute прошёл без conflicts/failed
- ✅ new_drift_after_execute = 3 — допустимо, чинится cron'ом

## Decision
Cron 03:00 Minsk (00:00 UTC) включается с `dry_run=false`. New drift будет автоматически закрыт следующим запуском.
