# Sprint 3F Phase 2 — partial proof (2026-05-28)

## ВЫПОЛНЕНО

### 1. Backend миграция (применена)
`supabase/migrations/<phase2>_role_crud_guards.sql`:
- `guard_package_role_catalog_mutations` BEFORE UPDATE/DELETE:
  - DELETE для `is_system=true` → EXCEPTION (system-роль удалить нельзя).
  - UPDATE: `public_id`, `package_template_id` immutable для всех; для `is_system=true` также защищены `role_key`, `is_system`.
- `audit_package_role_catalog_change` AFTER INSERT/UPDATE/DELETE → `audit_logs` с actor=`auth.uid()`, action ∈ `package_role_created|updated|archived|restored|deleted`.
- `audit_package_template_items_change` AFTER INSERT/DELETE → action ∈ `package_template_item_linked|unlinked`.
- RPC `package_template_bind_template(template_id, package_template_id, sort_order?)` — admin/super_admin only через `has_role_v2`; upsert в `document_package_template_items`, выставляет `document_templates.template_scope='package'`.
- RPC `package_template_unbind_template(template_id, package_template_id?)` — admin/super_admin only; удаляет linkы; если у шаблона больше нет привязок → `template_scope='billing'`.

### 2. Frontend — роли пакета
- `src/hooks/usePackageRoleCatalog.ts` — list/create/update/archive/restore с автогенерацией `role_key` (translit + uniqueness suffix) и delegated `public_id` через триггер `assign_package_role_public_id`.
- `src/components/ai-documents/packages/PackageRolesManager.tsx` — admin UI:
  - таблица ролей выбранного пакета с PKR-кодом (моно), badge «Системная», копированием `{{package.role.PKR-XXXXXX}}` одной кнопкой;
  - диалог создания (label + description + `output_template` + required + sort_order) — `role_key` НЕ редактируется пользователем;
  - диалог редактирования — для system-ролей блокированы `role_key`/`public_id` (триггером БД) и недоступна архивация (UI-Lock);
  - архивация только soft (`is_active=false`) через AlertDialog;
  - подсказка по `output_template`: `{{full_name}} / {{short_name}} / {{position}}`.

### 3. Анкета (уже корректно из Sprint 1+3C)
`useDocumentPackageSession.roleCatalogQuery` читает `document_package_role_catalog` WHERE `package_template_id` AND `is_active=true` ORDER BY `sort_order` — без хардкода. `DocumentPackageIdeologyView.tsx` пишет `role_catalog_id` в `document_package_session_participants`.

### 4. Валидатор (Phase 1, не менялся)
`canonical-template-apply-markup` + `StrictDocumentTemplatesManager.strictValidate` уже принимают `{{package.role.PKR-XXXXXX}}` как valid и выдают warning `deprecated_package_roles_syntax` на старый `{{package.roles.<role_key>.<attr>}}`.

## ОТЛОЖЕНО НА PHASE 2b (следующая итерация)
- UI `TemplateBindingControl` (radio billing/package + select пакета + кнопки bind/unbind через новые RPC) — компонент не создан, кнопки в `StrictDocumentTemplatesManager` пока используют только direct INSERT через существующие RLS (admin/owner).
- `PackageTemplateValidationPanel` — controlled validation поверх uploaded DOCX (mammoth + regex mirror + scope-проверки). Не создан.
- Группировка «Пакет: Роли» по пакетам в `PlaceholdersCatalogTab` (сейчас Phase 1 показывает плоский список ролей выбранного пакета).
- Sub-tab `pkg-admin` в `AiPageContent` для встраивания `PackageRolesManager` — не подключён.

## ЗАПРЕТЫ — проверка
```
$ rg -n "canonical-document-generate-strict|ai_generated_documents|gotenberg" \
    src/components/ai-documents/packages/ \
    src/hooks/usePackageRoleCatalog.ts \
    supabase/migrations/<phase2>*.sql
(пусто)
```
- `canonical-document-generate-strict` — НЕ модифицирован.
- Gotenberg — не вызывался.
- `ai_generated_documents` — ни одного write.
- Billing-резолвер, billing FLD, группы «Заказчик/Исполнитель» — не тронуты.
- `HARDCODED_ENABLED` в `resolve-package-tokens.ts` остаётся `false`.

## DoD (статус)
- [x] Миграция: триггеры защиты system-ролей, аудит, admin-only RPC.
- [x] UI per-package roles CRUD (create / edit safe fields / soft archive); system-роли защищены в UI и в БД.
- [x] Анкета читает роли из БД без хардкода (наследовано).
- [x] Каталог показывает PKR-токены активных ролей нужного пакета (Phase 1).
- [ ] Bind/unbind шаблона через admin-only RPC с audit — **RPC готов, UI не подключён**.
- [ ] Controlled validation panel: valid/warning/error без генерации — **не создан**.
- [x] `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing-резолвер — нетронуты.

## Следующий шаг
Phase 2b: `TemplateBindingControl` + `PackageTemplateValidationPanel` + admin sub-tab `pkg-admin` для встраивания `PackageRolesManager`. После этого — полный proof со скриншотами CRUD и validation report.
