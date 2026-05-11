---
name: Document Snapshot History Layer SOT
description: ai_generated_documents — единственный исторический слой snapshot-ов генерации; orders_v2.meta.documents хранит только operational override/status
type: feature
---

## Канон

Полный исторический snapshot факта генерации документа хранится **только** в существующей таблице `ai_generated_documents`. Новые history-слои не создаются.

### Что куда пишется

**`ai_generated_documents` (history SOT):**
- `snapshot` — полный resolved-контекст документа: `{ fields, payment, payer, scenario, requirements_check }`
- `source_trace` — упорядоченный список источников (`payments_v2`, `orders_v2`, `tariff_offers.meta.document_scenarios|document_defaults`, `document_templates`, `document_template_versions`, `individual_requisites|legal_entities_requisites`, `executors`)
- `warnings_snapshot` — info/warning/error по полям
- `template_version_id`, `template_tokens_snapshot`, `token_manifest_snapshot`
- `meta` — minimal technical IDs для поиска: `{ order_id, deal_id, payment_id, payer_type, payer_type_source, scenario_id }`

**`orders_v2.meta.documents` (operational only, НЕ history):**
- `payer_type_source: 'auto'|'admin_override'`
- `payer_entity_override: { kind, id } | null`
- `template_override: uuid|null`
- `executor_override: uuid|null`
- `current_status: { requisites_status, checked_at, last_blocking_reason }`

### STOP-guards
- Запрещено писать полный snapshot генерации в `orders_v2.meta`. Order — коммерческая сущность; snapshot — исторический факт.
- Запрещено создавать новый history-слой. `generated_documents` (legacy parallel) не трогаем.
- `selectCanonicalPayment` (read-only) при множественных succeeded возвращает последний и пишет в snapshot `selection_reason: 'latest_successful_payment'`. Никаких repair/reconcile.

### Связанное
- Helper канала — `_shared/document-resolver-v2/payment-channel.ts`
- Helper статуса — `_shared/document-resolver-v2/payment-status.ts`
