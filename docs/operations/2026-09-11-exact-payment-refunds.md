# Возврат конкретного платежа и сведение рассрочки

GitHub first. Production owner: Lovable Cloud, project 796a93b9-74cc-403c-8ec5-cafdb2a5beaa. Target database hdjgkjceownmmnrqqtuz.

## Deployment

1. Merge only after the release quality gate passes. Sync the exact merged SHA.
2. Apply `supabase/migrations/20260910191115_exact_payment_refund_requests.sql`. Managed copy may use a fresh timestamp but identical SQL bytes. Verify service-only grants, RLS, exact RPC definitions. No business data modifications in this migration.
3. Deploy exactly `subscription-admin-actions` and `stripe-admin-refund`. Verify unauthenticated calls fail 401 and authenticated read-only `refund_preflight` works through RefundDialog.
4. Publish, then verify the actual per-payment refund controls on desktop and mobile.
5. From the owner UI, open the refund dialog for payment `1ad28122-537a-4272-8cc4-7df4cf4bd6ac`, order `9673e359-e98e-4e7e-8196-f31f60b4e16d`, and click **Проверить в bePaid**. This is GET only. Record timestamps, HTTP, exact transaction amount/currency match and terminal states of both `sbs_9a86268a608fca3f` and `sbs_bd6975629dfe2c83`. No actual refund click or provider writes for smoke.
6. Only after fresh provider proof, run the adjacent `2026-09-11-installment-refund-repair.sql` as a managed transaction, first with ROLLBACK, then exact apply. Any guard failure stops the batch. Read back one visible order at 1325 BYN, three intact positive payments totaling 1989, third marked for refund, both provider subscriptions canceled, inactive link and unchanged access through 2027-06-07. Verify repeat application does no writes.

The refund itself requires a separate explicit monetary instruction; it is not a smoke test. The repair does not fabricate a refund or reduce the factual paid total. The remaining overpayment is marked for review and cannot be automatically collected again.

## Cause supported by production audit

29 July: first 663 BYN on the original two-cycle mandate. 11 August: `public_link_replace` canceled the original mandate, then created another two-cycle mandate four seconds later. Its counter restarted at zero; 11 August and 10 September payments completed that second mandate. The previous payment was not credited to the replacement schedule. Local states are canceled and completed, auto-renew false and next-charge null; fresh provider GET confirmation remains mandatory.

The existing repayment workflow calculates remaining debt from the original order. This repair invalidates the stale reusable sale link. It does not claim to audit every historical replacement link on the platform.

## Validation

- Full Vitest suite: 241 files, 1643 tests passed.
- Browser TypeScript, Deno checks for both deployed functions, production build passed.
- PGlite: 46 checks covering service-only permissions, exact parent, amount precision and remainder, stable request key, concurrent request exclusion, ambiguous provider result, canonical idempotency, three successive partial refunds and legacy refund rows.
- PGlite command: `node scripts/verify-exact-refund-reservation.mjs /path/to/@electric-sql/pglite/dist/index.js`.
- Production visual and provider checks must be recorded after deployment; local checks do not prove publication.

## Fresh provider correction, 11 September

Owner UI direct GET at 01:03:40 Warsaw confirmed B still active with next charge 10 October despite local completed state. The repair must now require B canceled after the exact provider cancellation, followed by another GET. Do not treat local completed as provider proof. Existing cancellation preserves paid access; no refund is part of this operation.
