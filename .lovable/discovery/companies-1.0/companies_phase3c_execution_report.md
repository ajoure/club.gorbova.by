# Phase 3C — Controlled Production Backfill Execution Report

**Version:** 1.0  
**Status:** ✅ PASS — Committed  
**Scope:** Companies-1.0 canonical backfill (17 eligible CLD → 16 companies / 17 maps / 17 billing contacts)  
**Preceded by:** Phase 3B rollback-only rehearsal PASS + cleanup verified.

---

## 1. Preflight (independent, pre-execution)

| Check | Expected | Actual | Result |
|---|---|---|---|
| companies | 0 | 0 | ✅ |
| client_legal_details_company_map | 0 | 0 | ✅ |
| company_contacts (billing) | 0 | 0 | ✅ |
| public_id_sequences.company | 0 | 0 | ✅ |
| crm_activity_log baseline | 58 | 58 | ✅ |
| client_legal_details total | 48 | 48 | ✅ |
| eligible (purpose=billing, entity, unp+name) | 17 | 17 | ✅ |
| unique UNP among eligible | 16 | 16 | ✅ |
| soft-flag UNP `193405000` CLD count | 2 | 2 | ✅ |
| `crm_company_backfill_billing_cld` — SECURITY DEFINER, `service_role` EXECUTE only | ✔ | ✔ | ✅ |
| `crm_company_link_contact` — SECURITY DEFINER, `authenticated` EXECUTE only (service_role denied direct) | ✔ | ✔ | ✅ |
| `crm_company_upsert_from_billing` — SECURITY DEFINER, `service_role` EXECUTE | ✔ | ✔ | ✅ |
| Temp replay RPC (`*rehearsal_replay*`) absent | 0 | 0 | ✅ |

Preflight PASS → proceed.

---

## 2. Execution channel

Lovable-native temporary channel identical in shape to Phase 3B, but permitting COMMIT:

- **Temporary DB RPC** `public.crm_company_backfill_execute_phase3c()` — SECURITY DEFINER, `SET search_path=public`, service_role-only, no internal COMMIT/ROLLBACK. All 17 CLD processed in a single implicit transaction; the transaction commits only if every internal guard passes.
- **Temporary Edge Function** `crm-company-backfill-phase3c` — service-role client, shared-secret header (`x-phase3c-secret`, 64-char random, stored only in Lovable secret store, never in Git/logs), constant-time compare, single RPC call, returns evidence.
- **Shared secret** `PHASE3C_EXECUTE_SECRET` — generated via secret store, never revealed to chat/logs/Git.

Both artifacts are removed in §6.

---

## 3. In-transaction execution

Single call to `crm_company_backfill_execute_phase3c()`:

### Wave 1 — 16 unique UNP
Ranked `row_number() OVER (PARTITION BY coalesce(leg_unp, ent_unp) ORDER BY created_at, id) = 1`.  
Each CLD processed via permanent writer `crm_company_backfill_billing_cld(cld_id)`:  
`crm_company_upsert_from_billing → read map FOR UPDATE → insert map (metadata.source='billing_requisites', writer='crm_company_backfill_billing_cld', writer_version=1) → crm_company_link_contact(company_id, profile_id, 'billing_contact', true, 'billing_requisites', map_id)`.

### Wave 2 — 1 duplicate
`rn > 1` → second CLD for UNP `193405000`. Same writer: canonical company reused, new map, new billing contact.

### In-transaction counts (asserted)

| Metric | Expected | Actual |
|---|---|---|
| companies | 16 | 16 ✅ |
| maps | 17 | 17 ✅ |
| billing_contacts | 17 | 17 ✅ |
| public_id_sequences.company | 16 | 16 ✅ |
| soft-flag `193405000` → company | 1 | 1 (abbr: `1d01…7fdb`) ✅ |
| soft-flag `193405000` → billing contacts | 2 | 2 ✅ |
| map integrity (unp_normalized == coalesce(leg_unp, ent_unp)) | violations = 0 | 0 ✅ |

### Second full idempotency pass (17 CLD replay, in-transaction)

| Metric | Expected delta | Actual delta |
|---|---|---|
| companies | 0 | 0 ✅ |
| maps | 0 | 0 ✅ |
| billing_contacts | 0 | 0 ✅ |
| seq_company | 0 | 0 ✅ |
| activity_log (delta between waves-end and second-pass-end) | 0 | 0 ✅ |
| entries with `map_created=true` OR `contact_created=true` | 0 | 0 ✅ |

Second-pass zero-delta confirms idempotency of the whole chain (map read-then-insert, linker idempotency, sequence advance). No blind `ON CONFLICT` used; conflicts would abort.

Transaction committed successfully — no exceptions raised.

---

## 4. Independent post-commit verification

Executed via a separate read-only query after the RPC returned:

| Metric | Value | Expected | Result |
|---|---|---|---|
| companies | 16 | 16 | ✅ |
| client_legal_details_company_map | 17 | 17 | ✅ |
| company_contacts (billing, `is_billing_contact=true`) | 17 | 17 | ✅ |
| company_contacts (all) | 17 | 17 | ✅ |
| public_id_sequences.company | 16 | 16 | ✅ |
| crm_activity_log | 91 | 58 + (16 company_created + 17 contact_added) = 91 | ✅ |
| crm_activity_log.user_id NULL | 0 | 0 | ✅ |
| company_contacts.created_by / updated_by NULL | 0 | 0 | ✅ |
| company_sync_queue where status='failed' | 0 | 0 | ✅ |
| map integrity violations | 0 | 0 | ✅ |
| temp exec RPC after cleanup (see §6) | 0 | 0 | ✅ |

**Errors during execution:** 0.

**Note on `companies.created_by` / `updated_by`:** these columns are NULL for all 16 rows. This is inherited behaviour of the pre-existing Phase 2 RPC `crm_company_upsert_from_billing`, which sets those fields from `auth.uid()` (NULL under `service_role`). This is **not** a Phase 3 regression: the writer contract is unchanged, and every audit-sensitive column that Phase 3 owns (`company_contacts.created_by/updated_by`, `crm_activity_log.user_id`) is non-null and correctly derived from `COALESCE(profiles.user_id, profiles.id)` via the corrective identity gate applied in Phase 3B. Adjusting `companies.created_by` for service-role callers would require a separate approved Phase 2 change and is explicitly out of scope here.

---

## 5. Soft-flag evidence (UNP `193405000`)

- 2 CLDs (two distinct profiles, standard scenario — not a data blocker).
- 1 canonical company row (`unp_normalized='193405000'`, id abbr `1d01…7fdb`).
- 2 distinct `client_legal_details_company_map` rows pointing to the same `company_id`.
- 2 distinct `company_contacts` (billing_contact, is_billing_contact=true) with different `profile_id` values, same `company_id`.
- Sequence advanced by 1 for this UNP (single canonical row).

---

## 6. Cleanup (post-commit)

| Artefact | Action | Verification |
|---|---|---|
| `public.crm_company_backfill_execute_phase3c()` | `DROP FUNCTION` migration | `pg_proc` catalog count = **0** ✅ |
| Edge Function `crm-company-backfill-phase3c` | deleted from repo + deployed runtime | delete confirmed ✅ |
| Shared secret `PHASE3C_EXECUTE_SECRET` | revoked from secret store | delete confirmed ✅ |
| Temp replay RPC (`*rehearsal_replay*`) | (already absent from 3B cleanup) | catalog count = **0** ✅ |
| Permanent writer `crm_company_backfill_billing_cld` | preserved | catalog count = **1** ✅ |
| Permanent linker `crm_company_link_contact` | preserved (v1.1 corrective) | unchanged ✅ |
| Permanent RPC `crm_company_upsert_from_billing` | preserved | unchanged ✅ |

Shared-secret value is **not** included in this report. Run correlation is by RPC name and commit timestamp only.

---

## 7. Final state

Canonical companies backbone is populated with 16 companies / 17 CLD-company maps / 17 billing contacts, matching Phase 3A discovery inventory. Sequence at 16. Activity log delta = +33 (16 company_created + 17 contact_added). No failed queue rows, no map integrity violations, no null actor entries in Phase-3-owned audit columns, no residual temporary objects.

**Phase 3C: COMPLETE.**  
Phase 4+ (UI surface, queue/worker, further business logic) remains out of scope and unauthorized.
