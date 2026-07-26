# Phase 3B — Rollback-only Identity Rehearsal Report

**Document version:** v2.0 (supersedes v1.0 capability-blocker report)
**Status:** ✅ PASS
**Date:** 2026-07-20
**Environment:** Lovable-managed Supabase (production project ref hidden)
**Scope:** Phase 3B rollback-only rehearsal via Lovable-native Edge Function path.
**Constraint reaffirmed:** Phase 3C (real backfill) **remains blocked** and requires a separate explicit admin approval.

---

## 1. Executive summary

Rehearsal PASSED end-to-end under a real `service_role` identity through a
temporary, private Edge Function that executed a single atomic Postgres
transaction and force-rolled it back with a distinguishable expected marker.

- **In-transaction result (waves 1+2):** 16 companies, 17 map rows, 17 billing contacts, `public_id_sequences.company = 16`.
- **Soft flag UNP `193405000`:** exactly 1 company, 2 billing contacts — as forecast.
- **Idempotency (full second pass over all 17 CLDs):** 0 new companies, 0 new map rows, 0 new contacts, 0 new `crm_activity_log` rows, `seq_company` unchanged.
- **Forced rollback:** SQLSTATE `P3B01`, message prefix `PHASE3B_REHEARSAL_EXPECTED_ROLLBACK …`.
- **Independent post-rollback residual check (separate REST transaction, service_role reader):** all canonical counters back to baseline zero.
- **Cleanup:** temporary Edge Function deleted, temporary replay RPC dropped, shared-secret revoked, permanent writer and existing ACLs unchanged.

---

## 2. Approved narrow scope

The user approved a **single, narrow, temporary** Lovable-native path:

1. A private SECURITY DEFINER RPC `public.crm_phase3b_rehearsal_replay()`,
   EXECUTE granted **only** to `service_role`, callable only by an internal
   Edge Function.
2. A Lovable Edge Function `crm-company-backfill-rehearsal`, gated by a
   header shared secret whose value never appears in Git, chat, or logs and
   which is deleted immediately after PASS.
3. No UI surface, no queue, no worker, no cron, no permanent public
   endpoint, no `SET LOCAL request.jwt.claims`, no `SET ROLE`, no `BYPASSRLS`
   trick, no broad grants, no changes to existing RLS policies or table
   schemas.

Everything created for this rehearsal was reversed in the same session; only
Markdown evidence and the permanent Phase 3B writer (`crm_company_backfill_billing_cld`)
remain.

---

## 3. Preflight (read-only)

Verified before creating the temporary replay RPC:

| Check | Result |
| --- | --- |
| `crm_company_upsert_from_billing` — SECURITY DEFINER, owner `postgres` | ✅ |
| `crm_company_link_contact` — SECURITY DEFINER, owner `postgres`, `service_role` EXEC = false, `authenticated` EXEC = true | ✅ |
| `crm_company_backfill_billing_cld` — SECURITY DEFINER, `service_role` EXEC = true | ✅ |
| Canonical baseline `companies / map / company_contacts (billing) / public_id_sequences.company` | 0 / 0 / 0 / 0 |
| Eligible CLD inventory (`purpose='billing'`, `client_type in (legal_entity, entrepreneur)`, non-empty digits UNP, non-null full_name) | total 48, eligible 17, unique UNP 16 |
| Duplicate UNP soft flag | `193405000` (count 2) — sole soft flag |
| `crm_activity_log.user_id` nullability | `NO` (guard already remediated in prior corrective migration) |

Inventory numbers match the discovery/plan v1.2 documents exactly.

---

## 4. Atomic transaction design (single REST call, single Postgres transaction)

Because the requirement is a *provable* single-transaction rollback, all
Phase 3B write work was placed **inside one plpgsql function**. PostgREST
executes an `.rpc()` call inside one transaction; the function itself
`RAISE EXCEPTION`s at the end, so PostgREST rolls that transaction back.
There is no code path in which any write could survive.

Function `public.crm_phase3b_rehearsal_replay()` steps:

1. **Identity gate** — `auth.role() = 'service_role'` else `raise 42501`.
2. **Baseline snapshot** — `companies`, `map`, `company_contacts` billing, `seq_company`; abort with `P3B02` if any non-zero. Also snapshot `crm_activity_log` count.
3. **Eligible-ID computation** — deterministic ordering:
   `row_number() over (partition by normalized_unp order by created_at, id)`.
   Slice `[1:16]` = 16 unique-UNP CLDs (wave 1); `[17]` = second CLD for `193405000` (wave 2).
   Abort with `P3B03` if count ≠ 17.
4. **Wave 1** — `perform crm_company_backfill_billing_cld(id)` for each of the 16 IDs.
5. **Wave 2** — same call for the 17th ID (soft-flag duplicate).
6. **In-transaction assertions captured into payload:** counts after waves + soft-flag counts.
7. **Full second pass** — same call for all 17 IDs again to prove idempotency.
8. **Idempotency deltas captured** for companies / map / contacts / seq / `crm_activity_log`.
9. **Force rollback** — `raise exception 'PHASE3B_REHEARSAL_EXPECTED_ROLLBACK %', payload::text using errcode='P3B01'`.

No `ON CONFLICT DO NOTHING`, no blind swallowing. The nested writer's own
read-then-insert-under-`FOR UPDATE` map algorithm is exercised as-is, and
the linker's own idempotency/event/activity semantics are preserved.

ACL of the replay RPC:

```
REVOKE ALL FROM public, anon, authenticated;
GRANT EXECUTE TO service_role;
```

Guard block at end of the same migration verified
`has_function_privilege('service_role', ...) = true` and
`has_function_privilege('authenticated'|'anon', ...) = false`.

---

## 5. Edge Function (temporary, internal-only)

`supabase/functions/crm-company-backfill-rehearsal/index.ts`:

- `POST` only; rejects `GET`.
- Requires header `x-phase3b-token` equal to `PHASE3B_REHEARSAL_TOKEN_INLINE` (Supabase Edge secret). Any mismatch → HTTP 403 `forbidden`.
- Instantiates the Supabase client with `SUPABASE_SERVICE_ROLE_KEY` (never in Git / never in chat / never in response).
- Calls `db.rpc('crm_phase3b_rehearsal_replay')`. The **only** accepted outcome is:
  - `error.code === 'P3B01'` AND
  - `error.message.startsWith('PHASE3B_REHEARSAL_EXPECTED_ROLLBACK ')`
- Any other outcome (return without error, different SQLSTATE, network error) is reported as `BLOCKER` with no retry.
- Then, in a **separate REST call**, independently re-queries canonical counts and `seq_company`. Only when both `rehearsalStatus === 'PASS'` and `residual_clean === true` does the handler return HTTP 200.

Endpoint call was executed once. Full body returned (abbreviated marker payload, `run_tag = 53ea4088-8732-4c72-bda0-2e110ada7aa4`):

```json
{
  "status": "PASS",
  "rehearsal": {
    "status": "PASS",
    "marker_payload": {
      "marker": "PHASE3B_REHEARSAL_EXPECTED_ROLLBACK",
      "run_tag": "53ea4088-…-2e110ada7aa4",
      "baseline":            { "companies": 0,  "map": 0,  "contacts_billing": 0,  "seq_company": 0 },
      "after_waves":         { "companies": 16, "map": 17, "contacts_billing": 17 },
      "soft_flag_193405000": { "unp": "193405000", "companies": 1, "billing_contacts": 2 },
      "seq_company":         { "baseline": 0, "after_waves": 16, "after_second_pass": 16 },
      "crm_activity_log":    { "baseline": 58, "after_waves": 91, "after_second_pass": 91,
                               "delta_waves": 33, "delta_pass2": 0 },
      "after_second_pass":   { "companies": 16, "map": 17, "contacts_billing": 17 },
      "idempotency_deltas":  { "companies": 0, "map": 0, "contacts_billing": 0, "seq_company": 0 }
    },
    "error": null
  },
  "residual":       { "companies": 0, "map": 0, "contacts_billing": 0, "seq_company": 0 },
  "residual_clean": true
}
```

Interpretation:

- `after_waves` matches the plan v1.2 forecast exactly (16 / 17 / 17).
- Soft-flag: single canonical company for UNP `193405000` with two billing contacts (one per source profile) — as required by discovery.
- `idempotency_deltas` are all zero **and** `crm_activity_log.delta_pass2 = 0` — the writer, upsert and linker are jointly idempotent on unchanged inputs. No duplicate events or activity rows.
- `residual_clean = true` after a **separate** REST transaction confirms the ROLLBACK reversed everything the RPC did.

Identities used:

- Edge runtime: authenticated to Postgres via `SUPABASE_SERVICE_ROLE_KEY`; PostgREST populated `auth.role() = 'service_role'` in the replay RPC.
- Nested writer used the profile-derived `v_actor_user_id = COALESCE(profiles.user_id, profiles.id)` from the corrective migration; the `crm_activity_log.user_id NOT NULL` constraint held throughout.

---

## 6. Post-rollback residual proof (independent from RPC error path)

Separate `psql` query after the rehearsal completed:

| Table / sequence | Value | Baseline expected |
| --- | --- | --- |
| `public.companies` | 0 | 0 |
| `public.client_legal_details_company_map` | 0 | 0 |
| `public.company_contacts` (`billing_contact` + `is_billing_contact=true`) | 0 | 0 |
| `public.public_id_sequences.company` | 0 | 0 |
| `public.crm_activity_log` | 58 | 58 (pre-rehearsal snapshot) |

No run-tag residue anywhere. Zero canonical rows created, zero events
appended after rollback. Baseline exactly preserved.

---

## 7. Cleanup (executed same session)

| Action | Result |
| --- | --- |
| DROP temporary RPC `public.crm_phase3b_rehearsal_replay()` (cleanup migration) | ✅ absent in `pg_proc` |
| DELETE Edge Function `crm-company-backfill-rehearsal` | ✅ deleted |
| DELETE source `supabase/functions/crm-company-backfill-rehearsal/` | ✅ removed |
| DELETE shared secret `PHASE3B_REHEARSAL_TOKEN` (unused after design change) | ✅ deleted |
| DELETE shared secret `PHASE3B_REHEARSAL_TOKEN_INLINE` (final one used) | ✅ deleted |
| Preserve permanent writer `crm_company_backfill_billing_cld(uuid)` | ✅ present, `service_role` EXECUTE = true |
| Preserve linker ACL invariant: `service_role` direct EXECUTE on `crm_company_link_contact` = **denied**; `authenticated` EXECUTE = allowed | ✅ both hold |
| Preserve other CRM RPC grants | ✅ untouched (cleanup migration only dropped the temp RPC) |

Catalog check after cleanup:

```
 replay_present       | f
 writer_present       | t
 writer_svc_exec      | t
 link_svc_exec_denied | t
 link_auth_exec       | t
```

---

## 8. What is NOT done and remains gated

- **Phase 3C real backfill:** NOT executed. Still blocked pending a separate explicit admin approval (a distinct decision from this rehearsal approval).
- No queue, no cron, no worker, no UI changes, no `types.ts`-visible surface (the temporary replay RPC was not part of any client type generation path and has been dropped).
- No permanent public endpoint exists for this rehearsal RPC or Edge Function.

---

## 9. Artifacts (persisted)

- `.lovable/discovery/companies-1.0/companies_phase3_backfill_discovery.md` (v1.2, unchanged)
- `.lovable/discovery/companies-1.0/companies_phase3_backfill_plan.md` (v1.2, unchanged)
- `.lovable/discovery/companies-1.0/companies_phase3b_identity_remediation_report.md` (v1.1, unchanged)
- `.lovable/discovery/companies-1.0/companies_phase3b_capability_blocker_report.md` (v1.0, superseded by this document; retained for audit trail)
- `.lovable/discovery/companies-1.0/companies_phase3b_rollback_rehearsal_report.md` (this document, v2.0)

Migrations added in this rehearsal session:

- `…_phase3b_rehearsal_replay.sql` — created private RPC + service-role-only ACL + preflight/postflight guards.
- `…_phase3b_rehearsal_cleanup.sql` — dropped the private RPC and re-verified permanent writer + linker ACL invariants.

No other schema, RLS policy, grant, table, sequence, function, view, trigger,
edge function, secret, cron, queue, worker, UI, or client type was modified.

---

**Conclusion.** Phase 3B rollback-only rehearsal is PASS. All in-transaction
counts, soft-flag counts, idempotency deltas, and post-rollback baselines
match the plan v1.2 forecast exactly. Phase 3C remains explicitly blocked
and requires its own separate approval.
