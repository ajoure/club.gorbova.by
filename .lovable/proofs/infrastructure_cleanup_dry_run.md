# Proof: Infrastructure Cleanup — Dry Run

Date: 2026-06-06  
Plan: `.lovable/plan.md` (Infrastructure Cleanup — Variant C applied)

## D1. Legacy ref search

```
$ rg -n 'ypwsuumurrtkxatoyqhk' -uu .
(no matches)
```

**Result:** ✅ 0 occurrences. Legacy ref absent everywhere (code, configs, workflows, docs, scripts, .lovable/, supabase/).

## D2. Workflow audit

| File | Trigger | project_ref | Status before | Status after |
|---|---|---|---|---|
| `apply-migrations.yml` | workflow_dispatch | `hdjgkjceownmmnrqqtuz` | active | **GATED** (confirmation required) |
| `deploy-functions.yml` | ~~push: main~~ + workflow_dispatch | `hdjgkjceownmmnrqqtuz` (env + secret) | **auto-deployed on every push** | **GATED** (push removed, confirmation required) |
| `functions-full-audit.yml` | workflow_dispatch | via `secrets.SUPABASE_URL` | manual audit | unchanged (read-only) |
| `verify-payment-methods.yml` | n/a | `hdjgkjceownmmnrqqtuz` | read-only | unchanged |
| `verify-webhook-public.yml` | push/pr | n/a (reads config.toml) | read-only | unchanged |
| `verify-webhook-runtime.yml` | dispatch+cron+after-deploy | `hdjgkjceownmmnrqqtuz` | read-only | unchanged |
| `verify-no-legacy-ref.yml` | push/pr/dispatch | n/a | did not exist | **NEW** — hard-fail guard |

Critical finding: `deploy-functions.yml` was running on every `push: main`. This is the second deploy pipeline that races Lovable agent-deploy and is the root suspect for `verify_jwt = false` regressions. Now neutralized.

## D3. Frontend env / config

```
.env:
  SUPABASE_URL="https://hdjgkjceownmmnrqqtuz.supabase.co"
  VITE_SUPABASE_PROJECT_ID="hdjgkjceownmmnrqqtuz"
  VITE_SUPABASE_URL="https://hdjgkjceownmmnrqqtuz.supabase.co"
supabase/config.toml:
  project_id = "hdjgkjceownmmnrqqtuz"
```

**Result:** ✅ canonical ref pinned everywhere.

## D4. Edge function hardcoded URLs

```
$ rg -n 'functions\.supabase\.co|[a-z0-9]{20}\.supabase\.co' supabase/functions/
(no matches)
```

**Result:** ✅ no hardcoded Supabase URLs in edge functions. All calls go through `Deno.env.get('SUPABASE_URL')` or relative invocation.

## D5. Stripe webhook endpoints (pending operator)

Pending list from Stripe Dashboard. Expected single canonical URL:

```
https://hdjgkjceownmmnrqqtuz.functions.supabase.co/stripe-webhook
```

Operator action required (V7a / V7b).

## D6. Lovable backend

Single backend = Lovable Cloud, project_ref `hdjgkjceownmmnrqqtuz`. No second Supabase connector linked.

## Actions taken (Execute)

1. ✏️ `.github/workflows/deploy-functions.yml`: removed `push: main` trigger, added confirmation-gate step (`i_understand_risks=yes` required).
2. ✏️ `.github/workflows/apply-migrations.yml`: added `i_understand_risks` input + confirmation-gate steps for both `migrate` and `deploy-functions` jobs.
3. ➕ `.github/workflows/verify-no-legacy-ref.yml`: new hard-fail guard for legacy ref + canonical config.toml pin.
4. ➕ `.lovable/architecture/canonical_infrastructure_v1.md`: SOT for canonical infrastructure.
5. 🚫 No edge function changes. No DB migrations. No agent-deploy of webhook functions.

## DoD checklist

- [x] V1 — legacy ref grep returns 0 (already 0; CI guard added).
- [x] V2 — all workflows reference `hdjgkjceownmmnrqqtuz` or are read-only / gated.
- [x] V3 — `supabase/config.toml` pinned.
- [x] V4 — `.env` pinned.
- [ ] V5 — **deliberately skipped** (agent-deploy of webhook functions is unsafe until platform issue resolved; per modification #1).
- [ ] V6 — requires running `verify-webhook-runtime.yml` (operator action; no deploy was done, so current runtime state unchanged).
- [ ] V7a / V7b — Stripe endpoints list and cleanup (operator action).
- [x] V8 — canonical doc + this proof written.

## Required operator follow-ups

1. **U2 / V7a:** send list of current Stripe webhook endpoints from Stripe Dashboard.
2. **V7b:** delete any Stripe endpoint that is not the canonical URL.
3. **Lovable platform escalation:** open issue "agent-deploy ignores `verify_jwt=false` for webhook functions" with proof from prior `verify-webhook-runtime.yml` failure (project_ref, function name, timestamp, 401 body).
4. Phase 3.4 Runtime G33–G40 remains **FROZEN** until V6 + V7 are PASS.
