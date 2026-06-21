# PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 — Stage E.1 Report

**Дата:** 2026-06-21
**Тип:** schema migration (add-only) + shared TS specs.

---

## 1. Миграция

Применена единственная add-only миграция:

```sql
ALTER TABLE public.document_package_template_items
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_dptem_metadata_gin
  ON public.document_package_template_items USING gin (metadata);

COMMENT ON COLUMN public.document_package_template_items.metadata IS
  'Per-item конфиг. v1: metadata.table_repeats[] — повторяемые строки таблицы DOCX по роли (маркер {{tableRepeat:TR-XXXXXX}}). PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1.';
```

Что НЕ менялось (подтверждено discovery E.0.1):

- `document_package_role_catalog.metadata` — колонка уже была, не трогали;
- `document_package_item_role_assignments.metadata` — колонка уже была, не трогали;
- RLS / GRANT / триггеры — не менялись;
- никаких DDL/DML вне ADD COLUMN + индекса.

Security linter: 152 issues в проекте — все **pre-existing**, новых SECURITY DEFINER не появилось.

---

## 2. Shared TS specs (4 файла)

| Файл | Назначение |
|---|---|
| `src/lib/documents/assignmentCustomFieldsSpec.ts` | SOT custom fields (frontend) |
| `supabase/functions/_shared/assignment-custom-fields-spec.ts` | edge mirror |
| `src/lib/documents/tableRepeatSpec.ts` | SOT table-repeat (frontend) |
| `supabase/functions/_shared/table-repeat-spec.ts` | edge mirror |

### `assignmentCustomFieldsSpec`

- `AssignmentCustomFieldDef = { key, label, type, placeholder?, required? }`;
- `AssignmentCustomFieldType = 'text'|'number'|'percent'|'date'` (v1 хранит всё как строку);
- `CUSTOM_FIELD_KEY_REGEX = ^[a-z][a-z0-9_]{0,49}$`;
- `RESERVED_CUSTOM_FIELD_KEYS` включает все 15 системных ключей (`position`, `position_gender`, `custom`, `person_id`, `role_catalog_id`, `assignment_id`, `id`, `sort_order`, `is_active`, `package_session_id`, `package_template_item_id`, `created_at`, `updated_at`, `created_by`, `updated_by`);
- `validateCustomFieldKey()` возвращает `{ok:true}` или `{ok:false, code:'invalid_format'|'reserved'}`;
- `readAssignmentCustomFieldDefs(roleMetadata)` — безопасное чтение с фильтрацией невалидных записей;
- `readAssignmentCustomValues(assignmentMetadata)` — безопасное чтение значений;
- **`mergeAssignmentMetadataWithCustom(existing, custom)`** — критическая функция, обеспечивающая сохранение `position`, `position_gender` и любых других системных ключей при добавлении/обновлении `custom`. Не мутирует input. Удаляет пустой `custom`, чтобы не оставлять `{ custom: {} }` в БД.

### `tableRepeatSpec`

- `TableRepeatConfig = { id, role_catalog_id, label?, columns[] }`;
- `TableRepeatColumn = { cell_index, source_type, source_key?, case?, format? }`;
- `TableRepeatColumnSourceType` — 7 типов: `role_person`, `assignment_custom_field`, `package_field`, `static_text`, `row_number`, `empty`, `assignment_metadata` (последний — advanced fallback);
- `TABLE_REPEAT_MARKER_REGEX = /\{\{tableRepeat:(TR-\d{6,})\}\}/g`;
- `TABLE_REPEAT_ID_REGEX = /^TR-\d{6,}$/`;
- `nextTableRepeatId(existing)` — генерация TR-NNNNNN с zero-pad;
- `readTableRepeats(itemMetadata)` — безопасный парсер с фильтрацией.

Frontend и edge файлы идентичны по контракту (mirror policy).

---

## 3. Что НЕ сделано (явно)

- ❌ UI для schema custom fields у роли (Stage E.1a);
- ❌ UI для values у assignment (Stage E.1a);
- ❌ Расширение `useDocumentItemRoleAssignments` для `custom` (Stage E.1a);
- ❌ Scalar resolver `{{ln-XXX.custom.<key>}}` (Stage E.1a);
- ❌ UI table-repeat (Stage E.2);
- ❌ Classifier/validator tableRepeat (Stage E.3);
- ❌ DOCX row expansion в генераторе (Stage E.4);
- ❌ Runtime proof (Stage E.5).

---

## 4. Готовность к Stage E.1a

- ✅ Колонка `template_items.metadata` существует;
- ✅ Spec-функции custom fields готовы к использованию в UI;
- ✅ `mergeAssignmentMetadataWithCustom` готов к интеграции в `useDocumentItemRoleAssignments` (защита от потери `position`/`position_gender`/любых других ключей);
- ⚠️ **Перед стартом E.1a** требуется явное подтверждение пользователя (как договорились) — отдельный отчёт после каждого этапа, без авто-перехода к следующему.
