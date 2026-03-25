
# S4-INTERNAL-TEMPLATE-EDITOR — Phase 1: corp_order_meeting

## Статус: ✅ Phase 1 выполнена

## Что сделано

### Миграция БД
- `template_status TEXT DEFAULT 'in_development'` — статус шаблона
- `editor_mvp_enabled BOOLEAN DEFAULT false` — флаг доступности редактора
- `editor_draft_content JSONB DEFAULT NULL` — staging-only draft (не SoT для runtime)
- `corp_order_meeting` → `editor_mvp_enabled = true`, `template_status = 'draft'`
- `corp_review_list`, `corp_notice`, `corp_notice_journal`, `corp_sole_decision` → `template_status = 'draft'`

### Созданные файлы
- `src/lib/corporate/templateEditorMapper.ts` — маппинг token ↔ UI label
- `src/lib/corporate/templateEditorTestData.ts` — тестовые данные для preview
- `src/hooks/useCorporateTemplateEditor.ts` — хук: DOCX → draft → save/load
- `src/components/corporate-editor/CorporateTemplateEditorDialog.tsx` — fullscreen dialog
- `src/components/corporate-editor/EditorModeView.tsx` — режим редактирования с подсветкой
- `src/components/corporate-editor/PreviewModeView.tsx` — raw preview + editor preview

### Изменённые файлы
- `src/hooks/useDocumentTemplates.tsx` — расширен DocumentTemplate interface
- `src/components/ai-documents/AiDocumentTemplatesManager.tsx` — кнопка "Редактор" + dialog

## Backlog
1. ~~S4-INTERNAL-TEMPLATE-EDITOR Phase 1~~ ✅
2. S4-INTERNAL-TEMPLATE-EDITOR Phase 2 — еще 4 документа + repeat blocks
3. S4-PASSPORT-TOKENS — паспортные поля в fields_registry
4. S4-EDITOR-DRAFT-TO-DOCX-EXPORT — export draft → DOCX runtime
5. S4-PASSPORT-TO-RUNTIME — паспортные данные в edge function payload
6. S4-DOCX-TO-RUNTIME-PROOF — runtime activation
