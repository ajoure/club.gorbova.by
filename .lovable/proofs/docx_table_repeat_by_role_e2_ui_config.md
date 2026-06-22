# Stage E.2 — PASS: table-repeat UI/config layer (no DOCX expansion, no token resolver)

**Patch:** PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.2
**Date:** 2026-06-22
**Status:** PASS

## Prerequisite

- **Stage E.1a — PASS:** `.lovable/proofs/docx_table_repeat_by_role_e1a_custom_fields.md`
- **PATCH-DPIRA-METADATA-MERGE-V1 — PASS:** `.lovable/proofs/dpira_metadata_merge_v1.md`

## Scope reminder

UI/config layer **only**:

- Section «Повторяемые строки таблиц» в `PackageDocumentCard` (admin-only).
- CRUD `metadata.table_repeats[]` через `useTemplateItemTableRepeats` (merge-only, fresh-read перед UPDATE).
- Выбор роли-источника, mapping колонок (включая `assignment_custom_field` из E.1a).
- Copy marker `{{tableRepeat:TR-XXXXXX}}` (служебный, не привязан к валидатору).
- Preview числа строк = `active assignments` роли по `(sessionId, item.id)`.

**НЕ в scope (закроется позже):**

- DOCX row expansion в `canonical-document-generate-strict` → **E.4**.
- Резолвер табличных значений `package-tokens-dry-run` → **E.3**.
- Поддержка маркера `{{tableRepeat:TR-...}}` в общем validator'е шаблона → **E.3**.

## Архитектурные решения

### 1. Хранение (SOT)

- **Schema/конфиг:** `document_package_template_items.metadata.table_repeats[]` (JSONB, без миграций).
- Формат `TableRepeatConfig` уже зафиксирован в Stage E.1 spec:
  - `src/lib/documents/tableRepeatSpec.ts` (frontend SOT)
  - `supabase/functions/_shared/table-repeat-spec.ts` (edge mirror)

### 2. Write-path (merge-only)

`useTemplateItemTableRepeats.save(nextRepeats)`:

1. `SELECT metadata FROM document_package_template_items WHERE id = $1` (свежий снимок);
2. `mergedMetadata = { ...freshMeta, table_repeats: readTableRepeats({ ...freshMeta, table_repeats: nextRepeats }) }` — `readTableRepeats` round-trip нормализует payload и отбрасывает невалидные элементы;
3. `UPDATE document_package_template_items SET metadata = $merged WHERE id = $1`.

Никаких прямых INSERT/DELETE, никаких новых RPC, никаких SECURITY DEFINER, никаких миграций. RLS-политика `Owner can update own package items` уже разрешает owner / admin / super_admin.

### 3. UI/storage units

- В UI `cell_index` отображается как **«Колонка N» (1-based)**.
- В storage `cell_index` всегда **0-based** (без изменений spec'а).
- Конвертация — только на рендере/onChange `TableRepeatColumnRow`.

### 4. source_type whitelist

- Базовый UI: `role_person`, `assignment_custom_field`, `package_field`, `static_text`, `row_number`, `empty`.
- Advanced `assignment_metadata` (произвольный `metadata.custom` ключ) — виден **только при `isSuperAdmin=true`** (refinement #5).
- Источник `assignment_custom_field` — Select **строго из** `role.metadata.assignment_custom_fields[].key` выбранной роли (E.1a). При отсутствии custom fields у роли — disabled-state с подсказкой.

### 5. `case` / `format` ограничены по spec sub-field

- `case` показывается только если `LN_SUB_FIELD_SPECS[key].supports_case === true`
  (full_name / short_name / signature_short / address_full).
- `format` показывается для `kind ∈ { name, date }`
  (full_name / short_name / signature_short / birth_date / passport_issued_date / passport_valid_until).

### 6. Helper hints (refinements #9, #10)

- `package_field`: «Значение пакетного поля одинаковое для всех строк.»
- `static_text`: «Статичный текст будет одинаковым во всех строках.»
- `row_number`: «Подставит порядковый номер строки начиная с 1.»
- `assignment_metadata`: «Advanced fallback: произвольный ключ metadata.custom без проверки schema.»

### 7. Preview числа строк

Считается локально из уже загруженных `assignments` (`useDocumentItemRoleAssignments(sessionId, itemId)`),
которые хук уже фильтрует `is_active = true`. Дополнительный фильтр — `person_id != null` (refinement #11).
Никаких обращений к генератору. Без выбранной роли — подсказка
«Сначала выберите роль».

### 8. Catalog visibility (refinements #18, #19)

`packagePlaceholderCatalog.ts` НЕ получает category «Повторяемые строки» в этом этапе:
у каталога нет item-context, поэтому глобальный показ `{{tableRepeat:TR-...}}`
без привязки к конкретному `template_item` запрещён. Маркер копируется
**только** из per-item редактора `TableRepeatsEditor`.

### 9. Validation (refinement #17)

Помощник `validateTableRepeatConfig` (`src/lib/documents/tableRepeatSpec.ts` + edge mirror):

| code                       | severity | блокирует save |
| -------------------------- | -------- | -------------- |
| `missing_role`             | error    | да             |
| `duplicate_cell_index`     | error    | да             |
| `negative_cell_index`      | error    | да             |
| `non_integer_cell_index`   | error    | да             |
| `missing_source_key`       | error    | да             |
| `orphan_custom_key`        | warn     | нет            |

Дополнительно — глобальный блокер: дубликаты `TR-id` в пределах одного item.

## Файлы

- `src/lib/documents/tableRepeatSpec.ts` — добавлен `validateTableRepeatConfig` + типы `TableRepeatIssue*`.
- `supabase/functions/_shared/table-repeat-spec.ts` — mirror того же helper'а (frontend/edge parity).
- `src/hooks/useTemplateItemTableRepeats.ts` *(new)* — read/write `metadata.table_repeats` через
  merge-only UPDATE.
- `src/components/ai-documents/packages/TableRepeatColumnRow.tsx` *(new)* — условный редактор колонки.
- `src/components/ai-documents/packages/TableRepeatsEditor.tsx` *(new)* — список конфигов + Save/Revert.
- `src/components/ai-documents/packages/PackageDocumentCard.tsx` — встроен `<TableRepeatsEditor>` (admin only),
  добавлены поля `metadata` в `PackageDocumentCardItem`, `isSuperAdmin` в props.
- `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx` — проброс `isSuperAdmin={rbac.isSuperAdmin}`.

## SQL: до / после на тестовом item

Пример с искусственным existing item-key (доказывает merge-only).

```sql
-- ДО: у item уже есть произвольный existing-ключ
SELECT id, metadata
FROM document_package_template_items
WHERE id = '<item_id>';
-- {
--   "some_existing_key": "keep"
-- }
```

Пользователь создаёт TR-конфиг `TR-000001` для роли `<role_id>` с одной колонкой
`role_person → full_name`, сохраняет.

```sql
-- ПОСЛЕ:
SELECT id, metadata
FROM document_package_template_items
WHERE id = '<item_id>';
-- {
--   "some_existing_key": "keep",
--   "table_repeats": [
--     {
--       "id": "TR-000001",
--       "role_catalog_id": "<role_id>",
--       "label": "",
--       "columns": [
--         { "cell_index": 0, "source_type": "role_person", "source_key": "full_name" }
--       ]
--     }
--   ]
-- }
```

`some_existing_key` сохранён ровно потому, что `useTemplateItemTableRepeats.save` сначала перечитывает
свежий `metadata` и пишет `{ ...freshMeta, table_repeats: ... }`.

## Round-trip / refresh DoD (refinement #14)

1. Создан TR-000001 (role X, 3 колонки: role_person.full_name, assignment_custom_field.votes, static_text "%").
2. «Сохранить конфиги» → toast «Повторяемые строки таблиц сохранены».
3. F5.
4. Открыт тот же документ → `TableRepeatsEditor` гидратируется через `useTemplateItemTableRepeats` →
   `TR-000001` восстановлен с тем же role/columns/source_key и `nextTableRepeatId` корректно
   предложил бы `TR-000002` для следующего.

## Orphan-ref сценарий (refinement #7)

1. В роли удалили custom field с key=`votes`.
2. В TR-конфиге колонка `assignment_custom_field` сохраняет `source_key="votes"`.
3. UI помечает строку warning'ом `orphan_custom_key`: «доп. поле «votes» больше не определено в schema роли. Конфиг сохранится как orphan-ref.»
4. Кнопка «Сохранить конфиги» доступна (warning не блокирует save).
5. **Резолвер dry-run по `{{tableRepeat:TR-...}}` в этом этапе НЕ реализован** — будет в Stage E.3.

## What we did NOT touch

| Артефакт                                          | Стат  | Комментарий                                         |
| ------------------------------------------------- | ----- | --------------------------------------------------- |
| `canonical-document-generate-strict`              | NOT TOUCHED | Реальный row-expansion → Stage E.4            |
| `ai-generate-document-package`                    | NOT TOUCHED | —                                             |
| `package-tokens-dry-run`                          | NOT TOUCHED | Резолвер `{{tableRepeat:...}}` → Stage E.3   |
| `save_session_document_atomic`                    | NOT TOUCHED | Сигнатура/RLS/permissions не менялись         |
| `placeholderClassifier.ts` (front + edge)         | NOT TOUCHED | Маркер `{{tableRepeat:...}}` пока не классифицируется глобальным validator'ом (это E.3) |
| `packagePlaceholderCatalog.ts`                    | NOT TOUCHED | TR-маркеры — только per-item, не в глобальном каталоге (refinement #18/#19) |
| Migrations                                         | NONE        | Хранение JSONB поверх существующей колонки    |
| RPC / SECURITY DEFINER                            | NONE NEW    | UPDATE через RLS-политику                     |
| Security linter                                    | OK          | Никаких новых definer-функций                 |

## Frontend / edge spec parity

`tableRepeatSpec.ts` ↔ `_shared/table-repeat-spec.ts`: оба файла дополнены одинаковым
блоком `validateTableRepeatConfig` + типы `TableRepeatIssue*`. Базовые типы
`TableRepeatColumn`, `TableRepeatConfig`, `nextTableRepeatId`, `readTableRepeats`
не менялись.

## DoD checklist

- [x] UI секции «Повторяемые строки таблиц» работает в карточке документа пакета (admin only).
- [x] Создание `TR-XXXXXX` через `nextTableRepeatId` (монотонный по существующим id внутри item).
- [x] Выбор роли + редактор колонок + удаление конфигов с подтверждением о ручной правке DOCX.
- [x] `assignment_custom_field.source_key` выбирается только из реально определённых custom fields роли (E.1a).
- [x] Copy-кнопка маркера `{{tableRepeat:TR-XXXXXX}}` (через `navigator.clipboard.writeText`).
- [x] Preview числа строк отображается, когда выбрана роль и есть session-context.
- [x] UI 1-based номера колонок, storage 0-based.
- [x] `assignment_metadata` source — только для `isSuperAdmin`.
- [x] Validation: duplicate TR-id / missing role / duplicate cell_index / negative / non-integer / missing source_key — блокеры; `orphan_custom_key` — warning, не блокирует save.
- [x] Save merge-only: existing item-level metadata-ключи сохраняются.
- [x] Никаких изменений в генераторе / DOCX-резолвере / RPC / миграциях.
- [x] Frontend/edge spec parity сохранён.

## Финальный статус

```
Stage E.2 — PASS: table-repeat UI/config layer (no DOCX expansion, no token resolver)
```

После подтверждения PASS — переход к **Stage E.3** (token validator + dry-run resolver
для `{{tableRepeat:TR-...}}`). Не начинать без отдельного подтверждения.
