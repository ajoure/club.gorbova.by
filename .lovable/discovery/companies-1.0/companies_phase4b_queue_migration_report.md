# Phase 4B — Queue Migration Execution Report

**Version:** 1.0
**Status:** ✅ PASS — committed
**Scope:** Minimal queue DDL + service/authenticated helpers per
`companies_phase4_queue_worker_plan.md` §§3.1–3.4, 4.1–4.2, 5 (M1+M2 only).
**Out of scope (unchanged):** Edge worker, cron, secrets, UI, processing/enqueue
of historical Phase 3 rows, changes to `companies` / `client_legal_details_company_map`
/ `company_contacts` / `crm_company_backfill_billing_cld` / `crm_company_link_contact`.

Migration file: `20260720-062948-307712_*.sql`.
Rollback file: `.lovable/rollback/companies-phase4b/phase4b_queue_rollback.sql`.

---

## 1. Preflight (in-migration DO $$ … $$ block)

| Check | Expected | Result |
|---|---|---|
| `companies` | 16 | ✅ 16 |
| `client_legal_details_company_map` | 17 | ✅ 17 |
| `company_contacts WHERE is_billing_contact=true` | 17 | ✅ 17 |
| `public_id_sequences.last_value WHERE entity_type='company'` | 16 | ✅ 16 |
| `company_sync_queue` count | 0 | ✅ 0 |
| `company_sync_queue WHERE status IN ('failed','dead_letter')` | 0 | ✅ 0 |
| `md5(pg_get_functiondef(crm_company_backfill_billing_cld))` | `36b5ee9763bb813b66dec59df53102d6` | ✅ match |

Any drift → `RAISE EXCEPTION` before any DDL executes. Migration is atomic —
Postgres rolls back the whole transaction on failure.

---

## 2. DDL delta applied

```sql
ALTER TABLE public.company_sync_queue
  ADD COLUMN IF NOT EXISTS first_attempted_at timestamptz NULL;

ALTER TABLE public.company_sync_queue
  DROP CONSTRAINT IF EXISTS company_sync_queue_status_check;
ALTER TABLE public.company_sync_queue
  ADD CONSTRAINT company_sync_queue_status_check
  CHECK (status = ANY (ARRAY['queued','running','done','failed','skipped','dead_letter']));

CREATE INDEX IF NOT EXISTS csq_deadletter_idx
  ON public.company_sync_queue (updated_at)
  WHERE status = 'dead_letter';
```

Post-DDL catalog (verified):

```
Indexes:
  company_sync_queue_pkey
  company_sync_queue_idempotency_key_key
  csq_status_next_idx        (existing, WHERE status IN ('queued','running'))
  csq_deadletter_idx         (NEW,      WHERE status='dead_letter')

Check constraint company_sync_queue_status_check:
  status = ANY (ARRAY['queued','running','done','failed','skipped','dead_letter'])
```

Existing service-only RLS policy `company_sync_queue service only` unchanged;
no `anon`/`authenticated`/`PUBLIC` grants added to the table (verified in §5).

---

## 3. Functions created

All three are `SECURITY DEFINER`, `SET search_path = public`, verified via
`pg_proc` (§5).

### 3.1 `public.crm_company_sync_enqueue(_cld_id uuid, _reason text) RETURNS uuid`

- Gate: `auth.uid()` required; `_reason ∈ {legal_details_upsert, manual_replay}`;
  CLD must exist with `purpose='billing'` AND `client_type IN ('legal_entity','entrepreneur')`;
  caller must be admin / super_admin / menedzher **or** owner of the CLD
  (matched via `profiles.user_id = auth.uid()` OR `profiles.id = auth.uid()`).
- Deterministic idempotency key: `'company_sync:v1:' || _cld_id || ':' || _reason`.
- Dedup path: `INSERT … ON CONFLICT (idempotency_key) DO UPDATE SET updated_at=…`
  (no-op update solely to force `RETURNING id`) → returns existing job id when
  a job with the same key is already queued/running/done/failed/dead_letter.
- Non-retryable input validation raises `22023` / `23503` / `42501` per plan §3.7.
- ACL: `EXECUTE` for `authenticated` + `service_role` only. `PUBLIC`, `anon`
  explicitly revoked.

### 3.2 `public.crm_company_sync_worker_claim(_batch int DEFAULT 10, _lease_seconds int DEFAULT 60) RETURNS SETOF company_sync_queue`

- Gate: `auth.role() = 'service_role'`; batch 1..100; lease 15..900 s.
- `WITH cte AS (SELECT id … FOR UPDATE SKIP LOCKED LIMIT _batch)` picks jobs
  that are either `queued` with `next_run_at <= now()` **or** `running` with an
  expired lease (`next_run_at <= now()`) — the latter covers crashed workers.
- Then `UPDATE … SET status='running', attempts=attempts+1, locked_by='worker:'||random_hex,
  locked_at=now(), next_run_at=now()+lease, first_attempted_at=COALESCE(first_attempted_at, now())`.
- ACL: `EXECUTE` for `service_role` only. `PUBLIC`, `anon`, `authenticated`
  explicitly revoked.

### 3.3 `public.crm_company_sync_worker_complete(_id uuid, _status text, _error text DEFAULT NULL) RETURNS void`

- Gate: `service_role`. `_status ∈ {done, retry, dead_letter, skipped}`. Row is
  loaded `FOR UPDATE` and must currently be `running` (else `22023`).
- `done` / `skipped` / `dead_letter` — terminal-side write, `locked_by/locked_at`
  cleared.
- `retry` — if `attempts >= 8` (hard cap) → `dead_letter` with error message,
  else `status='queued'`, `next_run_at = now() + backoff`, where
  `backoff = LEAST(3600, 30 * 2^(attempts-1)) seconds` with ±20% jitter
  (`0.8 + random()*0.4`).
- Dead-letter is terminal: `claim` never picks it up (WHERE clause only
  looks at `queued`/`running`). Poison jobs are observable via
  `csq_deadletter_idx`.
- ACL: `EXECUTE` for `service_role` only.

---

## 4. Concurrency, idempotency, safety properties

| Property | Mechanism |
|---|---|
| Idempotency (enqueue) | `UNIQUE (idempotency_key)` + deterministic key + `ON CONFLICT DO UPDATE … RETURNING id` |
| Idempotency (execution) | Worker will always call permanent `crm_company_backfill_billing_cld`, whose read-then-insert map guard and canonical upsert are Phase-3B-proven idempotent (0-delta second pass in Phase 3C) |
| Concurrency | `FOR UPDATE SKIP LOCKED` in claim; per-row lease + `attempts` counter |
| Lease expiry / crash recovery | `status='running' AND next_run_at <= now()` re-claimable |
| Retry backoff | Exponential `30·2^(n-1)` capped at 3600 s, ±20% jitter |
| Attempt cap | `attempts >= 8` → forced `dead_letter` |
| Poison job protection | Dead-letter terminal; not picked by claim; indexed by `csq_deadletter_idx` |
| Audit semantics (Phase 3) | Untouched — worker writes only via `crm_company_backfill_billing_cld`; its hash is asserted equal to Phase 3C in pre- and postflight |
| Trust boundary | `anon` = no grants anywhere; `authenticated` = enqueue only (with owner/role gate); `service_role` = claim/complete + backfill writer; direct table writes to queue by non-service roles remain impossible (RLS + no GRANTs) |

**No trigger** was added on `client_legal_details`, so historical Phase 3 rows
are **not** auto-enqueued. Queue count remained 0 through and after the
migration.

---

## 5. Postflight (in-migration + independent no-DML re-check)

In-migration assertions all passed (else the migration would have been rolled
back). Independent re-check after commit:

```
companies:16
maps:17
billing:17
seq:16
queue:0

Indexes on company_sync_queue:
  company_sync_queue_idempotency_key_key
  company_sync_queue_pkey
  csq_deadletter_idx
  csq_status_next_idx

Status check: CHECK ((status = ANY (ARRAY['queued','running','done','failed','skipped','dead_letter'])))

New SECURITY DEFINER functions (all prosecdef=true):
  crm_company_sync_enqueue(_cld_id uuid, _reason text)
  crm_company_sync_worker_claim(_batch int, _lease_seconds int)
  crm_company_sync_worker_complete(_id uuid, _status text, _error text)

ACL (pg_proc.proacl):
  crm_company_sync_enqueue         → {postgres=X, authenticated=X, service_role=X}
  crm_company_sync_worker_claim    → {postgres=X, service_role=X}
  crm_company_sync_worker_complete → {postgres=X, service_role=X}
  (no PUBLIC, no anon on any of the three)

Table grants on company_sync_queue (non-privileged roles):
  none for anon / authenticated / PUBLIC (service-only invariant preserved)

crm_company_backfill_billing_cld hash: 36b5ee9763bb813b66dec59df53102d6  (unchanged vs Phase 3B/3C)
```

`sandbox_exec` entries in `proacl` are the managed executor role (owned by
Lovable Cloud) and do not affect production application roles.

---

## 6. No-DML smoke verification performed

- Catalog reads only (`pg_proc`, `pg_indexes`, `pg_constraint`,
  `information_schema.role_routine_grants`, `information_schema.role_table_grants`).
- Row counts on canonical Phase 3 tables and on `company_sync_queue`.
- No RPC invocations against the new functions (they require live
  `authenticated`/`service_role` JWT contexts which are covered by the Phase 3B
  Lovable-native rehearsal path and postponed to Phase 4C rehearsal per plan §5 step 7).
- No secrets requested, no Edge Function deployed, no cron scheduled.

---

## 7. Rollback

Exact rollback SQL committed at
`.lovable/rollback/companies-phase4b/phase4b_queue_rollback.sql`. Reverses in
order: DROP three helper functions → DROP `csq_deadletter_idx` → restore
prior `status` CHECK (without `dead_letter`) → DROP `first_attempted_at`
column. Idempotent (`IF EXISTS` everywhere) and includes a postflight assert
that all three helpers are gone. Does not touch `companies` /
`client_legal_details_company_map` / `company_contacts` /
`crm_company_backfill_billing_cld` / `crm_company_link_contact` /
`crm_company_upsert_from_billing`.

---

## 8. Stop-guards still enforced

Per plan §12: no cron, no Edge worker deployed, no processing of historical
Phase 3 rows, no widening of ACL on `company_sync_queue`, no direct
`companies`/map/contacts mutation path added, `crm_company_backfill_billing_cld`
signature preserved and asserted by hash both pre- and postflight, no secret
generated, no UI touched.

---

## 9. Files changed

- `supabase/migrations/20260720-062948-307712_*.sql` (new, applied)
- `.lovable/rollback/companies-phase4b/phase4b_queue_rollback.sql` (new)
- `.lovable/discovery/companies-1.0/companies_phase4b_queue_migration_report.md` (this file, new)
- `src/integrations/supabase/types.ts` (auto-regenerated by platform after migration; no manual edit)

Phase 4C (Edge worker + cron + shared secret + rehearsal + production
enablement) remains **out of scope and unauthorized** until a separate admin
approval per plan §5 step 7 and §12.
