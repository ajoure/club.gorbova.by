# Phase 5A — CRM links discovery

**Basis:** repository `main` at `f821f81f5` (after Phase 4D activation).
**Scope:** read-only schema and writer inventory. No runtime data, permissions, tables, triggers, or legacy records were changed.

## Facts established from the current implementation

| Domain in the plan | Actual canonical model | Current company field | Important observation |
| --- | --- | --- | --- |
| Deals / orders | `orders_v2` (the Deals UI treats an order as a deal) | none | `profile_id` remains the contact; there is no `company_id` or billing-CLD foreign key. |
| Tasks | `crm_tasks` | none | It already has nullable `contact_id`, `deal_id`, and `order_id`, and all write paths use the guarded `crm_task_*` RPC layer. |
| Company/billing lineage | `client_legal_details_company_map` | `company_id` | A map exists per billing CLD, but no reliable FK connects an historic `orders_v2` row to that CLD. |
| Audit/events | `crm_activity_log`, `domain_events` | company events exist | The private company event helper is intentionally non-callable outside the controlled company layer. |
| Search | `search_global` + `search_companies` | additive company result | Global search finds companies, but does not yet show a company on a deal/task result. |

## Writer and compatibility inventory

`orders_v2` is a high-write legacy/operational table: checkout, payment, recurring charge, GetCourse import, Stripe and reconciliation functions, and the Deals board all read or write it. Its generated types confirm that the table has no company or legal-details column. A direct mandatory FK would therefore touch a large writer surface and risks breaking revenue flows.

`crm_tasks` is newer and has a controlled security-definer interface: `crm_task_create(payload)` and `crm_task_list(_filters)`. It is the correct extension point for a nullable `company_id`; profile and company can coexist exactly as required by the plan.

The only verified CLD relation outside the Companies domain is in document-oriented tables. No verified relation from an existing order to a selected billing CLD was found. Consequently, a historic order must **not** be linked merely because its profile owns a billing record or because a company name matches.

## Architecture decision for Phase 5B

### Deals and orders: additive link table

Choose `company_order_links`, not `orders_v2.company_id`.

Required fields:

```text
id, workspace_id, company_id, order_id,
relationship_role, source, source_client_legal_details_id,
created_by, updated_by, created_at, updated_at, metadata
```

Allowed roles begin with `customer`, `payer`, `beneficiary`, `contract_party`, `employer`, and `partner`. A unique active relation per `(company_id, order_id, relationship_role)` prevents duplicate writers while allowing multiple companies and a retained lineage source. Both FKs must be `ON DELETE RESTRICT`/soft lifecycle-compatible; link removal is an audited state transition, not a destructive cascade.

This choice is required because one order may involve a contact, a payer and a separate contract party, and because source/lineage is needed for safe later reconciliation. It leaves every existing `orders_v2` writer untouched.

### Tasks: nullable direct FK

Choose `crm_tasks.company_id uuid REFERENCES companies(id) ON DELETE SET NULL`, plus an index `(workspace_id, company_id, status, due_at)`. Extend only the existing task create/list RPC payload and filters. A task has one primary company context, while retaining its optional contact/deal/order links; a link table would add no value here.

## Required controlled API surface

Do not grant direct browser writes to the proposed link table. Phase 5B should provide security-definer RPCs that:

1. validate staff/Companies-manage permission and workspace;
2. lock both company and order rows;
3. validate role, source and optional CLD-map lineage;
4. insert/reuse an idempotent link or retire a manual link;
5. append an audit row and emit `company.linked_to_order.v1` / `company.unlinked_from_order.v1` with an idempotency key.

The Phase 2 private event helper should not be made public. The Phase 5 migration needs its own narrowly scoped event/audit routine or a private helper callable only by the new RPCs.

## Legacy migration rule

No automatic Phase 5C backfill is safe yet. There is no verified `orders_v2 → client_legal_details` lineage to traverse. The Phase 5B migration must first capture explicit source CLD IDs on new links. Phase 5C can then backfill only rows with a real, queryable billing-CLD reference; all other rows go to an ambiguity report. Matching by company name, profile ownership alone, email, or UNP copied into arbitrary JSON is prohibited.

## Next safe implementation sequence

1. Implement the additive `company_order_links` schema, guarded RPCs, event/audit contract and SQL assertions.
2. Add the nullable task FK and extend the existing guarded task RPCs.
3. Add read-only deal/task panels to the Company card and a company picker to manual link/task creation flows.
4. Run an evidence-only Phase 5C dry-run before writing any historic link.

## Hard stops retained

- Do not modify payment, checkout, GetCourse, Stripe, or reconciliation writers in Phase 5B.
- Do not infer old company links from names or a profile alone.
- Do not widen RLS or direct table grants.
- Do not deploy Phase 4E runtime configuration from this discovery step.
