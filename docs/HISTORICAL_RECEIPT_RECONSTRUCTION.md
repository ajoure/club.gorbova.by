# Historical receipt reconstruction: no new access

This prerequisite protects a future, separately reviewed bounded repair of
historical bePaid receipts that were attached to earlier purchases. It creates
no orders, payments, users, subscriptions, access, or repair markers by itself.

A financial reconstruction is not proof that a new deal granted access.
Original access and `access_grant_ledger` provenance remain on the original
parent; expired historical access is not restarted. Never set
`grant_status=success` or fabricate a grant ledger entry for a reconstructed deal.

## Marker contract

The future atomic data repair must write all fields, preserve the original
payment's amount/currency/paid_at/UID/identity, use canonical
`REBILL-${uid.slice(0,12)}`, and create its real financial repair audit:

```json
{
  "reconstructed_historical_deal": true,
  "historical_repair_run": "20261026_legacy_periodic_repair",
  "historical_access_mode": "retained_on_parent",
  "historical_parent_order_id": "<original parent UUID>",
  "parent_order_id": "<same original parent UUID>",
  "historical_receipt_payment_id": "<one existing receipt UUID>",
  "materialized_from_payment_uid": "<exact original UID>",
  "do_not_grant_access": true,
  "grant_status": "historical_retained_on_parent",
  "materialization_status": "reconstructed_historical_deal"
}
```

The guard independently checks the existing payment and original parent. Partial
markers, missing/deleted/duplicate rows, UID collisions, changed money, currency,
date, identities or refund status stop processing. A historical event with
missing or different receipt facts is held, never sent into a legacy fallback.
An uncertain database lookup also stops processing; it is not a missing marker.

## Runtime boundaries

- Authenticated webhook: before queue writes, rebill mode/cycle dispatch and
  provider synchronization. An exact replay receives a receipt acknowledgment,
  not access-delivery success. A mismatch receives `manual_review`.
- Rebill engine entry points: before `off`, `dry_run`, or `on`, using the guarded
  adapter; ordinary flow delegates to the unchanged shared engine.
- Exact recovery: validate arguments and queue snapshot, then acknowledge a
  reconstructed receipt with `fulfillment_verified=false` and zero writes.
  Queue status, processed provenance, attempts, error and retry remain unchanged.
- Archive import: before product or profile mutations, preserving queue history.
- Direct access writer: before standard, exact-target and 3DS branches. A marked
  historical deal cannot start an unpaid access period.

Managed deploys package only each function and `_shared`, so the small guard
module has byte-identical local copies in the five consumers. The guarded
REBILL entry module is identical in webhook and post-cancel packages.
`node scripts/payments/sync-historical-receipt-guards.mjs` checks the mirrors;
`--write` regenerates them after editing the canonical webhook copy. Contract
tests enforce both package isolation and mirror equality. `_shared` and the
independent CB21 release digest stay byte-identical. Managed deployment scope:
`bepaid-webhook`, `payments-reconcile`, `bepaid-archive-import`,
`grant-access-for-order`, `admin-materialize-post-cancel-charge`.
`bepaid-recover-payment` already returns `already_exists` on an existing UID;
`bepaid-auto-process` invokes the guarded `payments-reconcile` endpoint. Neither
needs an unrelated redeployment. No UI Publish is required for this backend fix.

## Gates before data repair

1. PR and CI pass, exact reviewed merged SHA deployed for all five consumers.
2. Safe runtime/source attestation proves the guards; do not replay real payment
   webhooks or invoke real grants as smoke tests.
3. Native SELECT-only dry-run and full-row CAS of exact payment/order/queue/
   attribution rows, including absence of conflicting UID/canonical deals.
4. Exclude unresolved provider-linkage conflicts, installment purchases and
   refund cases. Do not complete an unresolved queue to claim fulfillment.
5. Execute only the bounded committed SQL artifact through Lovable Cloud, with
   in-flight work excluded, idempotent re-entry and rollback on count/hash drift.
6. Read back exact receipt/deal links, month in Minsk, original money, parent
   paid amount, queue provenance, access/subscription fingerprints and actual
   financial audit. No new cash, access, provider changes, or client notices.

Until these gates pass, historical receipts remain on hold. This source patch
does not resolve a provider-linkage conflict or authorize any extra purchase.
