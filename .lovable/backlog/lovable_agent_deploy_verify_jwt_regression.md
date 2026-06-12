# Backlog: Lovable agent-deploy ignores per-function verify_jwt=false

**Status:** UNDER RE-VERIFICATION (2026-06-12)
**Previous status:** ESCALATED, awaiting Lovable response (2026-06-06)
**Created:** 2026-06-06
**Blocks:** Phase 3.4 Runtime G33–G40 (Stripe replay + dunning runtime), any
            webhook redeploy via agent-deploy.

## 2026-06-12 update

External read-only probe (see
`.lovable/discovery/public_webhook_deploy_layer_v1.md`) shows that all 8
public webhook functions, including `stripe-webhook`, currently respond
with application-level errors — no `UNAUTHORIZED_NO_AUTH_HEADER`. The
2026-06-06 regression either self-resolved or the conditions for its
reproduction have changed. Repository now declares explicit
`[functions.<fn>] verify_jwt = false` blocks for all 8 webhooks (EXPECTED
config contract).

This is NOT proof that current agent-deploy honours `verify_jwt = false`
on redeploy. Controlled canary redeploy is required
(PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1, Approve C) before the moratorium
can be revisited. Until then, no webhook function may be redeployed via
the agent.


## Summary

Lovable Cloud agent-deploy (`supabase--deploy_edge_functions`) does not apply
per-function `verify_jwt = false` from `supabase/config.toml`. As a result,
any webhook function redeployed via the agent ends up behind the Supabase
Functions Gateway JWT wall and returns platform-level 401
(`UNAUTHORIZED_NO_AUTH_HEADER`) for unauthenticated POSTs from external
providers (Stripe, bePaid, Telegram, etc.).

## Current impact

- `stripe-webhook` is in platform-401 state from a prior controlled-redeploy
  experiment. **Not recoverable from our side** (no `SUPABASE_ACCESS_TOKEN`,
  Lovable-managed Supabase).
- Moratorium in effect: no agent-redeploy of any webhook function until
  Lovable provides a workaround. See
  `.lovable/architecture/canonical_infrastructure_v1.md` §8.

## Proof

- Reproduction (deterministic, 3 probes at t=0s / 30s / 2m all FAIL with the
  same platform-401):
  `.lovable/discovery/stripe_webhook_redeploy_d2_bis_v1.md`
- Verification artifact:
  `.lovable/proofs/stripe_phase_3_4_d2_bis_webhook_runtime_v1.md`
- Runtime guard that detects the regression:
  `.github/workflows/verify-webhook-runtime.yml`

## What we do NOT do

- Do not call `supabase--deploy_edge_functions` for any `*-webhook` name.
- Do not ask the operator for Supabase secrets.
- Do not try GitHub Actions deploy (it is a no-op stub by policy).
- Do not change webhook source code in an attempt to "work around" platform-401.

---

## Copy-paste text for Lovable support

Operator: copy the block below into Lovable support / platform issue tracker.
The agent has no direct support channel — submission is operator-side.

```
Title: agent-deploy ignores per-function `verify_jwt = false` in supabase/config.toml

Project ref: hdjgkjceownmmnrqqtuz
Lovable project ID: 796a93b9-74cc-403c-8ec5-cafdb2a5beaa
Affected functions: all *-webhook (confirmed on stripe-webhook)

Expected: after agent-deploy, POST without signature to
  https://hdjgkjceownmmnrqqtuz.functions.supabase.co/stripe-webhook
returns application-level 400 with body `signature_verification_failed`.

Observed: returns platform-level 401 with body
  {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
This is the Supabase Functions Gateway JWT wall, injected because the
deploy did not apply per-function `verify_jwt = false` from
supabase/config.toml.

Reproduction (deterministic, 3 probes at t=0s/30s/2m all FAIL with the
same platform-401):
1. config.toml has `verify_jwt = false` for `stripe-webhook` (line 282)
2. Trigger agent-deploy of `stripe-webhook` only
3. POST without signature -> platform-401

Proof attached: .lovable/proofs/stripe_phase_3_4_d2_bis_webhook_runtime_v1.md
Discovery:    .lovable/discovery/stripe_webhook_redeploy_d2_bis_v1.md

Requested workaround (any one):
(a) flag at agent-deploy time: "respect config.toml verify_jwt"
(b) per-function verify_jwt setting in Lovable Cloud UI
(c) gateway-level allowlist for webhook functions

Impact: Stripe webhook (and any redeployed webhook) is unreachable by
external providers until restored. We have no canonical recovery path
without this fix - CLI-based recovery via `supabase functions deploy
--all` is not available to us because the project is Lovable-managed
and we have no SUPABASE_ACCESS_TOKEN.

Phase 3.4 Runtime is FROZEN until Lovable responds.
```
