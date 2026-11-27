# PR766 payment reallocation: focused read-only review (merged b4b90a42)

Verdict: CONDITIONAL PASS. Money, amount, period, ACL and the canceled provider all PASS. One high-severity operational finding (F1) needs root's decision before the migration is applied. Nothing was changed.

## Source
- HEAD `b4b90a42d` = merge of PR766 (`65feb6087`) on top of `78bf69c38`. Tree clean.
- Migration `supabase/migrations/20261126133000_contact_payment_reallocation.sql`: 365 lines, sha256 `1ec264cf63d2fa632ad21e2784bf2f789625ec08994856e0c06b13f5c5949664`.
- Diff 78bf69c3..b4b90a42: 13 files. Edge runtime code: `grant-access-for-order/index.ts` (+14), new `_shared/payment-reallocation-replay.ts`, digest-only `_shared/cb21-release.ts` and preflight manifest. UI: `PaymentReallocationDialog` and the button in `ContactPaymentsTab`.

## Migration scope
- New table `payment_reallocations`: RLS on, no policies, revoked from public/anon/authenticated, service_role select only.
- `payment_reallocation_graph`: SECURITY DEFINER, `search_path=pg_catalog,public,pg_temp`, EXECUTE revoked from public/anon/authenticated.
- `admin_preview_*`, `admin_commit_*`, `admin_get_*`: SECURITY DEFINER, check `auth.uid()` + `has_role_v2` admin/super_admin (errcode 42501), EXECUTE for authenticated only.
- Trigger function `guard_payment_reallocation_projection` plus 7 `zz_payment_reallocation_guard` triggers on orders_v2, subscriptions_v2, entitlements, telegram_access_grants, telegram_access, access_grant_ledger, entitlement_sources.

## Guards (source)
- Amount: payment, order, allocation and item are all exactly 250 BYN, refunded 0, single payment, single allocation and single group item. No refunds, referral attributions or credits. No payments row is written. Post-check compares the payment and provider-set md5 before and after.
- Period: target end must fall in [paid_at, paid_at+2d], and target_end+30d must be in the future. Source end = old −1 calendar month. The receipt must be ≤7 days old. A legitimate previous Club order with a succeeded 250 payment is required.
- Canceled BBB: an expired target needs auto_renew=false, a provider in state `canceled`, and no active/trial/pending provider. Provider rows are only locked and hashed, never written (`provider_cancellation_included=false`).
- Bonus: same join as root's (user_id + target_product_id + source_order_id + `rule_engine_bonus` + `extended` + exact expiry). Rejects later granted/extended/reactivated rows and entitlement_sources. Exactly 10 distinct are required.
- Concurrency: advisory lock per payment, FOR UPDATE on the user's graph, before_hash compare, idempotent request_id/payment_id replay. A PG17 test covers 13 stale interleavings, the lock-wait case, double submit and audit rollback.
- Edge guard: an order with `payment_reallocation_request_id` gets `retained` (200 skip) only with a matching applied proof. Otherwise it returns 409 fail-closed.
- UI: admin-only. Saves the request id before sending, and an unknown result blocks a retry.

## Live graph (read-only, 2026-11-27 18:30 UTC). Every graph precondition holds
- Payment `a0909ea9…`: succeeded, 250, refunded 0, paid_at 2026-11-25 06:26:26 UTC. 1 payment and 1 allocation on the order. Refund requests, referral attributions and referral credits: all 0. CRM automation rules: 0.
- Order `db763045…`: paid 250/250, Club product, access_days 30.
- Club sub `33054404…`: active until 2027-01-10 12:00, auto_renew false, extended_by_orders = [`0c66f431…`, `db763045…`]. Prior order `0c66f431…` has a succeeded 250 payment from 2026-11-10 (plus one failed attempt, which is allowed).
- BBB sub `f51fec1e…`: expired, ends 2026-11-26 20:59:59, auto_renew false. Provider `6a88f21a…` is `canceled`. No active/trial/pending provider exists for Club or BBB.
- Entitlements: Club active until 2027-01-10 on this order. BBB expired until 2026-11-26 20:59:59. entitlement_sources 0.
- Bonus: 10 rows / 10 distinct, min previous 2026-12-10 12:00Z, max new 2027-01-10 12:00Z. Matches root.
- Telegram: 3 active Club grants (ends 11-10, 12-10, and 2027-01-10 for this order); max of the others = 12-10 = source_new_end. telegram_access rows: 2.
- Target BBB offer: exactly 1 active pay_now full_payment 250.
- Planned result: Club → 2026-12-10 12:00Z. BBB 2026-11-26 20:59:59 → 2026-12-26 20:59:59 (active).

## Baselines (before migration)
- Drizzle history 44. Reallocation functions 0, table absent, guard triggers 0.
- User-defined triggers on the 7 guarded tables: 23, md5 of their defs `5c337de19e1c6d98150ba305d296c5b1`.
- `has_role_v2(uuid,text)` def md5 `6806d51a78bd1567a745dfcc15247530`.
- Payment row md5 `b4f19bbba266a4666a8d7ea738eca636`, order md5 `34a995fa5210a46ffa8b82e6ad99327e`, user provider-set md5 `76c4e6d4a304e426c7159804c73b4c98`. These differ from the 26.11 values because a different column set was hashed then; the server before_hash is what's authoritative.

## Findings
- F1 (HIGH, operational, needs root decision): the guard trigger is a permanent per-user fence with no end. After commit, for this user:
  - Any `telegram_access` update whose active_until differs from the max active subscription end raises an error. That includes `telegram-revoke-access` (sets null while a sub is still active, e.g. a manual revoke or ban) and `telegram-check-expired` (sets an endAt from another access source).
  - Any new entitlement INSERT for Club, BBB or the 10 bonus products is refused.
  - A subscription update that rewrites meta without the request id is refused.
  - So later normal revokes, syncs or grants for this one user may fail with an exception instead of applying. This does not affect money, but it can block access enforcement. Options: (a) accept and document a manual workaround, (b) a follow-up PR that limits the fence to the corrected windows/time, or to the grant-access-for-order and reconcile paths.
- F2 (time-bound): the receipt-age guard expires 2026-12-02 06:26 UTC. After that, preview and commit will refuse.
- F3 (info): the fingerprint covers all of the user's orders, payments and ledger (9539 rows). Any unrelated change between preview and commit gives `reallocation_preview_changed`. That is safe; just re-preview.
- No critical money/ACL finding.

## Planned execute (only after separate approval and root's decision on F1)
1. Verify HEAD is exactly the approved SHA and the baselines above.
2. Apply only `20261126133000_contact_payment_reallocation.sql` byte-identical via managed migration: history 44 → 45, +1 table, +4 functions, +1 trigger fn, +7 triggers (23 → 30).
3. Deploy only `grant-access-for-order`.
4. Scoped readback: payment/order/provider hashes unchanged; bonus 10; Club/BBB rows unchanged; payment_reallocations 0. Unauthenticated RPC → denied.
- Expected after a later admin commit (not part of this stage): payments 0 changed/0 created; allocation unchanged; 1 order + 1 group + 1 item re-pointed; 2 subscriptions; 12 entitlements; 1 Telegram grant; 2 telegram_access rows; 1 reallocation row; 1 audit row; provider rows unchanged.
