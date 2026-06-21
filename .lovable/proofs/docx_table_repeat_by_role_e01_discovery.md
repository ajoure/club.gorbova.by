# PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 — Stage E.0.1 Discovery

**Дата:** 2026-06-21
**Режим:** read-only, без миграций и кода.

---

## 1. Состояние колонок `metadata`

| Таблица | `metadata jsonb` | Дефолт | Уже используется |
|---|---|---|---|
| `document_package_role_catalog` | **ЕСТЬ** | `'{}'::jsonb` | да — хранит `enable_person_subfields` (Sprint Role-Scoped Visibility) |
| `document_package_item_role_assignments` | **ЕСТЬ** | `'{}'::jsonb` | да — хранит `{ position: "..." }` |
| `document_package_template_items` | **НЕТ** | — | нужна одна `ADD COLUMN` |

**Вывод:** миграция в Stage E.1 сводится к одной `ALTER TABLE document_package_template_items ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb` + GIN индекс. У `role_catalog` и `assignments` ничего не добавляем.

---

## 2. Сохранение assignment.metadata (atomic path)

Источник записи: `src/hooks/useDocumentItemRoleAssignments.ts`. Алгоритм:

1. `UPDATE … SET is_active=false` для всех текущих активных пары (`session_id`, `template_item_id`);
2. `INSERT` новых строк с `metadata = pos ? { position: pos } : {}`.

**Критично:** `metadata` собирается из `position` и **полностью перезаписывается**. Текущая форма `ItemAssignmentInput` (`role_catalog_id`, `person_id`, `position`, `sort_order`) не пропускает custom-значения.

**Что нужно в Stage E.1a:**

- расширить `ItemAssignmentInput` полем `custom?: Record<string,string>`;
- собирать `metadata = { ...(pos ? { position: pos } : {}), ...(custom && Object.keys(custom).length ? { custom } : {}) }`;
- атомарность остаётся той же (archive-all + insert-new в одном UI-flow);
- **новая edge function не требуется** — путь полностью клиентский, политики RLS уже разрешают write super_admin'у.

`position_gender` сейчас в коде не пишется (в Discovery подтверждено — только в типах/резолверах). Не пересекается с `custom.<key>`.

---

## 3. `generation_mode='per_role_person'` ≠ table-row repeat

В БД и коде уже существует:
- `document_package_template_items.generation_mode` (`single` | `per_role_person`);
- `document_package_template_items.repeat_role_catalog_id`;
- хук `usePackageItemGenerationMode`, оркестратор `ai-generate-document-package` (lines 530–844), `canonical-document-generate-strict` (lines 272, 1230–2159).

**Семантика существующей фичи:** генерируется **N отдельных DOCX-файлов** (по одному на каждое активное физлицо роли). Это **document-level repeat**.

**Семантика этого патча:** **1 DOCX**, в котором **одна строка таблицы** размножается по физлицам роли. Это **table-row-level repeat** — другая ось.

**Решение по неймингу (обязательно для UI/кода/proof):**
- сохраняем `generation_mode` как есть;
- новая фича называется **«Повторяемые строки таблицы»** (`table_repeats[]`);
- маркер: `{{tableRepeat:TR-XXXXXX}}`;
- путать с «per-role-person» в UI запрещено — добавим подсказку в карточке документа.

---

## 4. RLS / GRANT'ы

Все три таблицы уже имеют GRANT'ы и активные RLS-политики (видно по supabase tables listing: 2/9/4 policies). Миграция Stage E.1 не трогает RLS — только `ADD COLUMN` + индекс.

---

## 5. Подтверждения по открытым вопросам плана

- **Storage schema custom fields:** `document_package_role_catalog.metadata.assignment_custom_fields[]` — колонка уже существует, merge с `enable_person_subfields` обязателен.
- **Storage values:** `document_package_item_role_assignments.metadata.custom.<key>` — колонка существует.
- **Storage table_repeats:** `document_package_template_items.metadata.table_repeats[]` — нужна `ADD COLUMN`.
- **Atomic save совместим** — без новой edge function.

---

## 6. Готовность к Stage E.1

- ✅ Колонка `role_catalog.metadata` есть.
- ✅ Колонка `assignments.metadata` есть.
- ⚠️ Колонка `template_items.metadata` отсутствует — одна `ADD COLUMN` в Stage E.1.
- ✅ Atomic save совместим с расширением `metadata.custom`.
- ⚠️ Существующий `enable_person_subfields` в `role_catalog.metadata` обязан сохраниться при добавлении `assignment_custom_fields` — merge на уровне UI-обновлений роли.

Stage E.1 готов к запуску.
