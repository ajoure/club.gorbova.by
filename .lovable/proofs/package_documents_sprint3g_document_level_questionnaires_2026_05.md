# Sprint 3G — Document-level questionnaires + validator + resolver scope

Дата: 2026-05-29
Скоуп: пакеты документов → переход от «одной анкеты на пакет» к «анкета на каждый
документ пакета»; валидатор различает биллинговые vs системные FLD;
резолвер пакетных токенов получает document-level ветку (HARDCODED_ENABLED=false).

## 0. Архитектурное изменение

Было: одна `document_package_sessions` + один набор `document_package_session_participants`
на весь пакет → все шаблоны пакета вынужденно разделяли одни и те же роли/физлица.

Стало:
- `document_package_sessions` — общая «организация» пакета (ЮЛ-плательщик и метаданные).
- `document_package_item_role_assignments` — отдельный набор назначений на каждую
  пару `(package_session_id, package_template_item_id)`. Один человек может быть в
  разных ролях в разных документах одного пакета; одна роль в одном документе может
  быть назначена нескольким физлицам.
- `document_package_session_participants` остаётся read-only legacy: новые UI-флоу
  туда не пишут (см. backlog «document_package_session_save_atomicity»).

## 1. Миграция

`20260529133454_e6c7821e-b608-4a1c-87a2-f25becc13de9.sql`:

```text
TABLE document_package_item_role_assignments (
  id, package_session_id, package_template_item_id, role_catalog_id,
  person_id, metadata jsonb, sort_order, is_active, created_by, updated_by,
  created_at, updated_at
)
```

- GRANT authenticated + service_role; RLS owner/admin-only.
- Триггер `dpira_assert_package_match` — проверяет, что `role_catalog_id`,
  `package_template_item_id` и `package_session_id` принадлежат одному
  `package_template_id`. Любое несовпадение → exception.
- Partial unique index `(package_session_id, package_template_item_id,
  role_catalog_id, person_id) WHERE is_active = true` — нет дублей активных
  назначений того же физлица на ту же роль в том же документе.
- `updated_at` авто-trigger.
- Audit-логирование делается в edge/UI слое (см. hook).

## 2. UI

- `DocumentPackageQuestionnairesView.tsx` — основной экран новой подвкладки
  «Анкеты документов». Глобальный селектор ЮЛ пакета сверху, ниже — accordion
  по `document_package_template_items` (по одному документу пакета). В каждом
  блоке: список ролей пакета + multi-add физлиц.
- `useDocumentItemRoleAssignments(sessionId, itemId)` — replace-save:
  soft-archive активных + insert новых. Атомарный RPC `replace_item_role_assignments`
  отложен в backlog `document_package_session_save_atomicity`.
- `PackagesWorkspace.tsx` — вкладка «Анкета пакета» заменена на «Анкеты документов»
  (новый компонент).
- `useDocumentPackageSession` остался без изменений в этой фазе: продолжает
  держать сессию + ЮЛ. Очистка legacy participant-CRUD — следующая фаза 3H.

## 3. Validator (`PackageTemplateValidationPanel.tsx`)

- Подгружает `fields_registry.entity_type` для всех FLD, упомянутых в шаблонах
  пакета.
- `{{field:FLD-XXXXXX}}` с `entity_type ∈ billing` (см. `src/utils/billingFldGroups.ts`)
  в package-template → warning `billing_fld_in_package_scope` с RU-сообщением.
- `{{field:FLD-XXXXXX}}` с `entity_type` системных/документных групп → valid,
  без warning.
- `{{package.ul|ip|fl.FLD-...}}` и `{{package.role.PKR-...}}` — оставлены как в
  Sprint 3F.
- `{{package.roles.<role_key>.*}}` — deprecated warning (поведение не менялось).

## 4. Resolver (`supabase/functions/_shared/resolve-package-tokens.ts`)

- `PackageTokenResolveInput.packageTemplateItemId?: string | null` — новое поле.
- Когда задан → резолвер находит `document_package_role_catalog.id` по
  (`package_template_id` шаблона-документа, `role_key`) и читает только
  `document_package_item_role_assignments` (active). Иначе — старая ветка
  `document_package_session_participants`.
- Контракт `multiple_role_assignments` (warning при >1 назначениях) сохранён
  и для document-level; multi-add из UI на данном этапе валиден, но при
  попытке резолва приведёт к warning — для real generation в Sprint 3H будет
  введён `output_template` с массивом значений.
- HARDCODED_ENABLED остаётся `false` — production не зовёт резолвер, изменение
  безопасно как дополнение pure-логики.

## 5. Не трогается

- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`,
  billing resolver, `document_package_token_aliases` — без изменений.
- Сидовые/системные роли пакета — поведение из Sprint 3F Phase 2e (hard delete)
  не меняется.
- HARDCODED_ENABLED в резолвере остаётся `false`.

## 6. Файлы

- migration: `supabase/migrations/20260529133454_e6c7821e-b608-4a1c-87a2-f25becc13de9.sql`
- hook: `src/hooks/useDocumentItemRoleAssignments.ts`
- ui: `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx`,
  `PackagesWorkspace.tsx` (rewire), `PackageTemplateValidationPanel.tsx` (billing scope)
- util: `src/utils/billingFldGroups.ts`
- resolver: `supabase/functions/_shared/resolve-package-tokens.ts` (document-level branch)
