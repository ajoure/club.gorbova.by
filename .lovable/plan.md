да, согласен.

План можно выполнять как **Stage E.1a**.

Ключевые условия зафиксированы правильно:

```text
Stage E.1a — только custom fields schema + values UI + dry-run scalar resolver
```

Не переходить к E.2 без отдельного отчёта и подтверждения.

Итоговый ожидаемый статус после выполнения:

```text
Stage E.1a — PASS: custom fields schema + values UI + dry-run scalar resolver
```

Важно: реальная DOCX-подстановка `{{ln-XXXXXX.custom.<key>}}` в этом этапе **не закрывается** и остаётся на E.4.

&nbsp;

План: PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1a — Custom Assignment Fields (v2, с уточнениями)

## Scope (строго)

1. UI редактор **schema** custom fields у роли — `document_package_role_catalog.metadata.assignment_custom_fields[]`.
2. UI editor **values** custom fields у конкретного назначения — `document_package_item_role_assignments.metadata.custom.<key>`.
3. **Frontend classifier** для `{{ln-XXXXXX.custom.<key>}}`.
4. **Edge resolver `resolveLnCustomToken**`, доступный из `package-tokens-dry-run`.
5. Каталог плейсхолдеров — items для custom fields в admin tab Placeholders.

## Out of scope (НЕ делаем в E.1a)

- `canonical-document-generate-strict` — не трогаем.
- `ai-generate-document-package` (preresolved для custom) — не трогаем.
- Реальная подстановка `{{ln-XXX.custom.<key>}}` в финальный DOCX — **переносится в E.4** вместе с table-repeat generator work.
- UI table-repeat, маркер `{{tableRepeat:TR-XXXXXX}}`, классификатор/валидатор для него, DOCX row expansion, клонирование `<w:tr>`.
- Изменения миграций (E.1 закрыт PASS).

Контракт E.1a: после выполнения custom scalar token виден **только в dry-run/каталоге**, а не в реально сгенерированном документе. Любая формулировка вида «токен работает в DOCX» в proof/отчёте запрещена.

## Pre-flight (подтверждено по коду)

- `document_package_role_catalog.metadata jsonb` — есть, используется `enable_person_subfields`.
- `document_package_item_role_assignments.metadata jsonb` — есть, используется `position`.
- `src/lib/documents/assignmentCustomFieldsSpec.ts` + edge mirror — созданы в E.1: `validateCustomFieldKey`, `RESERVED_CUSTOM_FIELD_KEYS`, `readAssignmentCustomFieldDefs`, `readAssignmentCustomValues`, `mergeAssignmentMetadataWithCustom`.
- `useDocumentItemRoleAssignments.ts` сейчас собирает `metadata` с нуля (`pos ? { position: pos } : {}`) — теряет `custom`/`position_gender`. Это требует mini-patch внутри E.1a (шаг 2).

## Шаги

### 1. Schema editor у роли (EditRoleDialog в PackageRolesManager.tsx)

Блок «Дополнительные поля назначения» под существующим `enable_person_subfields`:

- Таблица: `key`, `label`, `type ∈ {text|number|percent|date}`, `placeholder`, `required`.
- Кнопки «Добавить поле» / «Удалить поле».
- Inline валидация:
  - `validateCustomFieldKey(key)` → `invalid_format` / `reserved`.
  - Уникальность `key` внутри роли (UI-проверка).
  - `label` non-empty.

**Guard против stale cache role.metadata:** перед `update()` перечитать актуальную строку:

```ts
const { data: fresh } = await supabase
  .from("document_package_role_catalog")
  .select("metadata")
  .eq("id", row.id)
  .single();

const merged = {
  ...((fresh?.metadata as Record<string, unknown>) ?? {}),
  enable_person_subfields: enableSubfields,
  assignment_custom_fields: defs,
};

await supabase
  .from("document_package_role_catalog")
  .update({ metadata: merged })
  .eq("id", row.id);
```

Категорически нельзя писать `{ assignment_custom_fields: defs }` без merge — потеряются `enable_person_subfields` и всё, что добавим позже.

**Удаление field из schema:** просто убрать из массива. Старые values в assignments **не чистим** (см. шаг 3, orphan policy).

### 2. Mini-patch atomic save (useDocumentItemRoleAssignments.ts)

Расширяем `ItemAssignmentInput`:

```ts
export interface ItemAssignmentInput {
  role_catalog_id: string;
  person_id: string;
  position?: string | null;         // undefined = не менять, null/"" = очистить
  position_gender?: string | null;  // тот же контракт
  custom?: Record<string, string>;  // пустая строка = очистить, ключ отсутствует = не менять
  sort_order?: number;
}
```

**Контракт position/position_gender (фикс «залипания»):**

```ts
// Берём существующий metadata из предыдущей записи (replace-save: до архивации)
const prevMeta = (prevById.get(key)?.metadata as Record<string, unknown>) ?? {};
const base: Record<string, unknown> = { ...prevMeta };
delete base.custom; // custom отдельно через merge helper

// position
if (a.position !== undefined) {
  const t = (a.position ?? "").trim();
  if (t.length > 0) base.position = t; else delete base.position;
}
// position_gender — тот же паттерн
if (a.position_gender !== undefined) {
  const g = (a.position_gender ?? "").trim();
  if (g.length > 0) base.position_gender = g; else delete base.position_gender;
}

// custom: контракт v1 — пустой input → metadata.custom[key] = "" (без автоудаления ключа)
const meta = mergeAssignmentMetadataWithCustom(base, a.custom);
```

ВАЖНО: `mergeAssignmentMetadataWithCustom` в текущей реализации удаляет пустые строки. Для контракта v1 (пустое = `""`, не удаляем ключ) нужен либо опция в helper, либо локальная альтернатива в hook. Подтвердить выбор: расширить helper параметром `{ keepEmpty: true }` (предпочтительно — единый SOT) или собрать `custom` инлайн. План — расширить helper флагом `keepEmpty`, frontend mirror и edge mirror одинаково.

**Caller (PackageDocumentCard)** обязан передавать `position_gender` и `custom` из исходного `a.metadata` при маппинге draft. В строке 189 PackageDocumentCard.tsx — расширить чтение draft:

```ts
position: meta?.position ?? "",
position_gender: meta?.position_gender ?? "",
custom: readAssignmentCustomValues(meta),
```

### 3. Values editor в PackageDocumentCard.tsx (строго по роли строки)

Для каждой строки assignment:

- `role = roles.find(r => r.id === row.role_catalog_id)`.
- `defs = readAssignmentCustomFieldDefs(role?.metadata)`.
- Если `defs.length === 0` — блок не рендерим.
- Inputs: text/number/percent → `<Input>`, date → `<Input type="date">`. Required отражается визуально, но не блокирует save (минимум сейчас).
- onChange → `updateRow(uid, { custom: { ...row.custom, [key]: value } })`.

**При смене роли в строке** (`role_catalog_id` change): пересчёт UI идёт автоматически через `defs` новой роли. Старые `custom`-значения **не показываются**, но **не удаляются автоматически** из state — на submit передаём только те ключи, что есть в текущей schema роли:

```ts
const activeDefs = readAssignmentCustomFieldDefs(role?.metadata);
const filteredCustom: Record<string, string> = {};
for (const d of activeDefs) {
  if (row.custom[d.key] !== undefined) filteredCustom[d.key] = row.custom[d.key];
}
save({ ..., custom: filteredCustom });
```

**Orphan policy (поле удалено из schema роли):**

- Старые значения в БД не чистим.
- В UI не показываем.
- На save **не передаём** orphan keys → они исчезают из новой записи (replace-save архивирует старую → новые INSERT не содержат orphan). Это допустимо и описано в proof отдельным пунктом.
- Dry-run для удалённого key даёт `role_no_custom_field_def:<key>`.

### 4. Classifier — `src/lib/documents/placeholderClassifier.ts`

Новый kind:

```ts
{ kind: 'package_role_custom_field'; public_id: string; custom_key: string; }
```

Regex: `^(ln-\d{6})\.custom\.([a-z][a-z0-9_]{0,49})$` без модификаторов format/case (в E.1a у custom их нет).

Порядок в `classifyPlaceholder`: **до** `RE_PACKAGE_ROLE_SUB`, иначе `.custom.foo` поймает sub-field branch.

### 5. Edge resolver `resolveLnCustomToken` — `supabase/functions/_shared/resolve-package-tokens.ts`

Новая функция, scope-проверки **строго по аналогии с `resolveLnSubFieldToken**`:

- Роль найдена по `public_id` И принадлежит текущему `package_template_id`.
- Assignments фильтруем: `package_session_id`, `package_template_item_id`, `is_active = true`, `person_id IS NOT NULL`.
- Lookup `assignment_custom_fields` через edge-mirror spec.

**Нейминг кодов — сверить с существующими.** В текущем `resolve-package-tokens.ts` для sub-field branch используется `multiple_persons_for_scalar_role_subfield`. Для отсутствующих назначений в proof-сценарии E.1a нужно прочитать, какой код уже выдаёт sub-field resolver, и использовать тот же (`role_assignment_missing` если существует, иначе `role_no_assignments`). Никаких новых синонимов. В proof фиксируется итоговое имя.

Итоговые states resolver:

- `ok` — 1 assignment, ключ есть в schema, значение возвращено.
- `role_no_custom_field_def:<key>` — schema роли не содержит этого key.
- `<существующий код «нет назначений»>` (см. выше) — 0 assignments.
- `multiple_persons_for_scalar_role_custom_field` — 2+ assignments, value пустая (controlled warning, **не ошибка генерации**, dry-run возвращает warning).

Диспетчер в `resolvePackageToken`: `LN_CUSTOM_RE = /^ln-(\d{6})\.custom\.([a-z][a-z0-9_]{0,49})$/` **перед** `LN_SUB_RE` и `LN_RE`.

`**canonical-document-generate-strict` НЕ ТРОГАЕМ.** Если custom-токен попадёт в реальную генерацию в E.1a, он останется unresolved (или поведёт себя как раньше) — это ожидаемо, реальная подстановка едет в E.4.

### 6. Каталог плейсхолдеров (packagePlaceholderCatalog.ts)

Для каждой роли — items только если `readAssignmentCustomFieldDefs(role.metadata).length > 0`. Не выводим пустой блок.

Для каждого def:

- token: `{{ln-XXXXXX.custom.<key>}}`
- label: «<role.label> — <field.label>»
- hint: «Скаляр custom-поля назначения. Для обычного scalar-токена роль должна иметь ровно одно активное назначение. Если назначений несколько, используйте table-repeat (Stage E.4). Несколько назначений → warning `multiple_persons_for_scalar_role_custom_field`.»

### 7. Proof — `.lovable/proofs/docx_table_repeat_by_role_e1a_custom_fields.md`

Обязательные секции:

1. **SQL до правок:**
  ```sql
   SELECT id, label, public_id, metadata
   FROM document_package_role_catalog
   WHERE public_id = 'ln-000015';

   SELECT id, role_catalog_id, person_id, metadata
   FROM document_package_item_role_assignments
   WHERE role_catalog_id = '<role_id>'
   ORDER BY sort_order NULLS LAST, id;
  ```
2. **UI: добавление schema** — у роли «Участник / ln-000015» создаём `votes (number)`, `share_percent (percent)`.
3. **SQL после save schema** — `role.metadata` содержит ОБА: `enable_person_subfields=true` и `assignment_custom_fields=[…]`.
4. **UI: values per assignment** — у 3 assignments разные значения votes/share_percent.
5. **SQL assignments после save values:**
  - `metadata.position` сохранён.
  - `metadata.position_gender` сохранён (если был задан до правок).
  - `metadata.custom.votes` / `share_percent` — корректные per row.
  - Контракт пустого input: ключ остался с `""`.
6. **Dry-run scalar resolver** (через `package-tokens-dry-run`, не через реальную генерацию):
  - 1 assignment → `{{ln-000015.custom.votes}}` резолвится в значение.
  - 3 assignments → warning `multiple_persons_for_scalar_role_custom_field` (НЕ ошибка генерации).
  - Несуществующий key → `role_no_custom_field_def:<key>`.
  - 0 assignments → `<нейминг, согласованный с существующим sub-field resolver>` (явно зафиксировать имя кода).
7. **Регрессия** — `{{ln-000015}}` и `{{ln-000015.full_name}}` продолжают работать в реальной генерации.
8. **Orphan policy** — удалили `votes` из schema роли:
  - Старые значения остались в БД.
  - В UI скрыты.
  - Save assignment проходит без ошибок.
  - Dry-run `{{ln-000015.custom.votes}}` → `role_no_custom_field_def:votes`.
9. **Stale-cache guard** — продемонстрировать (или хотя бы зафиксировать в коде), что save schema перечитывает `role.metadata` перед merge.
10. **Явное ограничение скоупа:** в proof отдельным абзацем — реальная DOCX-подстановка `{{ln-XXX.custom.<key>}}` НЕ закрыта в E.1a, перенесена в E.4.

## DoD (уточнённый)

- Schema custom fields редактируется в UI роли; ключ валидируется (`invalid_format`/`reserved`), label обязателен, дубль ключа блокируется.
- Save schema роли использует stale-cache guard (re-read role.metadata) и merge со всеми существующими ключами `metadata`.
- Values редактируются per-assignment, **строго по defs текущей роли**; смена роли пересчитывает UI; orphan values не показываются.
- Atomic save assignments НЕ перезаписывает `position` / `position_gender` / другие верхнеуровневые ключи `document_package_item_role_assignments.metadata`. Контракт очистки полей корректен (undefined = не менять, "" = очистить для position; "" = сохранить пустую строку для custom v1).
- Реализация `enable_person_subfields` в `document_package_role_catalog.metadata` сохраняется при добавлении `assignment_custom_fields` (отдельный proof-пункт, отдельный merge-путь — это **другая** таблица, не путать с assignment metadata).
- Classifier распознаёт `{{ln-XXX.custom.<key>}}` и помещает его в `package_role_custom_field` до sub-field regex.
- Edge resolver `resolveLnCustomToken` (только для `package-tokens-dry-run`) корректно возвращает 4 states; нейминг кода «нет назначений» совпадает с уже существующим в sub-field resolver.
- Каталог плейсхолдеров показывает custom items **только** для ролей с непустой schema, hint содержит предупреждение про single-assignment.
- **Реальная DOCX-подстановка custom scalar НЕ заявляется как закрытая** — это E.4.
- Proof опубликован, все 10 секций заполнены.
- `canonical-document-generate-strict`, `ai-generate-document-package`, Gotenberg, billing resolver — не тронуты.

## STOP-conditions

1. Если шаг 2 обнаружит другие write-paths (RPC/edge fn), которые тоже перезаписывают `document_package_item_role_assignments.metadata` целиком — STOP, отдельный mini-patch metadata-merge на все пути.
2. Если `mergeAssignmentMetadataWithCustom` не получится расширить `keepEmpty` без ломания E.1 потребителей — STOP, отдельное решение по контракту пустого значения custom.
3. Если existing resolver не имеет согласованного кода для «нет назначений» и текущий sub-field path даёт другое имя — задокументировать в proof и явно зафиксировать новое имя, согласовав с пользователем перед закрытием.

## Файлы

- `src/components/ai-documents/packages/PackageRolesManager.tsx` — EditRoleDialog: блок schema + stale-cache guard.
- `src/hooks/useDocumentItemRoleAssignments.ts` — расширение Input + контракт очистки + merge через spec.
- `src/components/ai-documents/packages/PackageDocumentCard.tsx` — values editor по defs роли + проброс `position_gender`/`custom` в save.
- `src/lib/documents/assignmentCustomFieldsSpec.ts` (+ edge mirror) — флаг `keepEmpty` для merge helper.
- `src/lib/documents/placeholderClassifier.ts` — kind `package_role_custom_field` + regex.
- `src/utils/packagePlaceholderCatalog.ts` — items custom только для ролей с непустой schema, hint с warning.
- `supabase/functions/_shared/resolve-package-tokens.ts` — `resolveLnCustomToken` + диспетчер.
- `.lovable/proofs/docx_table_repeat_by_role_e1a_custom_fields.md` — proof.
- `.lovable/plan.md` — отметка E.1a в работе → PASS.

## Статус после выполнения

**Stage E.1a — PASS: custom fields schema + values UI + dry-run scalar resolver.**

Реальная DOCX-подстановка `{{ln-XXX.custom.<key>}}` — в E.4, вместе с table-repeat generator. К E.2 не переходим без явного подтверждения.