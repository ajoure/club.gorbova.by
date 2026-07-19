# CRM Companies Phase 2 — Runtime Proof and Closure Report

**Status:** `CLOSED PASS`
**Date:** 2026-07-19
**Database ref:** `hdjgkjceownmmnrqqtuz`
**Admin fixture:** `1@ajoure.by`, auth user `37e91f59-e4db-4840-b9c9-e760e634ddd1`
**Scope boundary:** Phase 2 canonical RPC layer only. Phase 3/backfill was not started.

## 1. Applied artifacts

| Artifact | Purpose | Bytes | SHA-256 |
|---|---|---:|---|
| `supabase/migrations/20260719210633_crm_companies_phase2_rpc_layer.sql` | canonical forward source | 68,739 | `990fa56df274cd75a6509647e540cfd4858e46730df11d179167d36c21caf2de` |
| `supabase/migrations/20260719214544_9aa2edb0-c9dc-4636-a1b4-711accf867c5.sql` | Lovable-managed applied forward history | 68,450 | `3943ea306a2c296d4717b7e3b833f7869666b47fc081e7fcb28fe4c72d351aeb` |
| `supabase/migrations/20260719235959_crm_company_billing_array_append_fix.sql` | canonical corrective source | 22,198 | `11719a8db96444e3fb5ebd2af582637a6a9df12ed9f31751dd35e604374ee24d` |
| `supabase/migrations/20260719221105_7ba01396-e921-4be5-b180-2a770a98d708.sql` | Lovable-managed applied corrective history | 20,548 | `63c8f6561aa934dd951cfacafb7afaebd79b2a70c0bf8705ae6db6f2528dbfc6` |
| `.lovable/rollback/companies-phase2/phase2_rpc_rollback.sql` | full Phase 2 rollback | 5,320 | `6038be4d205bcd78750247ebee4e807db109ca038d7bb1a376654a7f1e2f56f0` |

The managed migrations are retained as immutable deployment history. The canonical
files remain the reviewed source for fresh environments and future maintenance.

## 2. Apply and corrective history

1. The first apply attempt stopped on an ACL assertion that incorrectly expected
   `search_global` to be executable by `authenticated`. The transaction rolled back in
   full; no database changes or residue were left.
2. The assertion was corrected to preserve the actual stronger ACL:
   `anon=false`, `PUBLIC=false`, `authenticated=false`, `service_role=true`. The forward
   migration then applied successfully.
3. The first rollback-only runtime proof passed create, search, contact link,
   GRP-refetch, archive and merge, then exposed `SQLSTATE 22P02` in billing ownership
   tracking (`text[] || 'scalar'`). That proof transaction also rolled back in full;
   all four CRM tables remained empty and the CMP sequence remained `0`.
4. The corrective migration replaced all 24 ambiguous scalar-array concatenations with
   `array_append(text[], text)`, preserved service-role-only ACL, and asserted that no
   old expression remained. PostgreSQL grammar checks passed for forward, corrective
   and rollback SQL before apply.

Relevant merged changes: GitHub PR #1 (`443a4e26`), PR #3 (`734e5930`) and PR #4
(`1eb243aa`). Lovable managed apply commits are `c5ff8ad7` and `80e5c753`.

## 3. Functional runtime proof

The main rollback-only proof passed these contracts:

- `crm_company_get_or_create`: create, repeated idempotent resolve, stable UUID/public ID;
- `crm_company_link_contact`: create/update, deduplication and invalid billing-lineage reject;
- `search_companies` and the additive `search_global.companies` branch;
- read/deny role matrix;
- `crm_company_grp_refetch`: queue idempotency;
- admin `crm_company_archive` and `crm_company_merge`, including conflicting links and
  merged-chain handling;
- event, activity, audit and queue side-effect contracts.

The billing re-proof (`phase2-proof-billing-v2-1eb243aa`) passed all seven scenarios:

1. first billing sync creates the canonical company and snapshot;
2. repeated identical input is a true no-op;
3. a newer source updates an owned field;
4. a manual override is preserved and records exactly one override conflict;
5. a newer incoming `NULL` does not clear the target or snapshot;
6. a stale source is ignored;
7. repeated inputs do not duplicate events or activity.

All billing fixtures were inside a rollback transaction. Independent post-check:
`companies=0`, `company_contacts=0`, `client_legal_details_company_map=0`,
`company_sync_queue=0`, CMP sequence `0`, and no fixture CLD residue.

The zero map count is expected in Phase 2. Per the approved specification, creation of
`client_legal_details_company_map` rows belongs to the Phase 3 backfill orchestration,
not to `crm_company_upsert_from_billing` itself.

## 4. Real two-session concurrency proof

Run tag: `phase2-proof-concurrency-v1-1eb243aa`.

Both workers used independent PostgreSQL sessions and the same authenticated JWT claims.
A shared wall-clock barrier started each pair together; timestamps demonstrate overlap.

### 4.1 Company get-or-create

Inputs: `BY`, UNP `999770001`, `ACME Concurrency Proof`, `legal_entity`, `manual`.

| Worker | RPC start UTC | RPC end UTC | Returned company UUID |
|---|---|---|---|
| W1 | `22:24:24.290831` | `22:24:24.385101` | `270b0637-32d4-41f4-ba42-6616a7d2553e` |
| W2 | `22:24:24.285296` | `22:24:24.336575` | `270b0637-32d4-41f4-ba42-6616a7d2553e` |

W2's 51 ms window is fully inside W1's 94 ms window. Both calls succeeded, returned
the same UUID, produced no unique violation, and left exactly one `CMP-000001` company.

### 4.2 Contact link

Inputs: the company above, profile `e3a2744b-f5d1-4406-a416-64828a3be971`,
relationship `representative`, `billing=false`, source `manual`.

| Worker | RPC start UTC | RPC end UTC | Returned contact UUID |
|---|---|---|---|
| B1 | `22:24:42.814982` | `22:24:42.907592` | `c8cf1255-ef87-4a97-a27f-54c77eca1007` |
| B2 | `22:24:42.809618` | `22:24:42.860809` | `c8cf1255-ef87-4a97-a27f-54c77eca1007` |

B2's window is fully inside B1's window. Both calls succeeded, returned the same UUID,
and left exactly one contact.

Despite four overlapping RPC calls, side effects were deduplicated to two domain events,
two CRM activity rows and one company-create audit row. Manual source produced no queue row.

## 5. Cleanup and final invariants

Cleanup removed only captured IDs in FK-safe order inside one transaction. The CMP
sequence was restored from `1` to `0` only after guards confirmed `companies=0` and the
current sequence value was exactly the proof allocation. No broad pattern delete was used.

Independent final post-check:

| Invariant | Final value |
|---|---:|
| `companies` | 0 |
| `company_contacts` | 0 |
| `client_legal_details_company_map` | 0 |
| `company_sync_queue` | 0 |
| CMP sequence | 0 |
| proof UNP/UUID event, activity and audit residue | 0 |
| Phase 1 policies | 13 |
| admin fixture role access | unchanged |

No Phase 3 data migration, UI work, worker, cron or backfill was executed.

## 6. Closure decision

Phase 2 acceptance criteria are met. The canonical RPC layer is applied, corrected,
functionally proved, concurrency proved and returned to a clean baseline. Phase 2 is
therefore **CLOSED PASS**. Phase 3 remains a separate, not-yet-started sprint.
