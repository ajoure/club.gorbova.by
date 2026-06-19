# PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1 — Stage A (Discovery + Schema) — PROOF

## Изменённые файлы

- migration: add columns `generation_mode` (default `single`, CHECK), `repeat_role_catalog_id` (FK → `document_package_role_catalog`), trigger function `dpti_assert_repeat_role_consistency()`, trigger `trg_dpti_assert_repeat_role_consistency` BEFORE INSERT/UPDATE на `public.document_package_template_items`.
- `src/components/ai-documents/packages/TemplateBindingControl.tsx` — per-item инлайн-настройка «Режим генерации» + «Роль-источник».
- `src/integrations/supabase/types.ts` — авто-регенерация после миграции.

## SQL before/after

```
-- before: document_package_template_items = 7 колонок (id, package_template_id, template_id, sort_order, is_required, title_override, created_at)
-- after:  +generation_mode text NOT NULL DEFAULT 'single', +repeat_role_catalog_id uuid NULL
```

Все существующие 4 item-а получили `single` / `NULL` (нулевая регрессия):

```
SELECT generation_mode, count(*), count(repeat_role_catalog_id) FROM document_package_template_items GROUP BY 1;
-- single | 4 | 0
```

## Триггер — негативные dry-run сценарии (DO-block, без коммита данных)

Прогнаны на item `f9962f6b-...` пакета «Годовое собрание» (`21764469-...`):

- **N1**: `single` + `repeat_role_catalog_id='c8fc4200-...'` → `dpti_repeat_role_must_be_null_in_single_mode`.
- **N2**: `per_role_person` + `repeat_role_catalog_id=NULL` → `dpti_repeat_role_required_in_per_role_person_mode`.
- **N3**: `per_role_person` + роль чужого пакета → `dpti_repeat_role_package_mismatch`.

Логика триггера также покрывает: роль не существует (`dpti_repeat_role_not_found`), роль неактивна (`dpti_repeat_role_inactive`), неизвестный режим (`dpti_unknown_generation_mode`).

## Позитивный сценарий + реверсивность

```
P1 set:    mode=per_role_person, role=c8fc4200-... (Участник) — OK
P1 revert: mode=single, role=NULL — OK
final state for f9962f6b: single / NULL  ✓
```

## UI

В админке пакета (`/admin/documents` → секция «Шаблоны пакета») у каждой привязанной позиции добавлены два контрола:

1. «Режим генерации»: `Один документ` / `По одному на каждого участника роли`. Вариант `per_role_person` disabled если у пакета нет активных ролей и показывает подсказку «Сначала добавьте роль пакета, затем выберите её как источник повторения.»
2. «Роль-источник»: список активных ролей текущего `package_template_id` (источник — `document_package_role_catalog`, не session participants).

Переключение в `single` явно отправляет `repeat_role_catalog_id=NULL` — скрытое значение не остаётся. Бейдж `× по роли «<label>»` в строке позиции показывает текущий режим. Сохранение идёт прямым UPDATE (RLS: admin/super_admin или владелец пакета).

## Что НЕ изменено

- `save_session_document_atomic` — без изменений (Stage 5 PASS).
- Текущий single-генератор (`ai-generate-document-package`, `canonical-document-generate-strict`) новые колонки не читает, поведение пакета «Годовое собрание» при `single` идентично прежнему.
- `document_package_session_field_values`, `document_package_item_role_assignments`, `document_package_session_participants` — схема и логика без изменений.
- Никаких новых RPC / edge functions / cron / enum / таблиц.

## DoD

- [x] Колонки и триггер существуют, ENABLE constraint работает (3 негативных + 1 позитивный + revert).
- [x] 100% существующих items имеют `single` / `NULL`.
- [x] UI позволяет admin'у переключать режим и роль; отображает текущий режим бейджем.
- [x] Реверсивность подтверждена.
- [x] Регрессий в single-флоу нет (генератор колонки игнорирует).
- [x] Стадии B/C/D остаются вне scope, оформятся отдельными планами.
