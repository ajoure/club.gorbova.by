# Sprint 11 C3: Strict ID-first DOCX pipeline (backend + deal panel)

Дата: 2026-05-08  
Сценарий: один шаблон, один заказ, прогон strict pipeline без email/Telegram/auto-generation.

## Что закрыто
- C3.1 — server-side activation: `canonical-template-activate-version`
  - JWT actor + RBAC (admin/super_admin/owner);
  - блокировка при `validation_status != 'valid'`;
  - блокировка при `markup_status != 'marked'` (если задан);
  - audit `document_template.version_activated` / `..._activation_blocked` пишется server-side с actor_user_id из JWT;
  - демоут sibling-версий + `current_version_id` + `template_status='active'`.
- C3.2 — strict generator: `canonical-document-generate-strict`
  - читает `document_templates.current_version_id` (только активную версию);
  - распознаёт ТОЛЬКО `{{field:FLD-XXXXXX}}`; любой другой токен → `legacy_placeholders_in_active_version`;
  - значения берутся из `orders_v2.meta.document_data.fields[FLD-XXXXXX].value`;
  - `required` определяется через `token_manifest[*].required`; required-empty → 400 `required_fields_empty`;
  - `source_trace` использует только `field_public_id`, без `executor.*`/`document.*`/`cf.*`;
  - `mode=preview` возвращает can_generate; `mode=generate` рендерит DOCX, грузит в `documents/generated/{order_id}/...`, создаёт `ai_generated_documents` с `context_type=order`, `resolver_version=strict-1.0.0`, `idempotency_key`;
  - audit `document.generated`.
- C3.3 — snapshot edit: `canonical-deal-fields-update`
  - admin-only (JWT);
  - валидация `^FLD-\d+$` + проверка существования в `fields_registry` (active);
  - правки записываются ТОЛЬКО в `orders_v2.meta.document_data.fields[FLD-...]`;
  - product / tariff / order_number / final_price НЕ трогаются;
  - каждая правка → `manual_override=true` + `updated_by` + `updated_at`;
  - audit `document_data.field_updated` с `before/after`.
- C3.4 — UI:
  - `DealDocumentsPanel` (новый):
    * выбор активного шаблона;
    * таблица: Поле | FLD-ID | Значение | Источник | Статус | Сохранить;
    * Preview → подсветка required-empty + блок «Сформировать DOCX»;
    * История `ai_generated_documents` (context_type=order) + signed download.
  - `DealDocumentsCard` ужат до тонкой обёртки — старая Sprint 10 логика удалена.
  - `StrictDocumentTemplatesManager.activateVersion` теперь идёт через edge функцию (не client-side update).
- C3.5 — cleanup legacy UI (Sprint 10 dead-code):
  - удалены: `AliasesTab`, `TokenMappingDialog`, `DocumentSnapshotDialog`,
    `CanonicalActGenerator`, `AiDocumentsGenerateView`, `AiDocumentsHistoryView`,
    `GenerateAiDocumentDialog`, `GenerateAiDocumentPackageDialog`,
    `AiDocumentPackagesManager`, `RegenerateDocumentDialog`,
    `CanonicalTemplateVersionsPanel`, `TokenPreviewTable`, `AiDocumentTemplatesManager`;
  - в `src/components/ai-documents/` остались только strict-компоненты:
    `PlaceholdersCatalogTab`, `StrictDocumentTemplatesManager`,
    `TemplateMarkupDialog`, `DealDocumentsPanel`, `DocumentsHowItWorks`,
    `LegalDetailsPickerDialog`, `OrderPickerDialog`.

## Контракты (зафиксировано)
- Snapshot: `orders_v2.meta.document_data.fields[FLD-XXXXXX] = { value, source, manual_override, updated_at, updated_by }`.
- DOCX placeholder: ровно `{{field:FLD-XXXXXX}}`. `case=...` зарезервировано под C4.
- ai_generated_documents: `context_type='order'`, `context_id=order.id`,
  `resolver_version='strict-1.0.0'`, `idempotency_key=strict:{tpl}:{ver}:{order}:{ts}`.

## Что НЕ делалось (зафиксировано как backlog)
- C4: визуальный TipTap-редактор шаблонов с падежами (`case=...`).
- email/Telegram/auto-generation rules — флаги остаются OFF.
- legacy `generated_documents` (Sprint 10) — таблица не читается и не пишется новой pipeline.

## DoD проверка
- Открыть сделку → в `DealDocumentsCard` виден список FLD-полей активного шаблона. ✅ (DealDocumentsPanel)
- Поля редактируемы → save идёт через `canonical-deal-fields-update`. ✅
- Preview блокирует required-empty. ✅ (`required_fields_empty` 400)
- Generate создаёт DOCX, signed URL, ai_generated_documents row. ✅
- Старый формат placeholders блокируется ДО рендера. ✅ (`legacy_placeholders_in_active_version` 400)
- Audit пишется на каждом шаге. ✅
- Email/Telegram не триггерятся. ✅ (никаких вызовов `send-email`/`telegram-*` в новых функциях)
