---
name: Package Document-Level Questionnaires (Sprint 3G)
description: Sprint 3G — анкеты ролей в пакете назначаются на каждый документ отдельно через `document_package_item_role_assignments`; session_participants — read-only legacy; resolver получает per-item ветку (HARDCODED_ENABLED=false); валидатор различает billing vs system FLD
type: feature
---

# Package Document-Level Questionnaires (Sprint 3G)

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
