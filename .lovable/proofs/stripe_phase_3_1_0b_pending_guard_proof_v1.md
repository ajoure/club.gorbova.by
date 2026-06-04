# Phase 3.1.0-B — Pending Guard + Cleanup Proof

Дата: 2026-06-04
Статус: helper + cleanup function задеплоены. Runtime gates через test fixtures выполняются в Phase 3.1 MVP до первого реального wiring.

## Что задеплоено

| Артефакт | Файл | Назначение |
|---|---|---|
| `checkPendingCheckoutConflict` | `supabase/functions/_shared/subscription-conflict.ts` (append, add-only) | Read-only guard: pending<24h → `pending_conflict`; pending≥24h → `stale_pending`; иначе `no_pending`. Никаких UPDATE. Возвращает `subscription_v2_id`, `created_at`, `age_minutes`, `order_id`, `provider_subscription_id`, `provider`, `recommended_action`. |
| `PENDING_TTL_MS = 24h` | то же | TTL источник = `created_at`. |
| `admin-cleanup-stale-pending-subscriptions` | `supabase/functions/admin-cleanup-stale-pending-subscriptions/index.ts` | super_admin, dry_run по умолчанию; execute без `allow_real` — только `meta.test_fixture=true`; strict-filtered DELETE provider_subscriptions Stripe-placeholder; bePaid не трогает. |
| config.toml | `supabase/config.toml` | `[functions.admin-cleanup-stale-pending-subscriptions] verify_jwt = true`. |

## Stage A проверки

```sql
SELECT count(*) FROM subscriptions_v2 WHERE status='pending';
-- → 0
```

Никаких существующих pending. Guard и cleanup безопасны для запуска.

## Жёсткие правила (проверены кодом)

1. ✅ Условие блокировки = `(user_id, product_id, tariff_id, status='pending')`. Provider не в условии.
2. ✅ Guard read-only.
3. ✅ `CONFLICTING_STATUSES` / `TERMINAL_STATUSES` не изменены — bePaid семантика идентична.
4. ✅ Cleanup execute без `allow_real` — только `meta.test_fixture=true`.
5. ✅ Cleanup DELETE на `provider_subscriptions` — `provider='stripe' AND state='pending' AND provider_subscription_id LIKE 'pending:%' AND subscription_v2_id=<id>`.
6. ✅ Cleanup НЕ зовёт bePaid/Stripe API.
7. ✅ Никаких изменений schema / RLS / RPC / grants.
8. ✅ Cron не создаётся.

## Runtime gates (закрываются в Phase 3.1 MVP до wiring real writer)

- [ ] G1. Test fixture pending (now): guard → `pending_conflict`, `recommended_action='reuse_or_block'`.
- [ ] G2. Test fixture pending (now-25h): guard → `stale_pending`, `recommended_action='cleanup_candidate'`, БД не изменена.
- [ ] G3. Нет pending: guard → `no_pending`.
- [ ] G4. bePaid non-regression: `subscription-conflict_test.ts` PASS.
- [ ] G5. Access non-regression: pending не появляется в access-resolver / reminders / Telegram queue.
- [ ] G6. Cleanup dry_run: корректные счёты found/test_fixtures/real_rows/would_change.
- [ ] G7. Cleanup execute (test fixture): pending → expired, `meta.lifecycle.timeout_reason='checkout_abandoned'`, audit_log запись, bePaid не дёргался.
- [ ] G8. expired pending: не даёт доступ, не блокирует новый checkout (guard читает только status='pending'), не попадает в reminders/Telegram (whitelist active/trial/past_due).

## Counts before/after deploy

```
subscriptions_v2 status counts: UNCHANGED по всему живому enum (active/trial/past_due/canceled/expired/superseded/expired_reentry/pending=0).
```

Helper deploy схему не меняет.

## DoD

- ✅ Helper exists + exported.
- ✅ Cleanup function deployed, super_admin, dry_run default, test_fixture guard.
- ✅ bePaid path не изменён.
- ✅ plan.md обновлён.
- 🟡 Memory update — **candidate** (отдельный approve, не делается автоматически).
- 🟡 Runtime gates G1–G8 — закрываются в Phase 3.1 MVP до wiring real writer.

## Разблокирует

Phase 3.1.1 Price Mapping STOP-GATE — после фиксации Stage C runtime gates через test fixtures.
