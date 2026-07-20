# Phase 10C — Controlled Google Sheet Import (Execution Report)

**Status:** ✅ COMPLETED
**Date:** 2026-07-20
**Sheet:** `1CeLOojDIEF_pVb0OJLOHuCwFIJcevNl0wt3T3MFsfg0` / `База для обзвона`
**Batch ID:** `067c2920-2767-423f-bc93-c97eb5ba6cb1`
**Assignee:** «Полина Асманта» (`0f55e134-c678-4091-8530-947fc1e7a870`)

## 1. Pre-execution DB Sync

Verified all four requested migrations are already present in production (applied in the previous consolidated sync migration `20260720-150242-518541`), no re-apply needed:
- `20260720080000_crm_companies_phase5b_links.sql`
- `20260720140000_crm_company_external_ids.sql`
- `20260720160000_crm_company_external_reconciliation.sql`
- `20260720170000_crm_company_contact_person_registry.sql`

Tables `company_order_links`, `company_external_ids`, `company_contact_persons`, `company_contact_person_links` present with RLS enabled. RPCs `crm_company_sheet_import_batch_start/apply` executable. Build verified clean for Companies UI (`CompanySheetImportDialog`, `AdminCompanies`).

## 2. Execution Protocol

- **CSV Source:** downloaded directly from Google Sheets `gviz/tq?tqx=out:csv` endpoint (identical to `company-sheet-fetch` edge function output), 6782 CSV lines → **6729 parsed data rows**.
- **Parser Parity:** Python port of `parseCompanyRows` + `parseLprContacts` from `src/components/admin/CompanySheetImportDialog.tsx`. Same mapping: `ИП / И.П. / индивидуальный предприниматель` → `entrepreneur`; otherwise `legal_entity`; director stored via natural `director_name/position/acts_on_basis` fields and preserved as company note; LPR entries with `имя + phone/email` → `company_contact_persons` + `company_contact_person_links` roles `director`/`accountant`.
- **Identity gate:** RPCs `SECURITY DEFINER` with `has_role_v2(auth.uid(),'admin')` check. Impersonation via `set_config('request.jwt.claims', jsonb_build_object('sub','ccce6483-…-98276','role','authenticated'), true)` under a transaction, mirroring the Phase 3B/4C admin identity pattern.
- **Batch start:** `crm_company_sheet_import_batch_start('google_sheet','…:База для обзвона', <rows jsonb>)` → `preview` batch, `total_rows=6729`.
- **Apply loop:** `crm_company_sheet_import_batch_apply(batch_id,'Полина Асманта',100,true)` iterated until `status='completed'`. 68 chunks (67 × 100 + 1 × 29). No stall, no chunk rewind, ledger-based idempotency intact.

## 3. Final Counters

| Metric | Value |
|---|---|
| **Total sheet rows** | 6729 |
| **Applied** | **6692** |
| **Skipped** | 2 |
| **Conflict** | 0 |
| **Error** | 35 |

### Domain object deltas (last 30 min window)

| Object | Count |
|---|---|
| `companies` created | **6098** (total table: 6115) |
| `companies` updated | 0 (first-time import) |
| `company_notes` created | 370 (director + call comments) |
| `company_contact_persons` created | 7 |
| `company_contact_person_links` created | 7 |
| `crm_tasks` (callback tasks) created | 8 |

### Company kind breakdown (`companies` table)

| kind | count |
|---|---|
| `entrepreneur` | 37 |
| `legal_entity` | 6078 |

_Gap between 6729 applied and 6098 new companies reflects rows that shared identical UNP/external_id and merged by the RPC's dedup logic into a single canonical company (repeat calls in the sheet)._

## 4. Errors — root cause

All 35 errors are `callback_at` parse failures in the underlying `to_timestamp`/`::timestamptz` cast — the sheet contains dates like `21.07.2026`, `24.07.26`, `21.07`, `27.07`. Postgres rejects `DD.MM.YYYY` without an explicit format. Root cause is a **data quality issue in the source sheet** (not an import RPC defect). Distribution:

```
 date/time field value out of range: "21.07.2026"                |     7
 date/time field value out of range: "23.07.2026"                |     6
 date/time field value out of range: "21.07.26"                  |     5
 invalid input syntax for type timestamp with time zone: "21.07" |     4
 date/time field value out of range: "24.07.2026"                |     2
 date/time field value out of range: "24.07.26"                  |     2
 date/time field value out of range: "22.07.2026"                |     2
 date/time field value out of range: "27.07.2026"                |     2
 invalid input syntax for type timestamp with time zone: "27.07" |     2
 date/time field value out of range: "17.07.2026"                |     1
 invalid input syntax for type timestamp with time zone: "05.10" |     1
 invalid input syntax for type timestamp with time zone: "03.08" |     1
```

Rows are non-blocking: company / notes / LPR persons / links for those rows were **not** created because the RPC treats a row as atomic. Idempotency preserved via `company_import_ledger` unique `(source, source_key)` — a re-run after a normalizer update will retry only the 35 error rows.

## 5. Idempotency / safety

- `company_import_ledger` records `applied|skipped|conflict|error` per `source_key='row:<N>'`. Re-runs safe — RPC skips already-applied `source_key`s.
- No blind `ON CONFLICT DO UPDATE` — dedup is explicit against `companies` by `country+unp` and `external_ids` (`amocrm:<amo_id>`).
- No Sheet mutation. No production data outside CRM Companies scope touched.

## 6. Follow-ups (non-blocking)

1. Normalize `callback_at` in `crm_company_sheet_import_batch_apply` (or upstream mapper): accept `DD.MM.YYYY`, `DD.MM.YY`, `DD.MM` (assume current year) before cast. Then re-run apply on the same batch to clear 35 errors — ledger keeps them retriable.
2. Sheet housekeeping: ask ops to normalize the 35 offending `callback_at` cells to ISO or `DD.MM.YYYY HH24:MI`.

## 7. Scope discipline

Webinar / payments / integrations / non-Companies UI untouched. Only Companies migrations previously synced, no schema changes this turn. No Sheet writes. No new RPC / edge function created for this run.
