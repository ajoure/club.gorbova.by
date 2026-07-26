## Scope
Read-only проверка миграции `supabase/migrations/20260726190000_package_level_document_access.sql` на SHA `de638582`. Ничего не применяется.

## Verification результаты (read-only)

### 1. Порядок миграций
Файл `20260726190000_...` идёт строго после `20260726173000_document_generation_public_package_access.sql` (последнего применённого) — timestamp-порядок корректен, промежуточных файлов нет.

### 2. SQL-структура (261 строка)
Миграция выполняет 4 операции:
- `ALTER TABLE public.document_package_templates ADD COLUMN IF NOT EXISTS is_available_to_all boolean NOT NULL DEFAULT false` + `COMMENT`.
- Partial index `document_package_templates_default_access_idx` на `(id) WHERE profile_id IS NULL AND is_active AND is_available_to_all`.
- `CREATE OR REPLACE FUNCTION public.set_global_document_package_default_access(uuid, boolean)` — новая admin-only RPC для тумблера доступности глобального пакета, пишет `audit_logs` при смене состояния.
- `CREATE OR REPLACE FUNCTION public.get_user_document_package_ids()` — переписан: теперь возвращает `full_access + package_ids`, отдаёт `full_access=true` только для админов и `access_mode='full'` правил; глобальные пакеты с `is_available_to_all=true` включаются в список `package_ids` для authenticated (без `full_access`).
- `CREATE OR REPLACE FUNCTION public.get_user_section_access(uuid)` — переписан: секция `document_generation` открывается либо через access_rule продукта/тарифа, либо при наличии хотя бы одного глобального пакета с `is_available_to_all=true`; общий `is_public` больше не открывает эту секцию.

### 3. Права и security posture
Все три функции — `SECURITY DEFINER`, `SET search_path = public`. Явно:
- `REVOKE ALL ... FROM PUBLIC, anon` и `GRANT EXECUTE ... TO authenticated` для всех трёх функций.
- Внутри `set_global_document_package_default_access` — двойная проверка: `auth.uid() NOT NULL` и `has_role_v2('admin' or 'super_admin')`, иначе `RAISE EXCEPTION`. Плюс защита `profile_id IS NOT NULL → not a global package`.
- RLS не изменяется; таблицы не переоткрываются для anon. Новая колонка — обычный boolean с безопасным default `false`.

### 4. Совместимость с 20260726173000
Предыдущая миграция уже переопределяла `get_user_document_package_ids()` с сигнатурой `RETURNS TABLE(full_access boolean, package_ids uuid[])`. Новая миграция сохраняет ту же сигнатуру → `CREATE OR REPLACE` пройдёт без drop. Логика 173000 (открытие всех пакетов при `app_sections.document_generation.is_public=true`) заменяется на package-level флаг — это осознанная семантика из документа.

### 5. Baseline (зафиксировано сейчас на проде, до применения)
- `document_package_templates`: total=2, global=2, global_active=2. Колонки `is_available_to_all` **ещё нет** (ожидаемо).
- `app_sections.document_generation`: `is_public=false, is_active=true`.
- `access_rules` активные: `club=5, document_generation=4, product_access=11, section_access=13, training_content=36` (итого 69).
- Функции `get_user_document_package_ids()` и `get_user_section_access(uuid)` существуют в версии 173000.

## Риски
- `access_rules.grant_target_type='document_generation'` = 4 записи. Новая ветка `access_mode='full' vs 'partial'` берётся из `conditions->>'access_mode'` с fallback `'full'`. Если в этих 4 записях `conditions` не заданы или access_mode отсутствует, все они трактуются как `full` → пользователь получит `full_access=true`. Это соответствует прежнему поведению 173000 (там `document_generation` тоже давал полный доступ). Нужно подтвердить count после apply.
- Partial index создаётся до заполнения колонки — index будет пустой, это OK.

## План EXECUTE (когда одобрено)
1. Verify HEAD SHA = `de638582687fbf5fe9aafc6922de9f2e44c0a126`; frontend typecheck+build PASS.
2. `list_pending_findings` — стоп только при critical в scope document generation / packages access.
3. Apply единственной миграции `20260726190000_package_level_document_access.sql`.
4. Read-back (см. ниже). Ошибка read-back = стоп без Publish.
5. Publish frontend (если пользователь явно санкционирует; иначе стоп после read-back).

## Read-back checklist
- `information_schema.columns`: колонка `document_package_templates.is_available_to_all` существует, `boolean NOT NULL DEFAULT false`.
- `pg_indexes`: `document_package_templates_default_access_idx` присутствует, partial predicate совпадает.
- `pg_proc` + `pg_get_functiondef`: обе функции `get_user_document_package_ids()` и `get_user_section_access(uuid)` содержат ссылки на `is_available_to_all`; новая функция `set_global_document_package_default_access(uuid, boolean)` создана.
- `has_function_privilege`: `authenticated=true`, `anon=false` для всех трёх функций.
- Baseline не изменён: `document_package_templates` count=2, все `is_available_to_all=false`; `access_rules` counts по типам без изменений; `app_sections.document_generation` без изменений.
- Никаких новых пользователей/писем/платежей/ссылок/файлов не создано.

## Stop-conditions
- Ошибка `ALTER TABLE` (например, из-за FK/lock) — стоп.
- `CREATE OR REPLACE FUNCTION` падает из-за изменения сигнатуры — стоп.
- Read-back показывает недостающий объект или неверные grants — стоп.
- Появление critical finding в scope document packages — стоп.

Готов к EXECUTE по вашему подтверждению.