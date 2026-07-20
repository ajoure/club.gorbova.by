# Companies Phase 11 — cutover and operational runbook

Статус: hardening contract; production cutover не включён автоматически.

## Source-of-truth matrix

| Область | CRM identity | Compatibility / snapshot | Writer boundary |
| --- | --- | --- | --- |
| Companies list/search | `companies` + `search_companies` | `client_legal_details` только для реквизитов | guarded Companies RPCs |
| Billing requisites | `companies` после controlled upsert | исходный `client_legal_details` остаётся snapshot | service-role billing writer |
| Documents | `company_id` links | immutable document snapshot | document generator сохраняет snapshot |
| Orders/deals | `company_order_links` | `orders_v2` не переписывается | guarded link/unlink RPCs |
| Tasks | `crm_tasks.company_id` | contact task lineage сохраняется | `crm_task_create` с company context |
| Contact feed | `company_contacts` + linked profiles | external persons не создают `profiles` | contact writers unchanged |
| Company feed | company notes/tasks/events + linked contact feed | `contact_notes` остаётся contact-owned | `company_note_create`, `company_feed_list` |
| Company phone | `companies.phone` in normalized E.164 form (`+375…` for BY) | imported spreadsheet values may contain formatting/formula prefixes | company phone normalization trigger; `CallButton`/`SmsButton` with `company_id` |
| External integrations | `company_external_ids` | provider payloads outside canonical record | adapter boundary + reconciliation preview |
| Sheet migration | `company_import_batches` + ledger | Google Sheet read-only | explicit `_confirm=true` apply, max 100 rows |

## Rollout stages

1. Internal admins: run invariant report and preview batch; no production writes.
2. Controlled pilot: one approved batch slice (≤100 rows), verify notes, external IDs and tasks.
3. Manager group: continue cursor-based slices, review conflict/error ledger after each slice.
4. Support read-only: expose list/card/feed/structure; no write permissions.
5. Full rollout: only after seven days without invariant failures or unexplained import errors.
6. Architecture freeze: remove fallback writers only after the 30-day stability window.

## Company phone contract

`companies.phone` is the callable primary company contact, not a display-only
note. The phone boundary removes spreadsheet formula prefixes and common
Belarusian local formats before storing the value; UI reads use the same
normalization as a backward-compatible fallback. Additional imported numbers
remain in `metadata.google_sheet_import.phones[]` and are exposed in the
company card as the same callable `tel:`/Call/SMS actions. The company list
exposes the primary `tel:` link, while the company card routes every number
through the existing actions with `company_id`, so communication history remains
attached to the company.

## Stop conditions

- `crm_company_invariants_report().ok = false` for duplicate active UNP, broken merge, orphan task or inactive relation.
- any callback batch cannot resolve exactly one profile named «Полина Асманта».
- source key collision, external ID conflict, ambiguous exact match, or invalid normalized row.
- build/CI failure or Lovable sync not at the merged `main` SHA.

## Rollback

`company_import_ledger` is the ownership boundary. Rollback tooling may remove
only rows with the selected `source`/batch key, company-owned imported notes,
import-created external IDs/person links and tasks. Existing canonical fields,
documents, user notes, contact profiles and unrelated links are never deleted by
an import rollback. A rollback must be a separately reviewed operation.

## Initial SLOs

- Companies search p95: ≤ 500 ms for a 25-row page.
- Company card p95: ≤ 1.5 s with feed and structure tabs lazy-loaded.
- Import slice: ≤ 100 rows per transaction; conflict/error rate visible after every slice.
- Invariant report: ≤ 2 s on the normal CRM dataset.
- Lovable/GitHub sync: merged SHA visible in Lovable before operator verification.
