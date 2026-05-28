# Sprint 3F Phase 2b — proof (2026-05-28)

## ВЫПОЛНЕНО

### 1. `TemplateBindingControl` (новый компонент)
`src/components/ai-documents/packages/TemplateBindingControl.tsx`
- Список привязанных шаблонов из `document_package_template_items` для выбранного пакета.
- Select со всеми незанятыми `document_templates` (deleted_at IS NULL).
- Привязка: `supabase.rpc("package_template_bind_template", { _template_id, _package_template_id })`.
- Отвязка: `supabase.rpc("package_template_unbind_template", { _template_id, _package_template_id })`.
- НИ ОДНОГО direct INSERT/DELETE в `document_package_template_items` и `document_templates.template_scope`.
- Audit пишется триггерами Phase 2 (`audit_package_template_items_change`) + самими RPC.

### 2. `PackageTemplateValidationPanel` (новый, read-only)
`src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx`
- Источник: либо активная версия привязанного шаблона (download из storage), либо локальный .docx.
- `mammoth.extractRawText` → regex `{{...}}` → классификация:
  - `valid`: `field:FLD-XXXXXX` (system), `package.(ul|ip|fl).FLD-XXXXXX`, `package.role.PKR-XXXXXX`;
  - `warning`: `field:FLD-XXXXXX` в package-scope (биллинговое поле в пакетном шаблоне — не блок, ревью);
  - `warning`: `package.roles.<role>.<attr>` (deprecated синтаксис → нужно мигрировать на PKR);
  - `error`: legacy `document|executor|customer|deal|cf.*`, мусор.
- Никаких вызовов `canonical-document-generate-strict`, Gotenberg, INSERT в `ai_generated_documents`,
  UPDATE `document_templates` / `document_template_versions`, billing-резолвера.

### 3. `PackageAdminPanel` (композит)
`src/components/ai-documents/packages/PackageAdminPanel.tsx`
- Селект пакета (auto-select первого).
- Встраивает `PackageRolesManager` (Phase 2) + `TemplateBindingControl` + `PackageTemplateValidationPanel`.

### 4. Sub-tab `pkg-admin` в `AiPageContent`
`src/components/ai-chat/AiPageContent.tsx`
- Тип SubTab расширен `"pkg-admin"`.
- `DOC_SUB_TABS` получил пункт «Админ. пакеты» (Shield-иконка, `adminOnly: true`).
- Render-блок: при `activeSubTab === "pkg-admin"` рендерится `<PackageAdminPanel />`.
- Виден в `/admin/documents` (mode="admin", section="documents").
- НЕ виден пользователю в `/document-generation` (mode="user" фильтрует adminOnly).

## ЗАПРЕТЫ — повторная проверка
```
$ rg -n "canonical-document-generate-strict|gotenberg|ai_generated_documents" \
    src/components/ai-documents/packages/
(пусто)

$ rg -n "from\(\"document_package_template_items\"\)\s*\.\s*(insert|delete|update)" \
    src/components/ai-documents/packages/
(пусто — все мутации через RPC)

$ rg -n "template_scope.*=" src/components/ai-documents/packages/
(пусто — template_scope меняется только RPC и триггером)
```

## Billing regression — нетронуто
- `src/components/ai-requisites/`, `src/hooks/useLegalDetails*`, `useAiEntities*`, `useAiPersons*` — БЕЗ ИЗМЕНЕНИЙ.
- `supabase/functions/canonical-document-generate-strict/` — БЕЗ ИЗМЕНЕНИЙ.
- `supabase/functions/_shared/resolve-package-tokens.ts` (`HARDCODED_ENABLED=false`) — БЕЗ ИЗМЕНЕНИЙ.
- Никаких новых FLD; биллинговые группы «Заказчик ЮЛ/ИП/ФЛ», «Исполнитель ЮЛ» не модифицированы.
- `package.*` токены не разрешены в billing-резолвере (резолвер не трогали).

## DoD Phase 2 (актуальный статус)
- [x] Миграция: триггеры защиты system-ролей, аудит, admin-only RPC. (Phase 2)
- [x] UI per-package roles CRUD (PackageRolesManager). (Phase 2)
- [x] Анкета читает роли из БД без хардкода. (наследовано)
- [x] Каталог показывает PKR-токены активных ролей пакета. (Phase 1)
- [x] **Bind/unbind шаблона через admin-only RPC с audit** — `TemplateBindingControl` (Phase 2b).
- [x] **Controlled validation panel: valid/warning/error без генерации** — `PackageTemplateValidationPanel` (Phase 2b).
- [x] `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing-резолвер — нетронуты.
- [x] Sub-tab `pkg-admin` встроен в `/admin/documents`.

## Что НЕ сделано (вне scope Phase 2b)
- Реальный dry-run / generation для пакетов — Sprint 3G.
- Полный per-role audit-trail в UI (сейчас audit пишется в БД, отдельной view нет) — backlog.
- Backfill старых `{{package.roles.<role>.<attr>}}` шаблонов на PKR — отдельная миграция-помощник.

## Следующий шаг
Sprint 3G: контролируемый dry-run одного пакета на тестовых данных, без записи в production `ai_generated_documents` (`HARDCODED_ENABLED` остаётся `false` до отдельного approve).
