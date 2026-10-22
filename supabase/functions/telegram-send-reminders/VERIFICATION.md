# Truthful renewal reminders

The old sender treated the latest `provider_managed` local row as a live
subscription, including unpaid checkout drafts. Its charge date came from a
separate user-wide query. This could promise automatic renewal after a one-time
purchase without an activated provider subscription.

The resolver now requires one paid active/trial period matching the user,
product and Telegram access boundary. Automatic wording additionally requires
one matching active/trialing provider record, the local auto-renew flag and a
future provider schedule. Drafts cannot select the wording. Unknown/conflicting
state suppresses the reminder and checkout. Finite installments are suppressed
here and remain handled by the existing installment reminders. The canonical
product renewability/checkout helpers are retained.

No customer mandate, payment method, subscription, tariff, entitlement, migration,
RLS or frontend is changed. No Publish is needed. The UI's local `next_charge_at`
label and broad historical billing audit remain outside this fix.

## Local checks

```sh
deno test --no-lock --node-modules-dir=none --allow-read supabase/functions/telegram-send-reminders/renewal-state_test.ts
deno check --no-lock --node-modules-dir=none supabase/functions/telegram-send-reminders/index.ts
git diff --check
```

26 tests pass, including legacy provider rows linked only by order and execution of the real HTTP handler with injected
read-only boundaries: preview cannot read bot tokens, create checkout, write,
send, expose recipient identifiers or bypass payments-view authorization.
The same suite/type check runs in the full release quality gate.

## Exact-SHA rollout

After all CI checks and merge, Lovable must synchronize the exact merged SHA
without authoring code and deploy only `telegram-send-reminders` with its local
resolver. Do not invoke the ordinary sending path for acceptance.

Authenticated admin/service request `{ "dry_run": true }` classifies the current
bounded reminder cohort. Optional `order_id` (UUID) restricts preview to that
order's user/product Telegram access, even outside the reminder window. Both
paths return counts/reason codes only, `sent: 0`, `writes: 0` and version
`tg-renewal-provider-state-v1`. Admin authorization requires payments view via
the existing section-access helper; ordinary user/anonymous preview is denied.
Typo/non-boolean `dry_run` or `order_id` outside preview is rejected.

For the authorized support case, resolve its order internally in Lovable;
never place customer identifiers in Git. Expect one manual classification,
zero automatic classifications and no messages, checkouts or changes to access.
Read back the existing customer flags and compare relevant message/order counts
before/after, distinguishing unrelated concurrent activity. Attest deployed
version and safe result separately from merge. Unknown state or source mismatch
blocks deployment/acceptance. Rollback redeploys only this function from the
previous attested revision; never repairs data or enables a mandate as rollback.

Production verification is pending until an exact-SHA deployment and dry-run
are completed. No real messages or payments were used in local tests.
