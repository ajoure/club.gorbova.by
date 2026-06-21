# да, согласен, с учетом правок:

1. План можно выполнять как Stage E.1a.
  &nbsp;
  Статус после выполнения должен быть строго:
  ```text
  Stage E.1a — PASS: custom fields schema + values UI + dry-run scalar resolver
  ```
  Без заявления, что `{{ln-XXXXXX.custom.<key>}}` уже работает в реальной DOCX-генерации.
2. Уточнить пути файлов перед началом работ.
  &nbsp;
  В плане указаны:
  ```text
  src/components/admin/documents/PackageRolesManager.tsx
  src/components/admin/documents/PackageDocumentCard.tsx
  src/utils/placeholderClassifier.ts
  ```
  Ранее фактические файлы были в зоне:
  ```text
  src/components/ai-documents/packages/...
  src/lib/documents/placeholderClassifier.ts
  ```
  Перед изменениями сделать короткий grep/discovery и править фактические используемые файлы, а не создавать дубли в соседней директории.
3. Сохранить frontend/edge parity по спецификациям.
  &nbsp;
  Если `assignmentCustomFieldsSpec.ts` уже имеет frontend + edge mirror, все изменения типа:
  ```text
  keepEmpty
  readAssignmentCustomFieldDefs
  readAssignmentCustomValues
  validateCustomFieldKey
  ```
  должны быть внесены синхронно в оба mirror-файла, чтобы frontend и edge одинаково трактовали keys/schema/values.
4. По schema custom fields в v1 принимаю упрощённый формат:
  &nbsp;
  ```json
  {
    "key": "votes",
    "label": "Голоса",
    "kind": "scalar_text",
    "required": false
  }
  ```
  Но если в уже созданном E.1 spec ранее были поля `type`, `placeholder`, `required`, не ломать существующий тип. Допустимо маппить:
  ```text
  kind: scalar_text
  ```
  как v1 alias, но не удалять уже созданные типы, если они используются в `tableRepeatSpec` или будущих stages.
5. В UI можно показывать только key/label для v1, но storage должен быть forward-compatible.
  &nbsp;
  Минимально допустимо:
  ```json
  {
    "key": "votes",
    "label": "Голоса",
    "kind": "scalar_text",
    "required": false
  }
  ```
  Не хардкодить `votes` как системное поле. Это обычное custom field роли.
6. В `PackageRolesManager` при сохранении role metadata обязательно сохранять оба блока:
  &nbsp;
  ```json
  {
    "enable_person_subfields": true,
    "assignment_custom_fields": [...]
  }
  ```
  Proof должен явно показать, что `enable_person_subfields=true` не потерялся.
7. В values editor не очищать orphan values автоматически.
  &nbsp;
  Правильный контракт:
  - schema field удалили → поле исчезло из UI;
  - старое значение может остаться в БД;
  - dry-run по удалённому key даёт:
  - автоматическую чистку orphan values не делать в E.1a.
8. Для `custom` сохранить контракт v1:
  &nbsp;
  ```text
  undefined = не менять
  "" = сохранить пустую строку
  non-empty = сохранить значение
  ```
  Это нужно, чтобы пользователь мог явно очистить значение поля, не удаляя сам key.
9. Для `position` контракт другой:
  &nbsp;
  ```text
  undefined = не менять
  "" / null = удалить metadata.position
  non-empty = сохранить metadata.position
  ```
  Не смешивать поведение `position` и `custom`.
10. В `resolveLnCustomToken` не плодить новый код “нет назначений”, если уже есть существующий код в resolver `ln-*`.

Сначала проверить фактический код, который выдаёт `resolveLnSubFieldToken` при 0 assignments, и использовать его же. В proof зафиксировать фактическое имя.

11. `resolveLnCustomToken` должен строго соблюдать item/session scope:

```text
package_template_id
package_session_id
package_template_item_id
role_catalog_id
is_active = true
person_id IS NOT NULL
```

Нельзя резолвить custom values роли из другого документа, другой сессии или другого пакета.

12. Каталог плейсхолдеров должен показывать custom tokens только если у роли есть schema:

```text
assignment_custom_fields.length > 0
```

Не выводить пустые группы для ролей без custom fields.

13. В hint каталога обязательно добавить предупреждение:

```text
Для обычного scalar-токена роль должна иметь ровно одно активное назначение. Если назначений несколько, используйте table-repeat.
```

14. Proof по dry-run не должен использовать реальную DOCX-генерацию.

Формулировка в proof:

```text
Token classified and resolved in package-tokens-dry-run.
Real DOCX substitution is out of scope until E.4.
```

15. В proof добавить regression по `enable_person_subfields`.

До:

```json
{ "enable_person_subfields": true }
```

После добавления custom fields:

```json
{
  "enable_person_subfields": true,
  "assignment_custom_fields": [...]
}
```

16. В proof добавить regression по обычным токенам:

```text
{{ln-000015}}
{{ln-000015.full_name}}
```

Они должны продолжать работать как раньше.

17. В proof отдельно указать, что не трогались:

```text
canonical-document-generate-strict
ai-generate-document-package
tableRepeat marker
DOCX row expansion
Gotenberg
billing resolver
RPC signature / RLS / GRANT / SECURITY DEFINER
```

18. После выполнения дать отдельный отчёт по E.1a и не переходить к E.2 без подтверждения.

После этих уточнений Stage E.1a можно выполнять.

&nbsp;

План: Stage E.1a — Custom assignment fields (schema + values + dry-run scalar resolver)

## Prerequisite (закрыт)

- **PATCH-DPIRA-METADATA-MERGE-V1 — PASS**
- Proof: `.lovable/proofs/dpira_metadata_merge_v1.md`
- `save_session_document_atomic` теперь merge-safe для `metadata`; `useDocumentItemRoleAssignments.ts` переведён на `mergeAssignmentMetadataWithCustom`. STOP-condition #1 закрыт.

## Scope E.1a (только этот слой)

1. **Schema custom fields у роли**
  `document_package_role_catalog.metadata.assignment_custom_fields[]` (массив `{ key, label, kind: 'scalar_text', required?: false }`).
  - UI: в `PackageRolesManager.tsx` — секция «Custom fields» внутри роли: добавить/удалить/переименовать (key/label).
  - Save: re-read `role.metadata` перед merge; **не затирать** `enable_person_subfields` и прочие верхнеуровневые ключи.
  - Валидация key: `^[a-z][a-z0-9_]{0,49}$`, уникальность внутри роли.
  - Stale-cache guard: при сохранении сравнить `updated_at` или перечитать строку перед PATCH.
2. **Values custom fields у конкретного assignment**
  `document_package_item_role_assignments.metadata.custom.<key>: string`.
  - UI: в `PackageDocumentCard.tsx` — для каждой строки assignment (после полей person/position) рендер инпутов по schema текущей роли.
  - Save: через уже отремонтированный `save_session_document_atomic` (RPC) с расширенным input-helper'ом на клиенте — `mergeAssignmentMetadataWithCustom({ keepEmpty: true })`:
    - `undefined` → ключ не меняется,
    - `""` → `metadata.custom[key] = ""` (явная очистка, v1-контракт),
    - non-empty → запись значения.
  - Orphan-policy: при смене роли старые значения остаются в БД, но **не показываются** в UI и **не очищаются автоматически**. Save отправляет только ключи, описанные в schema текущей роли.
3. **Frontend classifier**
  - Новый kind `package_role_custom_field` в `placeholderClassifier.ts`.
  - Regex: `^(ln-\d{6})\.custom\.([a-z][a-z0-9_]{0,49})$`.
  - Проверяется **до** `RE_PACKAGE_ROLE_SUB`.
4. **Edge resolver `resolveLnCustomToken**` — только для `package-tokens-dry-run`
  В `supabase/functions/_shared/resolve-package-tokens.ts`. Состояния:
  - `ok` — ровно 1 assignment + ключ есть в schema роли + значение присутствует.
  - `role_no_custom_field_def:<key>` — ключ не объявлен в schema роли.
  - **то же имя кода**, что уже использует sub-field resolver для «нет assignments» (переиспользовать константу, не плодить новую).
  - `multiple_persons_for_scalar_role_custom_field` — assignments > 1 (controlled warning, **не ошибка**).
  - `canonical-document-generate-strict` НЕ трогаем; реальная DOCX-подстановка → E.4.
5. **Каталог плейсхолдеров**
  В `src/utils/packagePlaceholderCatalog.ts` — добавлять `ln-XXXXXX.custom.<key>` items **только** для ролей с непустым `assignment_custom_fields[]`.

## Жёстко out of scope (НЕ трогаем)

- `canonical-document-generate-strict`
- `ai-generate-document-package`
- Реальная DOCX-подстановка `{{ln-XXX.custom.<key>}}` → **E.4**
- `{{tableRepeat:TR-XXXXXX}}`, DOCX row expansion, table-repeat UI → **E.2/E.3**
- Изменения сигнатуры `save_session_document_atomic`, RLS, GRANT, SECURITY DEFINER

## Изменяемые файлы

- `src/components/admin/documents/PackageRolesManager.tsx` — UI schema editor + stale-cache guard
- `src/components/admin/documents/PackageDocumentCard.tsx` — UI values editor, save с `custom`/`position_gender`
- `src/hooks/useDocumentItemRoleAssignments.ts` — extended Input с `custom`
- `src/lib/documents/assignmentCustomFieldsSpec.ts` — `mergeAssignmentMetadataWithCustom({ keepEmpty })`
- `src/utils/placeholderClassifier.ts` — новый kind `package_role_custom_field`
- `src/utils/packagePlaceholderCatalog.ts` — items только для ролей со schema
- `supabase/functions/_shared/resolve-package-tokens.ts` — `resolveLnCustomToken` (dry-run only)
- `.lovable/proofs/docx_table_repeat_by_role_e1a_custom_fields.md` — proof
- `.lovable/plan.md` — статус Stage E.1a

## DoD / Proof

Proof `.lovable/proofs/docx_table_repeat_by_role_e1a_custom_fields.md`:

1. Ссылка на prerequisite: **PATCH-DPIRA-METADATA-MERGE-V1 — PASS** (`.lovable/proofs/dpira_metadata_merge_v1.md`).
2. SQL до/после на `document_package_role_catalog` (`public_id='ln-000015'`): добавление `assignment_custom_fields=[{key:'votes',label:'Голоса'}]`, `enable_person_subfields` не теряется.
3. SQL до/после на `document_package_item_role_assignments` (по `role_catalog_id`): `metadata.custom.votes` сохраняется; `position` и `position_gender` не теряются.
4. Dry-run сценарии для `{{ln-000015.custom.votes}}`:
  - 1 assignment с value → `ok`
  - 1 assignment, ключ удалён из schema → `role_no_custom_field_def:votes`
  - 0 assignments → код, идентичный sub-field resolver'у
  - 3 assignments → controlled warning `multiple_persons_for_scalar_role_custom_field`
5. Orphan policy: смена роли — старое значение остаётся в БД, в UI не видно, save не очищает.
6. Stale-cache guard в schema editor: confirmed.
7. **Явная оговорка**: реальная DOCX-подстановка `{{ln-XXX.custom.<key>}}` НЕ закрыта в E.1a, идёт в E.4. `canonical-document-generate-strict` не тронут.
8. Контракт `keepEmpty: true` для v1 (явная очистка через `""`).
9. RPC signature / RLS / GRANT / SECURITY DEFINER не менялись.
10. E.2/E.3/E.4 не начинались.

**Финальный статус (ожидаемый):**
`Stage E.1a — PASS: custom fields schema + values UI + dry-run scalar resolver. Реальная DOCX-подстановка перенесена в E.4.`

После E.1a — отдельный отчёт. К E.2 не переходить без подтверждения.
---

## Stage E.1a — EXECUTED (2026-06-21)

**Статус: PASS — custom fields schema + values UI + dry-run scalar resolver.**
**Реальная DOCX-подстановка `{{ln-XXXXXX.custom.<key>}}` перенесена в Stage E.4.**

Proof: `.lovable/proofs/docx_table_repeat_by_role_e1a_custom_fields.md`.
Миграция: `..._e1a_custom_fields_extend_rpc.sql` (тело RPC, сигнатура / RLS / GRANT не менялись).
