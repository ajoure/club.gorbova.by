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
