# Sprint 3H-fix — `{{ln-XXXXXX}}` canon + `role_assignment_missing`
Дата: 2026-05-29  
Статус: completed (orchestrator deferred)

## Канон

- Рабочий Word-токен роли: **`{{ln-XXXXXX}}`**.
- `PKR-XXXXXX` сохраняется только как внутренний/исторический идентификатор;
  публичная нумерация в БД мигрирована на `ln-XXXXXX` (Sprint 3H, миграция
  `20260529150913_*`).
- Старые форматы запрещены и дают **error**:
  - `{{package.role.PKR-XXXXXX}}` → `invalid_legacy_role_placeholder`
  - `{{package.roles.<role_key>.<attr>}}` → `invalid_legacy_role_placeholder`

## 1. Build error — исправлен

`src/components/ai-documents/StrictDocumentTemplatesManager.tsx`:
расширен union `ValidationError.code`:

```
"legacy_placeholder_format_detected"
"unknown_modifier"
"unknown_field_public_id"
"no_placeholders_in_template"
"docx_unreadable"
// Sprint 3H-fix
"invalid_legacy_role_placeholder"
"ln_token_not_found"
"ln_token_outside_bound_package"
"role_assignment_missing"
```

`ValidationError` локален для этого файла (не вынесен в общий helper);
дублирующий тип в `PackageTemplateValidationPanel.tsx` хранит `code: string`
(open enum), поэтому второй точки правки нет.

## 2. Validator (PackageTemplateValidationPanel)

Канонизированы branch'и:

| Токен | severity | code |
|---|---|---|
| `{{package.ul\|ip\|fl.FLD-XXXXXX}}` | valid | `package_requisite_ok` |
| `{{ln-XXXXXX}}` (роль есть, пакет совпадает, есть assignment) | valid | `package_role_ok` |
| `{{ln-XXXXXX}}` (роль есть, пакет совпадает, **assignment нет**) | warning | `role_assignment_missing` |
| `{{ln-XXXXXX}}` (роли нет в каталоге) | error | `ln_token_not_found` |
| `{{ln-XXXXXX}}` (роль из другого пакета) | error | `ln_token_outside_bound_package` |
| `{{package.role.PKR-XXXXXX}}` | error | `invalid_legacy_role_placeholder` |
| `{{package.roles.<role_key>.*}}` | error | `invalid_legacy_role_placeholder` |
| `{{field:FLD-XXXXXX}}` (system/document) | valid | `system_field_ok` |
| `{{field:FLD-XXXXXX}}` (биллинговая entity) | warning | `billing_fld_in_package_scope` |
| legacy `{{document\|executor\|customer\|deal\|cf.*}}` | error | `legacy_placeholder_format_detected` |

### Проверка assignment-cases

Panel загружает:
- `document_package_template_items` (item_id + template_id) для выбранного пакета;
- `document_package_role_catalog` (все active, для распознавания «из другого пакета»);
- `document_package_sessions` пакета (опциональный селектор);
- `document_package_item_role_assignments` (active) по (session, item).

Если сессия не выбрана — `role_assignment_missing` НЕ выставляется
(валидатор не знает контекста анкеты документа). Если выбраны и сессия,
и item — assignment-check включается.

### Texts (RU)

- `invalid_legacy_role_placeholder`:
  «Устаревший формат плейсхолдера роли. Используйте плейсхолдер вида
  `{{ln-XXXXXX}}` из группы «Пакет: Роли».»
- `role_assignment_missing`:
  «Для этой роли в анкете документа ещё не выбран человек. Заполните
  анкету документа перед генерацией.»

## 3. System/document FLD остаются valid без warning

`BILLING_FLD_ENTITY_TYPES` (см. `src/utils/billingFldGroups.ts`):
`customer*`, `executor*`. `fields_registry.entity_type ∈ {document,
system, …}` → НЕ биллинг → `system_field_ok`. Покрывает:

- `FLD-000069` — номер документа (entity_type=document);
- `FLD-000209` — сегодня прописью (entity_type=system);
- `FLD-000211` — текущий год (entity_type=system).

## 4. Тесты

`src/utils/packagePlaceholderCatalog.test.ts` — обновлён под канон:

- copy-token роли всегда `{{ln-XXXXXX}}`, ровно одно вхождение `{{`;
- никаких `package.role.PKR-` и `package.roles.` в каталоге;
- `is_active=false` фильтруется;
- статический guard на JSON-stringify каталога.

```
$ bunx vitest run src/utils/packagePlaceholderCatalog.test.ts
Test Files  1 passed (1)
     Tests  13 passed (13)
```

## 5. Edge resolver (`supabase/functions/_shared/resolve-package-tokens.ts`)

Добавлен `resolveLnRoleToken` (вызывается из `resolvePackageTokenCore` при
совпадении `^ln-\d{6}$` на raw-токене):

```
1. ln-XXXXXX → document_package_role_catalog by public_id
   ├─ нет строки → ln_token_not_found
2. packageTemplateItemId → document_package_template_items.package_template_id
   ├─ нет item → config_error
   ├─ item.package_template_id ≠ role.package_template_id
       → ln_token_outside_bound_package
3. document_package_item_role_assignments
   (package_session_id, package_template_item_id, role_catalog_id, is_active=true)
   ├─ 0 строк → role_assignment_missing
   ├─ >1 строк → multiple_role_assignments (Sprint 3H: берём первого по
                  sort_order/created_at, но возвращаем warning код)
4. person_id → legal_details_persons.full_name + metadata.position
5. output_template (default "{{position}}, {{full_name}}")
   ├─ пустой позиции → ведущая запятая снимается
```

`PackageTokenResolveCode` расширен:

```
| 'ln_token_not_found'
| 'ln_token_outside_bound_package'
| 'role_assignment_missing'
```

`HARDCODED_ENABLED=false` сохранён. Production generation НЕ включена.

## 6. Что НЕ делалось (зафиксировано, контракт орчестратора)

- `canonical-document-generate-strict` — НЕ изменён.
- Gotenberg — НЕ вызывается.
- `ai_generated_documents` — НЕ пишется.
- `ai-generate-document-package` — НЕ запускался, НЕ дёргался из UI.
- Кнопка «Сформировать пакет» в UI — остаётся disabled (Sprint 3G §7.6).
- Никаких новых FLD.
- Никаких новых поддерживаемых legacy role-token (не «deprecated warning»,
  а полностью error).
- `PKR-XXXXXX` НЕ возвращается в UI каталога плейсхолдеров.

## 7. Grep evidence

```
$ rg -n "package\.role\.PKR-" src/ supabase/functions/_shared
src/utils/packagePlaceholderCatalog.ts:395:  * Старые форматы ... [комментарий]
src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx:
    RX_LEGACY_PACKAGE_ROLE_PKR — error
src/components/ai-documents/StrictDocumentTemplatesManager.tsx:
    RX_LEGACY_PACKAGE_ROLE_PKR — error invalid_legacy_role_placeholder
```

В production-UI (`PackageRolesManager`, `PackageAdminPanel`,
`PlaceholdersCatalogTab`, `packagePlaceholderCatalog.ts`) рабочий copy-токен
только `{{ln-XXXXXX}}`.

## 8. Финальный статус

```
completed: ln-token canon fully applied;
legacy role placeholders rejected;
role_assignment_missing implemented in validator and resolver;
build fixed;
tests updated;
generation orchestrator deferred to next phase
```

## 9. Next phase

`Sprint 3H-orchestrator` — подключение пакетной генерации через
существующий pipeline (`canonical-document-generate-strict`,
`document_templates`, Gotenberg, `ai_generated_documents`). Без нового
renderer/Gotenberg. Кнопка «Сформировать пакет» снимается с disabled только
после полного wiring orchestrator-а.
