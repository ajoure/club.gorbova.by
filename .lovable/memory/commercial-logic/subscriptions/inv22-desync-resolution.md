---
name: inv22-desync-resolution
description: Definition + safe resolution protocol for zombie subscriptions found by INV-22 (subscriptions_v2 active+auto_renew while provider_subscriptions terminal or dateless)
type: feature
---

# INV-22: Zombie Subscriptions Resolution Standard

## Definition (zombie subscription)
`subscriptions_v2.status='active' AND auto_renew=true AND access_end_at>now()`
JOIN `provider_subscriptions` where:
- `ps.state IN ('expired','redirecting')`, OR
- `ps.state='active' AND next_charge_at IS NULL AND last_charge_at IS NULL`

Канонический детектор: `public.inv22_subscription_desync(p_limit int)` — RPC возвращает `count`, `by_bucket`, `samples` (с `bucket` и `age_hours`).

## Buckets
- `never_charged_expired`, `previously_charged_expired`, `never_charged_redirecting`, `previously_charged_redirecting`, `active_no_dates`.

## Resolution Protocol
1. **Read** через `system-health-inv22-plan` (super_admin JWT, read-only).
2. **48-hour grace** для `*_redirecting`: возраст `< 48ч` → `skip_too_fresh`.
3. **Pull-then-decide**: вызвать `bepaid-get-subscription-details`, обновить provider_subscriptions.
4. **Re-read**: если bePaid вернул живую — НИЧЕГО не менять.
5. **Close locally** (provider всё ещё мёртв):
   - `subscriptions_v2.auto_renew=false`, `status='canceled'`, `canceled_at=now()`, `cancel_reason='inv22_provider_dead_local_active'`.
   - `provider_subscriptions.state` НЕ переписываем.
6. **Telegram-доступ и `access_end_at` НЕ трогать.**
7. **Audit per row** в `audit_logs` обязателен:
   - action: `inv22.repair_provider_dead_local_active` (или `inv22.resolve.<outcome>`).
   - колонки: `actor_user_id`, `target_user_id`, `actor_type='user'`, `actor_label`, `meta` (НЕ `actor_id`/`target_id`/`metadata`/`target_type` — таких колонок в `audit_logs` НЕТ).
   - meta содержит: `subscription_id`, `provider_subscription_id`, `before`, `after`, `pull_result`, `pull_error`, `delegated_to`, `outcome`, `bucket`, `age_hours`.
   - **HARD requirement**: `.error` от insert обязателен к проверке. Fail audit → outcome `audit_failed`, response HTTP 207, `audit_failures>0`.

## Запрещено
- Прямые `UPDATE provider_subscriptions SET state=...` для лечения INV-22.
- Авто-ревок Telegram/entitlements/access_end_at.
- Bulk-execute без `confirm:true` и без `subscription_ids`.
- Silent audit insert без проверки error (ловится INV-22-AUDIT invariant).

## SOT files
- RPC: `public.inv22_subscription_desync`
- Plan: `supabase/functions/system-health-inv22-plan/index.ts`
- Resolve: `supabase/functions/system-health-inv22-resolve/index.ts` (audit columns fixed 2026-05-13)
- Nightly + audit-trail invariant: `supabase/functions/nightly-payments-invariants/index.ts` (`INV-22` + `INV-22-AUDIT`)
- UI: `src/components/admin/payments/Inv22ResolverPanel.tsx`

## Verification (DoD)
- `inv22_subscription_desync.count = 0`.
- За каждый closed_provider_dead row: запись в `audit_logs` с `action='inv22.repair_provider_dead_local_active'` и `meta.subscription_id=<sub_id>`.
- `INV-22-AUDIT` invariant в nightly-check: `passed=true`, `count=0` missing.
