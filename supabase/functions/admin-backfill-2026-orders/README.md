# Historical payment recovery

Admin-only, explicit-ID recovery for confirmed bePaid and Stripe payments that
are missing all or part of the canonical business chain.

## Safety contract

- `payment_ids` is mandatory (1–50 exact `payments_v2.id` values).
- `dry_run` defaults to `true`.
- Refunds, voids, fees, zero-value, manual and synthetic records are rejected.
- A new order is created only when product, tariff and offer are resolved from
  payment/provider evidence. The customer's last purchase is never used as a
  guess.
- Existing orders are reused and sent through the same
  `grant-access-for-order` fulfillment path.
- Re-running the same payment reuses `payments_v2.order_id` or the recovery
  marker on `orders_v2`; it does not create another sale.

## Production runbook

1. Produce the exact candidate list with payment, provider, profile and mapping
   evidence.
2. Invoke with `{ "dry_run": true, "payment_ids": [...] }`.
3. Review every `manual_review` reason. Do not execute ambiguous rows.
4. Invoke the approved subset with `dry_run: false`.
5. Verify for every payment:
   - `payments_v2.order_id` is populated;
   - the linked `orders_v2` row is paid and has product/tariff/offer;
   - `access_grant_ledger` contains the canonical outcome;
   - the expected entitlement/subscription and Telegram grant exist;
   - GetCourse result is recorded in the response (it is best-effort and may
     require a separate retry).

The function does not scan or mutate the whole payment table by itself. Broad
discovery and the final production invocation must remain separate steps.
