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
- `never_charged_expired` — provider expired, никогда не списывалось
- `previously_charged_expired` — provider expired, были списания
- `never_charged_redirecting` — застряло на 3DS, без списаний
- `previously_charged_redirecting` — 3DS после успешных списаний (редкий случай)
- `active_no_dates` — provider active, обе даты NULL (snapshot протух)

## Resolution Protocol
1. **Read** через `system-health-inv22-plan` (super_admin JWT, read-only). Возвращает план action per row.
2. **48-hour grace** для `*_redirecting`: возраст `< 48ч` → `skip_too_fresh`, не трогать (см. mem://infrastructure/access/revoke-race-condition-guard).
3. **Pull-then-decide** (`active_no_dates` и любой execute): сначала вызвать `bepaid-get-subscription-details` по `provider_subscription_id`. Это обновит provider_subscriptions из bePaid.
4. **Re-read** provider_subscriptions. Если bePaid вернул живую — НИЧЕГО локально не менять.
5. **Close locally** (только если provider всё ещё мёртв):
   - `subscriptions_v2.auto_renew = false`
   - `subscriptions_v2.status = 'canceled'`
   - `subscriptions_v2.canceled_at = now()`
   - `subscriptions_v2.cancel_reason = 'inv22_provider_dead_local_active'`
   - `provider_subscriptions.state` — НЕ переписывать (оставить provider truth)
6. **Telegram-доступ и `access_end_at` НЕ трогать.** Это отдельное решение владельца.
7. **Audit per row**: `inv22.repair_provider_dead_local_active` (или `inv22.resolve.<outcome>` для прочих исходов) с `before/after/pull_result/delegated_to/bucket/age_hours`.

## Запрещено
- Прямые `UPDATE provider_subscriptions SET state=...` для лечения INV-22 (provider state — single source of truth).
- Авто-ревок Telegram/entitlements в рамках INV-22 resolve.
- Bulk-execute без `confirm:true` и без `subscription_ids`.

## SOT files
- RPC: `public.inv22_subscription_desync` (миграция от 2026-04-29)
- Detector report: `supabase/functions/nightly-payments-invariants/index.ts` (с разбивкой по buckets в Telegram alert)
- Plan: `supabase/functions/system-health-inv22-plan/index.ts`
- Resolve: `supabase/functions/system-health-inv22-resolve/index.ts`
- UI: `src/components/admin/payments/Inv22ResolverPanel.tsx` (встроен в `AutoRenewalsTabContent`)
- Classification: `src/lib/system-health/invariant-humanize.ts` → `INV-22 = critical_fix`

## Verification (DoD)
После execute:
```sql
SELECT count(*)
FROM subscriptions_v2 s
JOIN provider_subscriptions ps ON ps.subscription_v2_id = s.id
WHERE s.status='active' AND s.auto_renew=true AND s.access_end_at > now()
  AND (ps.state IN ('expired','redirecting')
       OR (ps.state='active' AND ps.next_charge_at IS NULL AND ps.last_charge_at IS NULL));
```
должен вернуть 0 (или меньше с обоснованием по каждой оставшейся: либо `skip_too_fresh`, либо `pull_failed`).
