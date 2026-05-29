---
name: Package Document-Level Questionnaires (Sprint 3G + 3H-fix)
description: Sprint 3G — document_package_item_role_assignments SOT; Sprint 3H-fix — канон роли {{ln-XXXXXX}}, legacy package.role.PKR/package.roles.* → error invalid_legacy_role_placeholder, ln_token_not_found / ln_token_outside_bound_package / role_assignment_missing в UI-валидаторе и edge-резолвере (HARDCODED_ENABLED=false)
type: feature
---

# Package Document-Level Questionnaires (Sprint 3G + 3H-fix)

## Sprint 3H-fix — канон роли

- Рабочий Word-токен роли: **`{{ln-XXXXXX}}`** (Word-friendly, без префиксов).
- `PKR-XXXXXX` — только внутренний/исторический; в UI/каталоге/валидаторе/резолвере не используется.
- Legacy форматы **запрещены** и дают `error invalid_legacy_role_placeholder`:
  - `{{package.role.PKR-XXXXXX}}`
  - `{{package.roles.<role_key>.<attr>}}`
- Никаких «deprecated warning» для legacy role-token.

## Validator codes (`PackageTemplateValidationPanel`)

| code | severity | условие |
|---|---|---|
| `package_role_ok` | valid | роль есть, пакет совпадает, assignment есть (или не проверяется) |
| `ln_token_not_found` | error | `ln-XXXXXX` отсутствует в `document_package_role_catalog` |
| `ln_token_outside_bound_package` | error | роль найдена, но `package_template_id` ≠ текущему пакету |
| `role_assignment_missing` | warning | выбраны session + item, но в `document_package_item_role_assignments` нет active записи для `role_catalog_id` |
| `invalid_legacy_role_placeholder` | error | `{{package.role.PKR-…}}` или `{{package.roles.<key>.<attr>}}` |
| `billing_fld_in_package_scope` | warning | `{{field:FLD-…}}` с `entity_type ∈ customer*\|executor*` в package-шаблоне |
| `system_field_ok` | valid | `{{field:FLD-…}}` остальные `entity_type` (включая document/system: FLD-000069, FLD-000209, FLD-000211) |

## Edge resolver (`supabase/functions/_shared/resolve-package-tokens.ts`)

- Раздельная ветка `resolveLnRoleToken` для raw `^ln-\d{6}$`.
- Требует `packageTemplateItemId` (иначе `config_error`).
- Логика: catalog lookup → package binding check → active assignments
  (`document_package_item_role_assignments`) → person + metadata.position
  → render через `role.output_template` (default `"{{position}}, {{full_name}}"`,
  с автоудалением ведущей запятой при пустой position).
- Коды: `ln_token_not_found`, `ln_token_outside_bound_package`,
  `role_assignment_missing`, `multiple_role_assignments`, `no_person`,
  `person_missing`, `empty_value`.
- `HARDCODED_ENABLED=false` — production-вызов всё ещё disabled,
  generation orchestrator не подключён.

## Sprint 3G base (без изменений)

`document_package_item_role_assignments` — SOT назначений на (session,item,role).
Партициальный unique index `ux_dpira_active_person` на
`(session, item, role, person) WHERE is_active=true`. Триггер
`dpira_assert_package_match` запрещает кросс-пакетные назначения.
`document_package_session_participants` — read-only legacy.

## Запрещено

- Возвращать `PKR-XXXXXX` или `{{package.role.PKR-…}}` в UI / каталоге плейсхолдеров.
- Принимать legacy role-токены как valid или deprecated warning.
- Прямые INSERT в `document_package_session_participants`.
- Резолв `{{ln-XXXXXX}}` без `packageTemplateItemId`.
- Включать `HARDCODED_ENABLED` без orchestrator-фазы.
- Менять `canonical-document-generate-strict`, вызывать Gotenberg или
  писать в `ai_generated_documents` в рамках Sprint 3H-fix.

## Файлы

- Migration (Sprint 3G): `supabase/migrations/20260529133454_*.sql`
- Migration (Sprint 3H — PKR→ln rename): `supabase/migrations/20260529150913_*.sql`
- Validator: `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx`
- Strict validator: `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`
- Catalog: `src/utils/packagePlaceholderCatalog.ts` (+ `.test.ts`)
- Hook: `src/hooks/useDocumentItemRoleAssignments.ts`
- Resolver: `supabase/functions/_shared/resolve-package-tokens.ts`
- Util: `src/utils/billingFldGroups.ts`
- Proofs:
  - `.lovable/proofs/package_documents_sprint3g_document_level_questionnaires_2026_05.md`
  - `.lovable/proofs/package_documents_sprint3h_role_assignment_missing_and_orchestrator_2026_05.md`


## SOT назначений ролей в пакете

`document_package_item_role_assignments` — единственный SOT для новых
назначений ролей внутри пакета. Скоуп: пара (`package_session_id`,
`package_template_item_id`) + `role_catalog_id` + `person_id` + `metadata`.

- Один человек может быть назначен на **разные** роли в разных документах
  одного пакета.
- Одна роль в одном документе может быть назначена **нескольким** физлицам
  (multi-add); generation-семантика multi-value откладывается в Sprint 3H.
- Soft-delete через `is_active=false`; partial unique index гарантирует
  отсутствие дублей активных.
- Триггер `dpira_assert_package_match` запрещает кросс-пакетные назначения:
  `role_catalog_id`, `package_template_item_id` и `package_session_id`
  должны принадлежать одному `package_template_id`.

`document_package_session_participants` — **read-only legacy**. Новые
UI/edge-флоу туда не пишут. Бэкфилл legacy → новый SOT — отдельная задача
backlog `document_package_session_save_atomicity`.

## UI-контракт

- Вкладка «Анкеты документов» (`DocumentPackageQuestionnairesView.tsx`):
  глобальный селектор ЮЛ пакета сверху + accordion по template-items,
  внутри каждого — назначение ролей и физлиц именно для этого документа.
- Hook `useDocumentItemRoleAssignments(sessionId, itemId)` — replace-save
  через soft-archive + insert.

## Validator scope

`{{field:FLD-...}}` в package-шаблоне:
- `fields_registry.entity_type ∈ {customer, customer_*, executor, executor_leg}` →
  warning `billing_fld_in_package_scope` (см. `src/utils/billingFldGroups.ts`).
- остальные entity_type (system, document, package, person и т. д.) → valid.

`{{package.ul|ip|fl.FLD-...}}`, `{{package.role.PKR-...}}`,
`{{package.roles.<role_key>.*}}` (deprecated warning) — поведение из Sprint 3F
без изменений.

## Resolver контракт

`resolve-package-tokens.ts` (`HARDCODED_ENABLED=false`):
- `PackageTokenResolveInput.packageTemplateItemId?: string | null`.
- Если задан → document-level branch: резолв через `document_package_role_catalog`
  → `document_package_item_role_assignments` (active only).
- Если не задан → legacy `document_package_session_participants`.
- Контракт `multiple_role_assignments` (>1 → warning) сохранён в обеих ветках.

## Запрещено

- Прямые INSERT в `document_package_session_participants` для новых сценариев.
- Резолв роли в пакете без указания контекста документа (когда генерация
  включится в Sprint 3H — `packageTemplateItemId` обязателен).
- Кросс-пакетные назначения (защищены триггером).
- Включать HARDCODED_ENABLED без отдельной миграционной фазы.

## Файлы

- Migration: `supabase/migrations/20260529133454_e6c7821e-b608-4a1c-87a2-f25becc13de9.sql`
- Hook: `src/hooks/useDocumentItemRoleAssignments.ts`
- UI: `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx`,
  `PackageTemplateValidationPanel.tsx`, `PackagesWorkspace.tsx`
- Util: `src/utils/billingFldGroups.ts`
- Resolver: `supabase/functions/_shared/resolve-package-tokens.ts`
- Proof: `.lovable/proofs/package_documents_sprint3g_document_level_questionnaires_2026_05.md`
