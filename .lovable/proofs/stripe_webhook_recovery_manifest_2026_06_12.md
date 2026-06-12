# Recovery manifest: stripe-webhook previous production bundle

**Date:** 2026-06-12
**Owner:** PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1 / Approve E
**Purpose:** immutable recovery source for the production bundle deployed
BEFORE the Approve E redeploy. Used for Шаг 15 (recovery procedure).

## Source of truth

- Repository git history.
- Baseline commit (parent of the first commit that introduced
  `_shared/stripe/card-extract.ts` / `card-enrichment.ts`):
  - **commit:** `43d58ba3ec3a721a11fe9472ff327940dd171597`
- First Approve-A commit (added `_shared/stripe/*`): `e2104c101032b6d9bcb74deea2e3220a7f75152c`
- At baseline `43d58ba3`:
  - `supabase/functions/_shared/stripe/card-extract.ts` — DOES NOT EXIST
  - `supabase/functions/_shared/stripe/card-enrichment.ts` — DOES NOT EXIST
  - `supabase/functions/stripe-webhook/index.ts` — 755 lines, inline card writers

## Previous bundle dependency closure (9 files)

```
sha256                                                              bytes  path
47293062b1d990e244cc739fc7e91171314a78c71f7662ed2fab029e464220d2     2649  supabase/functions/_shared/acquiring/stripe-signature.ts
2ba2e768222aa7424b4cc604896c4bd102a3c81456efd3d0ed1cb7b8f178f33e     2000  supabase/functions/_shared/acquiring/vault.ts
ef088048b6cc90d46ac2be19ccb502b0a5b73d5b1908cad34512752999df870d     5120  supabase/functions/_shared/consume-payment-link.ts
7fd3dd1a077ab8a22f34bd99cc2a3d607774e791977ed059fe3ff27679eed9dd     1555  supabase/functions/_shared/cors.ts
023217787f5bfd72b1c8f256797863e46d0bd8ea68ec8af292b5ef167580943f    14280  supabase/functions/_shared/crm-routing.ts
fd67abafac1a94a83167449895d1a6754514ffa6ad7e405ba65aacca8d479010     8778  supabase/functions/_shared/stripe-checkout-materialize.ts
8ad95b5ae38abab5f4b24d5cf5fe35e8583d37ce5f103b76adfe8ae6e28ca0d7     5681  supabase/functions/_shared/stripe-receipt-materialize.ts
35834a801fb681daaec83864c4a0011d121a92a3296aa4102bebe8574126432c    56497  supabase/functions/_shared/stripe-subscription-resolver.ts
5873c89cceb7d5638952b5c69ca8c57e01ea353d6fdd7bd50fc2c7c05fde55f1    31591  supabase/functions/stripe-webhook/index.ts
```

**Aggregate sha256 (tab-separated `path<TAB>hash<NL>`):**
`52b1f76bfa41323e86aec1ba929bbb1c296a2233037287f10cebe9a2c7505a04`

## Config baseline

`supabase/config.toml` block at HEAD:
```toml
[functions.stripe-webhook]
verify_jwt = false
```
No project-level / settings changes during Approve E.

## Recovery artifact storage

- Ephemeral working copy: `/tmp/stripe-webhook_recovery/<path>`
- **Immutable repo copy:** `.lovable/recovery/stripe-webhook/2026-06-12/`
  - `index.ts` — top-level previous `stripe-webhook/index.ts`
  - `closure/<path>` — full 9-file closure
  - `MANIFEST.txt` — hash list + aggregate
- Source verification: each file was extracted via `git show 43d58ba3:<path>`.
  No secrets are present in any of these files (sanitizer/manual review).

## Recovery procedure summary

To restore previous production bundle:
1. Delete `supabase/functions/_shared/stripe/card-extract.ts`
2. Delete `supabase/functions/_shared/stripe/card-enrichment.ts`
3. Delete `supabase/functions/_shared/stripe/card-enrichment.test.ts`
4. Restore `supabase/functions/stripe-webhook/index.ts` from
   `.lovable/recovery/stripe-webhook/2026-06-12/index.ts`
5. `supabase--deploy_edge_functions(["stripe-webhook"])`
6. Smoke `t=0/30s/2m` + record outcome.

No other shared files require restoration — all 8 other closure files
are byte-identical between baseline and HEAD (see Approve E proof §3 diff).
