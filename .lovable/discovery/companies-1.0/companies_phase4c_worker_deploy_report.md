# Phase 4C — Company Sync Worker Deploy Report

**Version:** 1.0
**Status:** ✅ PASS — handler deployed, activation deferred to Phase 4D
**Scope:** Deploy-only. Edge Function `company-sync-worker` is installed but
**not scheduled**. No cron job created. No data mutations. Queue empty. Phase 3
baseline 16 / 17 / 17 / 16 preserved.

Plan reference: `.lovable/discovery/companies-1.0/companies_phase4_queue_worker_plan.md`
§§3.5, 3.6, 4.3, 5 (M-Edge-deploy only), 6, 8, 9.

---

## 1. Preflight (before any change)

| Check | Expected | Actual |
|---|---|---|
| companies | 16 | ✅ 16 |
| client_legal_details_company_map | 17 | ✅ 17 |
| company_contacts (`is_billing_contact=true`) | 17 | ✅ 17 |
| `public_id_sequences.company` | 16 | ✅ 16 |
| company_sync_queue rows | 0 | ✅ 0 |
| company_sync_queue where status ∈ (`failed`,`dead_letter`) | 0 | ✅ 0 |
| `pg_extension` contains `pg_cron` | yes | ✅ yes |
| `pg_extension` contains `pg_net` | yes | ✅ yes |
| `crm_company_backfill_billing_cld` `md5(pg_get_functiondef)` | `36b5ee9763bb813b66dec59df53102d6` | ✅ match |
| `supabase/functions/company-sync-worker/` present before | no | ✅ absent |

All guards satisfied → deploy proceeded.

---

## 2. Artefacts introduced this phase

| Artefact | Location | Kind | Notes |
|---|---|---|---|
| Edge Function | `supabase/functions/company-sync-worker/index.ts` | Deno handler | verify_jwt = false (platform default); auth enforced in code |
| Runtime secret | `PHASE4_WORKER_SHARED_SECRET` | 64-char generated via `secrets--generate_secret` | Never revealed, never logged, never written to Git |

Nothing else. No new SQL, no new grants, no cron job, no UI, no changes to
`companies` / `client_legal_details_company_map` / `company_contacts` /
`crm_company_backfill_billing_cld` / `crm_company_link_contact` /
`crm_company_sync_enqueue|worker_claim|worker_complete`.

---

## 3. Endpoint protection (trust boundary)

Four layered checks; every one must pass before any Supabase RPC is called.

1. **Method gate** — only `POST` accepted. `OPTIONS`, `GET` → `405 method not allowed`. No CORS headers returned (server-to-server; not browser-callable).
2. **Shared-secret gate** — `X-Worker-Secret` header must equal
   `Deno.env.get("PHASE4_WORKER_SHARED_SECRET")`. Comparison is length-guarded
   and constant-time (per-char XOR). Missing / empty / wrong secret → `401
   {"error":"unauthorized"}`. Neither the expected nor the provided value is
   logged; only two booleans (`has_expected`, `has_provided`).
3. **Config gate** — `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be
   present in the runtime env; missing → `500 {"error":"config_missing"}` with
   no key material in the response or logs.
4. **DB-side gate** — even if a caller passes checks 1–3, every downstream
   RPC (`crm_company_sync_worker_claim`, `crm_company_sync_worker_complete`,
   `crm_company_backfill_billing_cld`) has `EXECUTE` restricted to
   `service_role` only (asserted by Phase 4B postflight, `pg_proc.proacl`).
   The worker uses the service-role client built from the env-injected key —
   the key is never sent in the request and never returned to the caller.

Nothing about the trust boundary depends on browser origin or user JWT, so
`verify_jwt = false` is safe here.

---

## 4. Runtime smoke checks (no DML)

Executed against the deployed endpoint:

| # | Request | Expected | Actual |
|---|---|---|---|
| S1 | `POST` without `X-Worker-Secret` | 401 `unauthorized` | ✅ 401 `{"error":"unauthorized"}` |
| S2 | `POST` with a wrong `X-Worker-Secret` value | 401 `unauthorized` | ✅ 401 `{"error":"unauthorized"}` |
| S3 | `GET` | 405 `method not allowed` | ✅ 405 `method not allowed` |
| S4 | Positive-path (`X-Worker-Secret` = real value, `{"dryRun":true}`) | 200, `claimed=0`, no queue mutation | not executed from this session (see §5) — deferred to Phase 4D rehearsal |

`SUPABASE_SERVICE_ROLE_KEY` is not accessible in Lovable-managed sandbox chat
tooling, and `PHASE4_WORKER_SHARED_SECRET` is stored encrypted and never
revealed by `generate_secret`. That is the intended trust boundary and it is
what prevents any accidental invocation from this environment. The positive
path will be exercised in Phase 4D through the same protected Edge Function
+ pg_cron mechanism approved for production.

Postflight after S1–S3:

```
postflight: companies=16 / maps=17 / billing_contacts=17 / seq=16
company_sync_queue rows = 0
company_sync_queue where status in ('failed','dead_letter') = 0
crm_company_backfill_billing_cld md5 = 36b5ee9763bb813b66dec59df53102d6   (unchanged)
```

Baseline invariant **preserved**.

---

## 5. Deferred activation (Phase 4D scope, NOT this phase)

Per plan §5 step 6+7 and §12, none of the following was executed in Phase 4C
and remains blocked pending a separate admin approval:

- `cron.schedule('company-sync-worker-tick', '* * * * *', …)` via
  `supabase--insert` (per plan §4.4). The worker will not tick until this cron
  is installed.
- Any real `crm_company_sync_enqueue(...)` call — historical Phase 3 CLDs are
  intentionally **not** enqueued. Queue remained 0 throughout.
- Full T-matrix (T1..T12 from plan §9): happy / idempotency / retry /
  concurrency / lease-expiry / poison / unsupported-reason / map-mismatch. All
  will run under Phase 3B-style rollback-only rehearsal before Phase 4D
  production enablement.
- Alerting on `dead_letter` (plan §8 — 4C alert deferred to a later step).
- UI hooks in `useLegalDetails.tsx` etc. (planned Phase 4B UI slice).

---

## 6. Operational contract (for Phase 4D)

- **Invocation:** cron `* * * * *` → `net.http_post` → Edge Function URL with
  headers `Content-Type: application/json`, `apikey: <anon>`,
  `Authorization: Bearer <anon>`, `X-Worker-Secret: <secret>`, body `{}`.
- **Batch:** claim 10 jobs / tick, lease 60 s.
- **Per job:** if `run_reason ∉ {legal_details_upsert, manual_replay}` →
  complete `done` with `skipped: unsupported reason …`. Else call
  `crm_company_backfill_billing_cld(entity_id)`; success → `done`;
  `SQLSTATE ∈ {42501,23503,22023,P0001}` or map-mismatch text → `dead_letter`;
  otherwise → `retry`.
- **Backoff / cap / dead-letter:** owned by
  `crm_company_sync_worker_complete` (Phase 4B): `LEAST(3600, 30·2^(n-1))` s
  with ±20% jitter, `attempts >= 8` → forced `dead_letter`. Dead-letter is
  terminal and never re-claimed.
- **Crash recovery:** `worker_claim` also picks `status='running' AND
  next_run_at <= now()`, i.e. expired leases, so a crashed tick self-heals.
- **Audit preservation:** worker never writes to canonical tables directly;
  every write flows through `crm_company_backfill_billing_cld`, whose hash is
  asserted equal (`36b5ee9…102d6`) before and after this deploy. Phase 3
  audit columns and log rows behave identically.
- **Logging:** structured JSON only. Fields logged:
  `evt`, `job_id`, `entity_id`, `reason`, `attempts`, `outcome`,
  `elapsed_ms`, `had_error` (boolean), summary counters. Never logged:
  secret, service-role key, full error payload, PII from CLD, header
  values.
- **CORS:** absent by design — the worker is not browser-callable.

---

## 7. Rollback (Phase 4C deploy only)

If Phase 4C needs to be rolled back before Phase 4D:

1. `supabase--delete_edge_functions ["company-sync-worker"]`.
2. `secrets--delete_secret PHASE4_WORKER_SHARED_SECRET`.
3. Remove `supabase/functions/company-sync-worker/` from the repo.

No DB rollback is required — this phase did not touch the database. Phase 4B
rollback (`.lovable/rollback/companies-phase4b/phase4b_queue_rollback.sql`)
remains valid and independent.

---

## 8. Files changed

- `supabase/functions/company-sync-worker/index.ts` — new handler (deployed).
- `.lovable/discovery/companies-1.0/companies_phase4c_worker_deploy_report.md` — this report (new).
- Runtime secret store: `PHASE4_WORKER_SHARED_SECRET` (created; value never
  disclosed).

**Phase 4D (cron activation + rehearsal + production enablement + alerting)
remains out of scope and unauthorized until a separate admin approval.**
