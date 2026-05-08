---
name: Document Field-ID First Canon (Sprint 11)
description: В новой документной pipeline единственный допустимый плейсхолдер — {{field:FLD-XXXXXX}}; никаких alias/cf/token_key
type: constraint
---

В новой системе документов (Sprint 11+) единственный SOT идентификатор поля — `fields_registry.public_id` формата `FLD-XXXXXX`.

Единственный допустимый формат плейсхолдера в DOCX:

```
{{field:FLD-XXXXXX}}
```

**Запрещено** в новой pipeline (DOCX, каталог, picker, snapshot, manifest, source_trace, resolver, UI копирование):
- `{{document.amount}}`, `{{executor.name}}`, `{{customer.name}}`, `{{deal.amount}}`
- `{{cf.*}}` (включая `{{cf.legal_details.*}}` и `{{cf.product.*}}`)
- любой `token_key` или alias-слой

**Source of truth:**
- `document_token_registry.field_id` → `fields_registry.id` (UUID, FK; backfilled 157/157 в Sprint 11).
- В DOCX/manifest/snapshot/UI используется только `fields_registry.public_id`.
- `document_token_registry.token_key` — deprecated, остаётся для legacy-вкладок (AliasesTab) и поиска, но НЕ читается новой pipeline.

**Snapshot формат** (`orders_v2.meta.document_data.fields`):

```json
{
  "FLD-000123": {
    "value": 250,
    "source": "offer.document_defaults.amount" | "manual" | "computed" | "system",
    "label": "Сумма акта",
    "updated_at": "..."
  }
}
```

**source_trace** допускает только: `field_public_id`, `manual_override`, `computed_field`, `system_generated`.

**Validation** (`canonical-template-validate`): любой `{{...}}` не соответствующий regex `^\{\{field:FLD-[0-9]+\}\}$` → critical error `legacy_placeholder_format_detected`.

**История документов сделки** идёт через `ai_generated_documents`. Legacy `generated_documents` не трогается и не смешивается.

**Кросс-ссылка:** `.lovable/plan.md`, `.lovable/proofs/document_generation_sprint11_field_id_discovery.md`.
