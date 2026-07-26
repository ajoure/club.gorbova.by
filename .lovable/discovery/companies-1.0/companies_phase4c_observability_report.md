# Phase 4C — Observability & Operations Slice Execution Report

**Version:** 1.0
**Status:** ✅ PASS — migration applied, worker healthcheck deployed, no data mutation, cron still off.
**Scope:** Read-only queue health, admin retry, admin dismiss-with-reason, active-only dedup, foreign company_map guard, worker healthcheck path. Everything service-role bounded.
**Plan reference:** `.lovable/discovery/companies-1.0/companies_phase4_queue_worker_plan.md` §§3.4, 3.5, 6, 7, 8, 9.

---

## 1. Preflight guard (in-migration)

| Check | Expected | Actual |
|---|---|---|
| companies | 16 | ✅ 16 |
| client_legal_details_company_map | 17 | ✅ 17 |
| company_contacts (`is_billing_contact=true`) | 17 | ✅ 17 |
| `public_id_sequences.company` | 16 | ✅ 16 |
| company_sync_queue rows | 0 | ✅ 0 |
| `crm_company_backfill_billing_cld` exists | yes | ✅ yes |
| `csq_active_dedup_idx` present before | no | ✅ absent (created by this migration) |
| `supabase/functions/company-sync-worker/index.ts` present & source-protected (shared-secret gate) | yes | ✅ yes (S1/S2 in §7 still 401) |
| cron job `company-sync-worker-tick` scheduled | no | ✅ no (deferred to Phase 4D) |

Drift → migration aborts atomically before any DDL runs.

---

## 2. Artefacts introduced

### 2.1 DDL

```sql
CREATE UNIQUE INDEX IF NOT EXISTS csq_active_dedup_idx
  ON public.company_sync_queue (entity_id, run_reason)
  WHERE status IN ('queued','running');
```

Partial-unique. Terminal-history rows (`done` / `failed` / `skipped` / `dead_letter`)
are **excluded** from active deduplication — a completed job never blocks a
fresh enqueue for the same CLD + reason.

### 2.2 RPCs (all `SECURITY DEFINER`, `SET search_path = public`)

| Function | Caller role | Purpose |
|---|---|---|
| `crm_company_sync_enqueue(_cld_id uuid, _reason text, _expected_company_id uuid DEFAULT NULL)` | authenticated + service_role | Producer. Rewritten this phase (see §3). Old `(uuid,text)` signature DROPPED; default third param keeps 2-arg call sites working. |
| `crm_company_sync_health()` | service_role only | Read-only queue+baseline summary. |
| `crm_company_sync_admin_retry(_id uuid, _actor_user_id uuid, _reason text)` | service_role only | Requeue a `failed` / `dead_letter` job under an explicit admin actor. |
| `crm_company_sync_admin_dismiss(_id uuid, _actor_user_id uuid, _reason text)` | service_role only | Terminally mark a `queued` / `failed` / `dead_letter` job as `skipped` with audit reason. |

Postflight (§4) verifies all four exist and no others were touched. Permanent
writer `crm_company_backfill_billing_cld` hash **unchanged** (`36b5ee9…102d6`).

### 2.3 Edge Function delta

`supabase/functions/company-sync-worker/index.ts` extended with a healthcheck
path: `POST` with body `{"healthcheck": true}` (and the required
`X-Worker-Secret` header) returns `crm_company_sync_health()` output without
claiming or mutating the queue. All other trust-boundary gates from Phase 4C
(§3 of the deploy report) are unchanged.

---

## 3. Validation & dedup contract

### 3.1 Enqueue

Order of checks in `crm_company_sync_enqueue`:

1. `auth.uid()` required (`42501`).
2. `_reason ∈ {legal_details_upsert, manual_replay}` (`22023`).
3. CLD exists (`23503`) and is `purpose='billing'` with
   `client_type ∈ {legal_entity, entrepreneur}` (`22023`).
4. Caller is admin / super_admin / menedzher **or** owner of the CLD (via
   `profiles.user_id = auth.uid()` OR `profiles.id = auth.uid()`), else
   `42501`.
5. **Foreign company_map guard**: if `_expected_company_id` supplied AND a
   map row exists for the CLD with a **different** `company_id`, reject
   `22023 company_id mismatch for CLD X: expected=Y, actual=Z`. No row
   inserted.
6. **Active-only dedup**: SELECT any existing job with same
   `(entity_id, run_reason)` and `status ∈ (queued, running)`. Present →
   return its id (no insert). Absent → INSERT a fresh row with a per-run
   idempotency key `company_sync:v2:<cld>:<reason>:<epoch_ms>`.
   Terminal-history rows are ignored by the SELECT and cannot collide via the
   UNIQUE index because the key carries a millisecond suffix; active-duplicate
   protection lives in `csq_active_dedup_idx`.

### 3.2 Retry

`crm_company_sync_admin_retry` requires:
- `service_role`.
- Non-null `_actor_user_id` resolvable via `profiles (id OR user_id)` →
  materialised as `v_actor := COALESCE(profiles.user_id, profiles.id)`
  (matches Phase 3B linker convention, satisfies `crm_activity_log.user_id NOT NULL`).
- Non-empty `_reason` (min 3 chars after trim).
- Target job exists (`23503`) and is currently in `failed` or `dead_letter`
  (`22023` otherwise).
- **No active duplicate** exists for the same `(entity_id, run_reason)` with
  a different id — otherwise `22023 active duplicate exists…` to preserve the
  §3.1 dedup contract.

On success: resets `status='queued'`, `next_run_at=now()`,
`locked_by/locked_at=NULL`, `last_error=NULL`, `attempts=0`,
`updated_by=v_actor`, appends an entry to `metadata.audit_trail`, and inserts
a `crm_activity_log` row (`activity_type='company_sync_admin_retry'`,
`source_entity_type='company_sync_queue'`, `source_entity_id=job`, metadata
carries `reason`, `correlation_id`, `from_status`, `entity_id`, `run_reason`).
Returns `{ok:true, id, correlation_id}`.

### 3.3 Dismiss

`crm_company_sync_admin_dismiss` shares the identity/reason validation. Allows
transition from `queued` / `failed` / `dead_letter` only (never from
`running` or terminal `done` / `skipped`). Sets `status='skipped'`, appends
`dismissed: <reason>` to `last_error`, appends `audit_trail`, and writes a
`crm_activity_log` row (`activity_type='company_sync_admin_dismiss'`) with
the same correlation id.

### 3.4 Health summary

Returns a single JSONB payload:

```json
{
  "ok": true,
  "checked_at": "…",
  "baseline": {"companies":16,"maps":17,"billing_contacts":17,"seq_company":16},
  "queue": {
    "total": 0,
    "by_status": {},
    "oldest_pending_next_run": null,
    "stuck_running": 0,
    "dead_letter_count": 0,
    "last_dead_letter_at": null,
    "failure_count": 0,
    "total_attempts": 0
  },
  "recent_failures": []
}
```

`stuck_running` = `count(*) WHERE status='running' AND next_run_at < now()` —
covers crashed workers whose leases expired. `recent_failures` clamps
`last_error` at 300 chars.

---

## 4. Postflight (in-migration + independent no-DML)

In-migration assertions (all PASS, else the whole migration would have been
rolled back):

- Baseline 16/17/17/16.
- `company_sync_queue` = 0 rows.
- `csq_active_dedup_idx` present.
- 3 new SECURITY DEFINER functions present.
- `crm_company_backfill_billing_cld` MD5 = `36b5ee9763bb813b66dec59df53102d6`
  (unchanged since Phase 3B remediation).

Independent no-DML re-check (post-commit):

```
final: companies=16 / maps=17 / billing_contacts=17 / seq_company=16
company_sync_queue rows = 0
company_sync_queue where status in ('failed','dead_letter') = 0

pg_proc.proacl (relevant functions):
  crm_company_sync_enqueue         → {postgres, authenticated, service_role}   (no anon, no PUBLIC)
  crm_company_sync_health          → {postgres, service_role}                  (no anon, no authenticated, no PUBLIC)
  crm_company_sync_admin_retry     → {postgres, service_role}                  (no anon, no authenticated, no PUBLIC)
  crm_company_sync_admin_dismiss   → {postgres, service_role}                  (no anon, no authenticated, no PUBLIC)
  crm_company_sync_worker_claim    → {postgres, service_role}                  (unchanged)
  crm_company_sync_worker_complete → {postgres, service_role}                  (unchanged)

pg_indexes on company_sync_queue includes:
  csq_active_dedup_idx  UNIQUE  (entity_id, run_reason) WHERE status IN ('queued','running')

Extensions used at runtime: pg_cron and pg_net remain installed;
no cron.schedule entry created (activation still deferred).
```

`sandbox_exec` entries in `proacl` are the managed executor and do not affect
production application roles.

---

## 5. Security linter delta

The migration surfaced the project-wide linter output (240 findings). None of
the four new/updated functions is a regression:

- All four set `search_path = public`.
- All four have `PUBLIC`, `anon` (and `authenticated` where not intended)
  explicitly `REVOKE`d — the 0028 warnings raised for the batch belong to
  pre-existing definer functions elsewhere, verified by direct `proacl`
  inspection above.
- No RLS change was made to any table.

No new blocker introduced by Phase 4C observability slice.

---

## 6. Baseline invariant

| Metric | Before | After | Δ |
|---|---|---|---|
| companies | 16 | 16 | 0 |
| client_legal_details_company_map | 17 | 17 | 0 |
| company_contacts (billing) | 17 | 17 | 0 |
| public_id_sequences.company | 16 | 16 | 0 |
| company_sync_queue rows | 0 | 0 | 0 |
| company_sync_queue where status ∈ (failed, dead_letter) | 0 | 0 | 0 |

Canonical Phase 3 data untouched. No historical CLD enqueued. No worker tick
executed.

---

## 7. Endpoint contract / smoke evidence

`company-sync-worker` (Phase 4C deploy report §3) — trust boundary unchanged.
Extended with `{"healthcheck": true}` path that delegates to
`crm_company_sync_health()`.

| # | Request | Expected | Actual |
|---|---|---|---|
| S1 | `POST` no `X-Worker-Secret` | 401 | ✅ 401 `{"error":"unauthorized"}` |
| S2 | `POST` wrong `X-Worker-Secret` | 401 | ✅ 401 `{"error":"unauthorized"}` |
| S3 | `GET` | 405 | ✅ 405 (unchanged from Phase 4C) |
| S4 | `POST` correct secret + `{"healthcheck":true}` | 200, health JSON, no queue write | not exercised from chat sandbox (secret intentionally unreadable — same trust boundary as Phase 4C); reserved for Phase 4D rehearsal |
| S5 | `POST` correct secret + `{}` (real tick) | 200, `claimed=0` while queue empty | reserved for Phase 4D rehearsal |

Positive-path smoke is intentionally deferred: `PHASE4_WORKER_SHARED_SECRET`
is never revealed by `generate_secret`, and the chat-sandbox has no
`service_role` execution surface. Both are the intended guardrails.

---

## 8. Operations runbook (for Phase 4D use)

All three ops go through the same trusted path: an admin-invoked internal
Edge Function (or the Phase 4B rehearsal-style temp Edge Function) that calls
these RPCs under the `SUPABASE_SERVICE_ROLE_KEY`. **Never** grant these
functions to `authenticated` or `anon`.

### 8.1 Read health

```sql
SELECT public.crm_company_sync_health();
-- service_role only. Returns baseline + queue counts + recent failures.
```

Also available via the worker healthcheck path:

```
POST /functions/v1/company-sync-worker
Headers: X-Worker-Secret: <PHASE4_WORKER_SHARED_SECRET>,
         Content-Type: application/json
Body:    {"healthcheck": true}
```

### 8.2 Manual retry a failed/dead_letter job

```sql
SELECT public.crm_company_sync_admin_retry(
  '<queue_row_id>'::uuid,
  '<admin_profile_id_or_user_id>'::uuid,
  'symptom XYZ resolved by patch #123'
);
```

Behaviour:
- Refuses if the job is not currently `failed` / `dead_letter`.
- Refuses if any active duplicate exists (`queued` / `running` sibling with
  the same `entity_id` + `run_reason`).
- Resets `attempts=0`, clears lease, next_run_at=now().
- Appends `metadata.audit_trail` + inserts `crm_activity_log` row with the
  returned `correlation_id`.

### 8.3 Dismiss a failed/queued/dead_letter job

```sql
SELECT public.crm_company_sync_admin_dismiss(
  '<queue_row_id>'::uuid,
  '<admin_profile_id_or_user_id>'::uuid,
  'CLD retired — no backfill needed'
);
```

- Transitions to `status='skipped'` (terminal). Never picked up by
  `crm_company_sync_worker_claim`.
- Appends `dismissed: <reason>` to `last_error`, appends `audit_trail`,
  inserts activity-log row.

### 8.4 Observing dead-letter

```sql
-- indexed by csq_deadletter_idx (Phase 4B)
SELECT id, entity_id, attempts, updated_at, left(last_error, 300)
  FROM public.company_sync_queue
 WHERE status = 'dead_letter'
 ORDER BY updated_at DESC;
```

The same set is echoed under `recent_failures` (top 5) in the health
summary.

---

## 9. Rollback (Phase 4C observability slice)

Reverse in this order (only the artefacts added this phase; touches nothing
else):

```sql
DROP FUNCTION IF EXISTS public.crm_company_sync_admin_dismiss(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.crm_company_sync_admin_retry(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.crm_company_sync_health();
DROP INDEX IF EXISTS public.csq_active_dedup_idx;
-- Restore prior 2-arg enqueue signature (per Phase 4B migration source):
DROP FUNCTION IF EXISTS public.crm_company_sync_enqueue(uuid, text, uuid);
-- then re-run Phase 4B's original CREATE FUNCTION crm_company_sync_enqueue(uuid, text) …
```

Undo the worker healthcheck path by reverting
`supabase/functions/company-sync-worker/index.ts` to the Phase 4C v1.0
version and redeploying. Phase 4B and Phase 3C artefacts are unaffected.

---

## 10. Stop-guards still enforced

- No cron scheduled (`company-sync-worker-tick` still absent — activation
  gated on Phase 4D approval).
- No `crm_company_sync_enqueue(...)` call executed for historical Phase 3
  CLDs. Queue remains empty.
- No changes to `companies`, `client_legal_details_company_map`,
  `company_contacts`, or the permanent writer
  `crm_company_backfill_billing_cld` (hash asserted `36b5ee9…102d6` pre- and
  postflight).
- No public / anon grants. No CORS on the worker. Shared secret
  `PHASE4_WORKER_SHARED_SECRET` still stored encrypted, never logged, never
  echoed.
- No UI surface added.

---

## 11. Files changed

- `supabase/migrations/20260720-064259-857286_*.sql` — new (applied).
- `supabase/functions/company-sync-worker/index.ts` — healthcheck path added; redeployed.
- `.lovable/discovery/companies-1.0/companies_phase4c_observability_report.md` — this file (new).
- `src/integrations/supabase/types.ts` — auto-regenerated by platform; no manual edit.

**Phase 4D (cron activation, full T-matrix rehearsal, dead-letter alerting,
UI slice) remains out of scope and unauthorized until a separate admin
approval.**
