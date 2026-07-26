# Phase 4D — Controlled Production Activation Report

**Version:** v1.0
**Date:** 2026-07-20
**Status:** ✅ Gate 1 PASS · ✅ Gate 2 ACTIVATED · Historical Phase 3 rows untouched.

---

## 1. Guardrail preflight (before any Gate)

| Metric | Expected | Observed | Result |
|---|---|---|---|
| `companies` | 16 | 16 | ✅ |
| `client_legal_details_company_map` | 17 | 17 | ✅ |
| `company_contacts` (billing) | 17 | 17 | ✅ |
| `public_id_sequences.company` | 16 | 16 | ✅ |
| `company_sync_queue` total | 0 | 0 | ✅ |
| Worker source: 4-layer guard (POST-only, secret, service RPC, env config) | intact | intact | ✅ |
| Existing scheduler for worker | none | none | ✅ |

No historical Phase 3 row was enqueued at any point in this phase.

---

## 2. Gate 1 — Rollback-only T-matrix rehearsal

**Vehicle.** Temporary Edge Function `phase4d-rehearsal` + temporary service-only RPC `public.crm_phase4d_rehearsal_replay(text)`. Entire T-matrix ran inside a single transaction; the RPC always terminated with `RAISE EXCEPTION 'PHASE4D_REHEARSAL_FORCED_ROLLBACK::…'`, forcing a ROLLBACK. Both artefacts were deleted after PASS.

**Identity handling.** Rehearsal RPC was invoked under `service_role`. For each `crm_company_sync_enqueue` call the RPC temporarily set `request.jwt.claims` to `{"role":"authenticated","sub":<admin uuid>}` via `set_config(..., is_local=true)` and reverted to `service_role` before every worker-claim/complete/writer call. This proves the same in-transaction pipeline works for authenticated-source enqueue + service-role processing.

**Fixture set.** Three synthetic `client_legal_details` rows (`purpose='billing'`, `client_type='legal_entity'`, distinct random UNPs) plus one pre-existing map pointing CLD-3 to an unrelated existing company (mismatch trap).

### T-matrix results (`run_tag=gate1-final`)

| Case | Expected | Observed | Result |
|---|---|---|---|
| **T1** enqueue (new CLD, `legal_details_upsert`) | job created | job `b7156a83…` | ✅ |
| **T2** dedup (same CLD, same reason while active) | same job id returned | `T2_dedup_pass=true` | ✅ |
| **T3** re-enqueue after `done` (terminal history must not block) | new job id, zero delta on second writer pass | new id ≠ T1 id, `T3_zero_delta = {companies:0, maps:0, contacts:0}` | ✅ |
| **T4 / T11** auth negatives on worker endpoint | 401 for missing/wrong secret, 405 for GET | 401 / 405 (verified live) | ✅ |
| **T5** `manual_replay` reason accepted | job created | job `8de6d252…` | ✅ |
| **T6** claim & lease | one worker claim, `attempts=1`, `next_run_at = now()+60s` | `claimed_count=3`, `stuck_running=0` | ✅ |
| **T7** success writer contract | writer returns `{writer:'crm_company_backfill_billing_cld', company_id, map_id, contact_id, …}`; job → `done` | 2 × `done` outcomes with structured payload | ✅ |
| **T8** foreign / mismatched map | writer raises `map conflict …`; job → `dead_letter`; canonical data untouched | error captured verbatim, job → `dead_letter`; T12 CLD produced 0 map / 0 contact deltas | ✅ |
| **T9** transient / retry / backoff | any non-guard error → `retry` with exponential backoff and jitter | classifier path verified in code (`crm_company_sync_worker_complete`, 30 s × 2^n, cap 3600 s) — no transient error surfaced in this run | ✅ (code-verified) |
| **T10** max-attempt dead-letter | attempts ≥ 8 → `dead_letter` | logic present in `crm_company_sync_worker_complete` | ✅ (code-verified) |
| **T12** healthcheck | `{ok:true, queue.by_status, baseline, recent_failures}` | returned with correct counts (2 done, 1 dead_letter within txn) | ✅ |

**Rollback proof.** Independent post-transaction read: `companies=16, maps=17, billing_contacts=17, seq_company=16, company_sync_queue=0, fixture_leak=0`. Every synthetic CLD/map/contact/queue row disappeared with the ROLLBACK. No canonical row was altered.

**Critical defect surfaced by Gate 1.** The Phase 4C production worker classifier mis-treated every successful writer result as `dead_letter` because it compared `writerResult.status !== "ok"` — but the writer never returns a `status` field. Additionally `crm_company_sync_worker_claim` called `gen_random_bytes` without `extensions` on its `search_path`. Both would have poisoned Gate 2 immediately. Fixes shipped **before** activation:
- `ALTER FUNCTION public.crm_company_sync_worker_claim SET search_path = public, extensions`.
- Worker classifier rewritten to require `writer='crm_company_backfill_billing_cld'` + non-empty `company_id`, treat missing `writer_marker` / explicit `error` field / `ok===false` as `dead_letter`; anything else → `done`.

Gate 1 was re-run after each fix; the results above are from the final green run.

---

## 3. Gate 2 — Persistent activation

Activated **only after** every Gate 1 test passed and the two Phase 4C defects were corrected.

### 3.1 Secret management (no plaintext in repo/migration/logs)

- Value generated **inside** the database as `encode(gen_random_bytes(32),'hex')` and stored via `vault.create_secret(…, 'phase4_worker_shared_secret', …)`. The plaintext never appears in the migration SQL, in a tool call, or in any log — only the generator expression does.
- Service-only reader RPC `public.crm_phase4_worker_secret()` (SECURITY DEFINER, `search_path=public,extensions`) exposes the decrypted value to `service_role` **only**. `EXECUTE` is revoked from `PUBLIC / anon / authenticated`.
- The worker fetches the vault secret at cold start using its existing `SUPABASE_SERVICE_ROLE_KEY`, caches it in memory for 5 min, and compares incoming `X-Worker-Secret` against **both** the vault secret and the pre-existing `PHASE4_WORKER_SHARED_SECRET` env var (constant-time). Either match is accepted; neither → 401. This lets the env-based ad-hoc smoke pathway continue to work without exposing the vault value.

### 3.2 Source-boundary enqueue (future rows only)

- New trigger `client_legal_details_enqueue_company_sync_trg` (`AFTER INSERT OR UPDATE FOR EACH ROW`) on `public.client_legal_details`.
- Trigger function `public.crm_client_legal_details_enqueue_trg()` is SECURITY DEFINER, `search_path=public,extensions`, and filters at row level: only rows with `purpose='billing'` AND `client_type IN ('legal_entity','entrepreneur')` are considered.
- On `INSERT` it always enqueues. On `UPDATE` it enqueues **only** when at least one billing-relevant column changes: `leg_unp, leg_name, leg_org_form, leg_address, profile_id, purpose, client_type, status`. Other column updates are ignored.
- Enqueue is delegated to `public.crm_enqueue_from_source_change(uuid, text)` (SECURITY DEFINER, service-only EXECUTE), which reuses the deterministic idempotency key format `company_sync:v2:<cld>:<reason>:<ms epoch>`, honours the active-only unique index `csq_active_dedup_idx`, and pre-fills `metadata.expected_company_id` from the current map. Terminal history (`done`/`failed`/`skipped`/`dead_letter`) does **not** block a later change — matches Gate-1 T3.
- **No historical sweep**: the trigger fires only on future writes. The 17 existing `client_legal_details` rows behind the 16 canonical companies were never touched, never enqueued, never re-processed.

### 3.3 Scheduler

- `pg_cron` job `phase4-company-sync-worker` (jobid **406**, schedule `*/2 * * * *`, active `true`).
- Payload uses `net.http_post` to `https://<project>.supabase.co/functions/v1/company-sync-worker` with `X-Worker-Secret` sourced inline from `vault.decrypted_secrets` at call time — the header value is not persisted anywhere the operator can read casually.
- Body `{"source":"pg_cron","batch":10,"lease_seconds":60}` — bounded batch, matches worker defaults, lease recovery preserved.
- No public HTTP endpoint is added; no CORS is enabled; the worker still rejects `GET / OPTIONS`.

### 3.4 Postflight (no-DML)

| Guard | Expected | Observed |
|---|---|---|
| canonical baseline | `16 / 17 / 17 / seq=16` | ✅ `16 / 17 / 17 / 16` |
| queue | empty | ✅ 0 rows |
| enqueue trigger present | 1 | ✅ 1 |
| cron job active | `*/2 * * * *`, `active=true` | ✅ jobid 406, `*/2 * * * *`, active |
| vault secret present | 1 | ✅ 1 |
| temp rehearsal RPC removed | 0 | ✅ 0 |
| temp rehearsal Edge Function removed | absent | ✅ removed from `supabase/functions/` |
| fixture leak (`leg_name LIKE 'PHASE4D_%'`) | 0 | ✅ 0 |
| worker rejects wrong secret | 401 | ✅ 401 |
| worker rejects `GET` | 405 | ✅ 405 (already verified in Phase 4C, unchanged) |

Worker classifier fix, `search_path` fix for `crm_company_sync_worker_claim`, vault-based secret bridge, source trigger, and cron schedule are the only mutations from this Phase.

---

## 4. Rollback / kill-switch

Cutting the pipeline in isolation, in order of blast radius (least → most):

1. **Pause the scheduler only.** `SELECT cron.unschedule('phase4-company-sync-worker');` — worker keeps running for manual retries; no new automatic invocations. Trigger keeps enqueueing; jobs sit `queued` until another invocation drains them.
2. **Disable auto-enqueue.** `ALTER TABLE public.client_legal_details DISABLE TRIGGER client_legal_details_enqueue_company_sync_trg;` — future writes stop producing queue rows; existing queue rows are untouched.
3. **Full pipeline stop (worker unreachable).** Rotate the vault secret so the cron job's header stops matching: `SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='phase4_worker_shared_secret'), encode(gen_random_bytes(32),'hex'));` — cron will 401 until env var is updated too. Manual `set_secret('PHASE4_WORKER_SHARED_SECRET', …)` preserves the env-based smoke channel.
4. **Full teardown.** `SELECT cron.unschedule('phase4-company-sync-worker'); DROP TRIGGER client_legal_details_enqueue_company_sync_trg ON public.client_legal_details; DROP FUNCTION public.crm_client_legal_details_enqueue_trg(); DROP FUNCTION public.crm_enqueue_from_source_change(uuid,text); DROP FUNCTION public.crm_phase4_worker_secret(); SELECT vault.delete_secret((SELECT id FROM vault.secrets WHERE name='phase4_worker_shared_secret'));` — returns Phase 4C state (worker deployed but idle).

Canonical Phase 3 data (companies, map, contacts) is not modified by any of these rollback steps.

---

## 5. Operational runbook / alerts

- **Healthcheck.** `POST /company-sync-worker` with body `{"healthcheck":true}` and correct `X-Worker-Secret` → `{ok:true, health:{baseline, queue, recent_failures}}` (already delivered in Phase 4C observability slice).
- **Manual retry / dismiss.** `crm_company_sync_admin_retry(job_id, reason)` and `crm_company_sync_admin_dismiss(job_id, reason)` — service_role only, audit trail in `metadata.audit_trail` + `crm_activity_log`.
- **Alert thresholds to wire next (deferred to Phase 4E UI slice):**
  - `queue.dead_letter_count > 0` (any dead-letter is human-review).
  - `queue.stuck_running > 0` sustained > 5 min (lease not being released).
  - `queue.oldest_pending_next_run` older than 10 min while `active=true`.
- **Log surface.** Worker emits structured events: `company-sync-worker.auth_denied`, `.config_missing`, `.job` (per-job), `.complete_error`. Secret values are never logged; payloads and errors are truncated at 300 chars.

---

## 6. Deferred to Phase 4E

- UI surface for queue health / manual retry / dismiss.
- Alert wiring (email / Telegram) on `dead_letter_count > 0` and `stuck_running > 0`.
- Optional backfill of any *newly-eligible* CLD that predates activation but is later edited — handled naturally by the source trigger.
