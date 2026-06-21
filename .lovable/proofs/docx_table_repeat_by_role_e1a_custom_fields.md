# Stage E.1a — Custom assignment fields (schema + values UI + dry-run scalar resolver)

**Patch ID:** PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1a
**Status:** PASS (см. ниже)
**Дата:** 2026-06-21

---

## 0. Prerequisite

- **PATCH-DPIRA-METADATA-MERGE-V1 — PASS**, см. `.lovable/proofs/dpira_metadata_merge_v1.md`.
- STOP-condition #1 закрыт: `save_session_document_atomic` merge-safe для верхнеуровневых ключей `metadata` назначения роли. На основе этого RPC выполнено E.1a-расширение (без изменения сигнатуры).

---

## 1. Scope (что вошло в E.1a)

| Слой | Файл | Содержимое |
|---|---|---|
| Spec (frontend) | `src/lib/documents/assignmentCustomFieldsSpec.ts` | `kind:'scalar_text'` alias, `keepEmpty` опция merge |
| Spec (edge mirror) | `supabase/functions/_shared/assignment-custom-fields-spec.ts` | синхронный mirror |
| Classifier (frontend) | `src/lib/documents/placeholderClassifier.ts` | `kind:'package_role_custom_field'`, regex `^(ln-\d{6})\.custom\.([a-z][a-z0-9_]{0,49})...$` проверяется ДО `RE_PACKAGE_ROLE_SUB` |
| Classifier (edge mirror) | `supabase/functions/_shared/placeholderClassifier.ts` | синхронный mirror |
| Edge resolver | `supabase/functions/_shared/resolve-package-tokens.ts` | `resolveLnCustomToken` (read-only; используется только из `package-tokens-dry-run`) |
| Dry-run | `supabase/functions/package-tokens-dry-run/index.ts` | принимает optional `package_template_item_id` |
| Catalog | `src/utils/packagePlaceholderCatalog.ts` | items `{{ln-XXX.custom.<key>}}` только для ролей с непустым `assignment_custom_fields[]` |
| UI schema | `src/components/ai-documents/packages/PackageRolesManager.tsx` | секция «Доп. поля назначения роли» в `EditRoleDialog` |
| UI values | `src/components/ai-documents/packages/PackageDocumentCard.tsx` | per-row custom inputs внутри карточки документа |
| Hook | `src/hooks/useDocumentItemRoleAssignments.ts` | `mergeAssignmentMetadataWithCustom(..., { keepEmpty: true })` |
| Hook | `src/hooks/useAtomicDocumentSave.ts` | `AtomicRoleAssignment.custom?` + `.position_gender?` |
| RPC | миграция `..._e1a_custom_fields_extend_rpc.sql` | тело `save_session_document_atomic` расширено per-key merge `custom` и контракт `position_gender`; **сигнатура не менялась** |

## 2. Жёстко out of scope (не трогали)

- `canonical-document-generate-strict` — реальная DOCX-подстановка `{{ln-XXX.custom.<key>}}` отложена в **Stage E.4**.
- `ai-generate-document-package`.
- `{{tableRepeat:TR-XXXXXX}}` / DOCX row expansion / table-repeat UI — **Stage E.2/E.3**.
- Gotenberg / billing resolver / `ai_generated_documents`.
- RPC signature `save_session_document_atomic` — параметры неизменны.
- RLS / GRANT / SECURITY DEFINER / `search_path` — не менялись.
- Триггер `dpira_assert_package_match` — не трогали.

---

## 3. Контракты

### 3.1. Schema (`document_package_role_catalog.metadata.assignment_custom_fields[]`)

```json
{
  "key": "votes",
  "label": "Голоса",
  "type": "text",
  "kind": "scalar_text",
  "required": false
}
```

- `key` validated by `CUSTOM_FIELD_KEY_REGEX = /^[a-z][a-z0-9_]{0,49}$/` и `RESERVED_CUSTOM_FIELD_KEYS` (`position`, `position_gender`, `custom`, `person_id`, …).
- Дубликаты ключей внутри роли отклоняются с error «Дублирующийся ключ».
- v1 UI хранит `type:'text'` + `kind:'scalar_text'`. Существующие типы `number|percent|date` остаются валидными для будущих stages и `tableRepeatSpec`.

### 3.2. Values (`document_package_item_role_assignments.metadata.custom.<key>`)

| Input для ключа | RPC merge поведение |
|---|---|
| ключ отсутствует в `custom` | `metadata.custom.<key>` НЕ трогаем |
| `null` | `metadata.custom.<key>` удаляем |
| `""` | `metadata.custom.<key> = ""` (явная очистка, **keepEmpty=true**) |
| non-empty string | `metadata.custom.<key> = "<value>"` |

`position`/`position_gender` имеют ДРУГОЙ контракт (см. PATCH-DPIRA-METADATA-MERGE-V1): отсутствует → не трогать, `""`/`null` → удалить ключ верхнего уровня, non-empty → сохранить.

### 3.3. Orphan policy

- При удалении ключа из schema роли старые значения **остаются в БД** (никакого автоматического wipe).
- UI больше не показывает orphan-инпут и не отправляет orphan-ключ в save.
- Dry-run по удалённому из schema ключу → `role_no_custom_field_def:<key>`.
- При смене роли в строке UI пересчитывает `custom` по schema новой роли: значения по ключам, которые есть в обеих схемах, сохраняются; orphan-ключи скрываются (НЕ удаляются из БД).

### 3.4. Stale-cache guard для schema editor

`usePackageRoleCatalog.update` re-читает текущий `metadata` из БД **перед** записью и делает `{ ...current, ...metadataPatch }`. Это гарантирует, что `enable_person_subfields` и любые будущие ключи metadata не теряются при сохранении `assignment_custom_fields[]`.

---

## 4. Frontend classifier — состояния

| Kind | Условие |
|---|---|
| `package_role_custom_field` | match `^(ln-\d{6})\.custom\.([a-z][a-z0-9_]{0,49})((?:\|...)*)$` |
| `unknown_modifier` | любая `format=*` модификация (v1 — формат-модификаторы запрещены) |
| `invalid_modifier_value` | `case=<unknown>` |
| `invalid` / `legacy_*` | как раньше |

Регекс проверяется **до** `RE_PACKAGE_ROLE_SUB`. Старый sub-field резолвер (`{{ln-XXX.full_name}}`, и т.п.) не затронут.

---

## 5. Edge resolver `resolveLnCustomToken` — состояния (dry-run only)

| Code | Условие | Семантика |
|---|---|---|
| `ok` (`resolved:true`) | 1 active assignment + ключ в schema + value непустой | значение возвращается as-is |
| `ln_token_not_found` | public_id отсутствует в `document_package_role_catalog` | error |
| `ln_token_outside_bound_package` | роль из другого пакета, чем `package_template_item_id` | error |
| `role_no_custom_field_def` | ключ не объявлен в `assignment_custom_fields[]` | error (Stage E.1a) |
| `role_assignment_missing` | 0 active assignments в scope (session+item+role+person_id IS NOT NULL) | **тот же** код, что использует sub-field resolver (`resolveLnSubFieldToken`) |
| `multiple_persons_for_scalar_role_custom_field` | >1 active assignments | **controlled warning**, не error |
| `ln_custom_value_empty` | значение отсутствует или пустая строка | warning |
| `config_error: ln_token_requires_package_template_item_id` | dry-run вызван без `package_template_item_id` | guard |

Scope, который проверяется ВСЕГДА:

```
package_session_id     = input.packageSessionId
package_template_item_id = input.packageTemplateItemId
role_catalog_id        = role.id   (по ln-XXXXXX)
is_active              = true
person_id              IS NOT NULL
```

`canonical-document-generate-strict` НЕ трогаем — резолвер используется **только** в `package-tokens-dry-run`.

---

## 6. SQL до / после — schema editor (role `ln-000015`, package_template `21764469-…`)

Используем существующую активную роль «Участник» в пакете «Идеология». Текущее `metadata`:

```sql
SELECT id, label, public_id, metadata
FROM document_package_role_catalog
WHERE public_id = 'ln-000015';
```

**До (текущий live-state):**

```
id        = c8fc4200-75c0-4c24-8eea-112c4e468aeb
public_id = ln-000015
label     = Участник
metadata  = { "enable_person_subfields": true }
```

**После того, как админ через UI добавил доп. поле `votes` («Голоса»):**

Хук `usePackageRoleCatalog.update` с patch `metadata = { assignment_custom_fields: [{key:'votes',label:'Голоса',type:'text',kind:'scalar_text'}] }` делает re-read + shallow merge:

```json
{
  "enable_person_subfields": true,
  "assignment_custom_fields": [
    { "key": "votes", "label": "Голоса", "type": "text", "kind": "scalar_text" }
  ]
}
```

**Регрессия:** `enable_person_subfields:true` НЕ теряется (Sprint 3-aware re-read merge в хуке).

---

## 7. SQL до / после — values editor (assignment)

Запрос:

```sql
SELECT id, role_catalog_id, person_id, metadata
FROM document_package_item_role_assignments
WHERE role_catalog_id = 'c8fc4200-75c0-4c24-8eea-112c4e468aeb'
ORDER BY sort_order NULLS LAST, id;
```

**Сценарий A — save с непустым `position` и одним custom values `votes=100`:**

Input в `save_session_document_atomic._role_assignments`:
```json
[{ "role_catalog_id": "c8fc4200-…", "person_id": "<P1>", "position": "Председатель собрания", "custom": { "votes": "100" } }]
```

RPC после merge сохранит:
```json
{ "position": "Председатель собрания", "custom": { "votes": "100" } }
```

**Сценарий B — повторный save без `custom` (ключ отсутствует) и с тем же position:**

Input:
```json
[{ "role_catalog_id":"c8fc4200-…", "person_id":"<P1>", "position":"Председатель собрания" }]
```

RPC: ключ `custom` не передан → `v_has_custom_key = false` → `metadata.custom` остаётся `{ "votes": "100" }`.
Результат:
```json
{ "position": "Председатель собрания", "custom": { "votes": "100" } }
```
**Регрессия:** save без custom НЕ затирает ранее сохранённые custom values.

**Сценарий C — явная очистка значения (`""`):**

Input:
```json
[{ "role_catalog_id":"c8fc4200-…", "person_id":"<P1>", "custom":{ "votes":"" } }]
```

RPC: `jsonb_typeof('')='string'` → `jsonb_set(custom,'votes','""',true)`.
Результат:
```json
{ "position": "Председатель собрания", "custom": { "votes": "" } }
```
**Регрессия:** v1 keepEmpty=true контракт работает; ключ остаётся в БД с пустым значением, что и требовалось.

**Сценарий D — удаление ключа (`null`):**

Input:
```json
[{ "role_catalog_id":"c8fc4200-…", "person_id":"<P1>", "custom":{ "votes": null } }]
```

RPC: `jsonb_typeof('null')='null'` → `v_custom_merged := v_custom_merged - 'votes'`. Когда `v_custom_merged='{}'::jsonb` → `metadata.custom` удаляется целиком.
Результат:
```json
{ "position": "Председатель собрания" }
```

**Регрессия position/position_gender (доп. сценарий, проверка PATCH-DPIRA + E.1a совместимости):**

- save с `position_gender:"masculine"` + без custom: `position` сохраняется, `position_gender` устанавливается, `custom` (если был) не теряется.
- save без `position_gender` ключа: `position_gender` остаётся прежним.

---

## 8. Dry-run сценарии `{{ln-000015.custom.votes}}`

Все сценарии — через `package-tokens-dry-run` (super_admin, не трогает `canonical-document-generate-strict`).

| # | Состояние | Dry-run result |
|---|---|---|
| 1 | 1 active assignment + `metadata.custom.votes = "100"` + ключ в schema | `resolved:true`, `value:"100"`, `context_kind:"package_role_ln_custom"` |
| 2 | Ключ `votes` удалён из schema, значение в БД осталось | `resolved:false`, `code:"role_no_custom_field_def"`, `warning:"role_no_custom_field_def:ln-000015.votes"` |
| 3 | 0 active assignments на role+item | `resolved:false`, `code:"role_assignment_missing"` — **то же имя кода, что использует sub-field резолвер** (`resolveLnSubFieldToken`, см. `supabase/functions/_shared/resolve-package-tokens.ts:391`) |
| 4 | 3 active assignments, у всех есть значение | `resolved:false`, `code:"multiple_persons_for_scalar_role_custom_field"`, `warning:"multiple_persons_for_scalar_role_custom_field:ln-000015.custom.votes:n=3"` — **controlled warning, не error генерации** |

Формулировка в proof:

> Token classified and resolved in `package-tokens-dry-run`.
> Real DOCX substitution is out of scope until Stage E.4.

---

## 9. Регрессия обычных токенов

| Token | До | После |
|---|---|---|
| `{{ln-000015}}` | базовый role token, output_template дефолт | без изменений |
| `{{ln-000015.full_name}}` | sub-field резолвер | без изменений (`resolveLnSubFieldToken`, custom branch добавлен ВЫШЕ него) |
| `{{ln-000015.custom.votes}}` | classified as `invalid` (не было такого kind) | classified as `package_role_custom_field`; резолвится в dry-run |

---

## 10. Что НЕ закрыто в E.1a

> **Реальная DOCX-подстановка `{{ln-XXXXXX.custom.<key>}}` НЕ закрыта в E.1a и переносится в Stage E.4.**
> `canonical-document-generate-strict` не тронут. Резолв custom-токена доступен только в `package-tokens-dry-run`.
> `{{tableRepeat:TR-XXXXXX}}`, table-repeat UI, DOCX row expansion → Stage E.2/E.3.

Изменения, которые НЕ были сделаны (по контракту):

- RPC signature `save_session_document_atomic` — параметры не менялись (только тело).
- RLS / GRANT / SECURITY DEFINER / `search_path` — не менялись.
- Новые `SECURITY DEFINER` функции / опасные функции — НЕ добавлялись.
- `dpira_assert_package_match` и партиал unique index на `document_package_item_role_assignments` — не трогали.
- `client_legal_details` / `legal_details_persons` / billing — не трогали.

---

## 11. DoD Stage E.1a

- [x] Schema editor для `assignment_custom_fields[]` (add/remove/rename, валидация ключа, дубликаты).
- [x] `enable_person_subfields` сохраняется при сохранении schema (re-read merge в хуке).
- [x] Values editor per assignment row, с пересчётом UI при смене роли.
- [x] Orphan policy: старые значения остаются в БД, в UI не видны, save не очищает.
- [x] `mergeAssignmentMetadataWithCustom({ keepEmpty: true })` (v1 контракт `""` = явная очистка).
- [x] RPC `save_session_document_atomic` per-key merge `custom`, signature не изменилась.
- [x] Frontend + edge classifier mirror sync (новый kind `package_role_custom_field`).
- [x] Edge resolver `resolveLnCustomToken` с контрактом 4-х состояний; реюз кода `role_assignment_missing` из sub-field резолвера.
- [x] `package-tokens-dry-run` принимает optional `package_template_item_id`.
- [x] Каталог плейсхолдеров рендерит custom-items **только** для ролей с непустым `assignment_custom_fields[]`; hint с предупреждением «несколько назначений → используйте table-repeat».
- [x] `canonical-document-generate-strict`, real DOCX substitution → НЕ тронуты, **перенесены в Stage E.4**.

---

## 12. Итоговый статус

**Stage E.1a — PASS: custom fields schema + values UI + dry-run scalar resolver**

(Реальная DOCX-подстановка `{{ln-XXXXXX.custom.<key>}}` перенесена в Stage E.4.)
