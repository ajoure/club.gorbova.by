План: CRM Companies — Phase 1 production execution в Lovable Cloud (v2, с внесёнными правками 1–17)

Статус: PLAN ONLY / DO NOT EXECUTE. Ожидает отдельного согласования перед применением миграции.
Язык: план, отчёт о выполненной работе и вся переписка ведутся только на русском языке.

## 1. Цель

Однократно применить утверждённый Phase 1 forward migration (runnable plan, commit `5c86f46511548a8fd4586838a2af67cbf19f6bd9`) через штатный механизм миграций Lovable Cloud в подключённую managed-БД (`hdjgkjceownmmnrqqtuz`). Никакого rollback rehearsal, никакого повторного forward, никакого backfill.

## 2. Scope (что войдёт в единственную миграцию)

Ровно то, что заморожено в `.lovable/discovery/companies-1.0/companies_phase1_runnable_plan.md`:

- Регистрация namespace в `public_id_sequences`: `('company','CMP',0)` (без `ON CONFLICT DO NOTHING`).
- Таблица `public.companies` + GRANT + RLS + policies.
- Таблица `public.client_legal_details_company_map` (создаётся до `company_contacts`, т.к. FK) + GRANT + RLS + policies.
- Таблица `public.company_contacts` (`source_client_legal_details_map_id` → map(id) `ON DELETE RESTRICT`) + GRANT + RLS + policies.
- Таблица `public.company_sync_queue` (`service_role` only, никакого `authenticated` GRANT) + RLS + policy.
- Индексы согласно `companies_performance_notes.md` §4–7.
- Триггер `update_updated_at_column` на все 4 таблицы.
- Функция `public.set_companies_public_id()` и триггер `trg_set_companies_public_id` на `public.companies` (правка №1: функция и триггер — разные объекты).
- RPC-скелеты `crm_company_get_or_create(...)` и `crm_company_link_contact(...)` (SECURITY DEFINER, `SET search_path=public`, guard `has_role_v2`, тела — skeleton).
- 13 утверждённых RLS policies суммарно по 4 таблицам.
- Все `DO … RAISE EXCEPTION` guards из §3.0 runnable plan.

## 3. Что запрещено в этой миграции

- Backfill данных, тестовые/фикстурные строки в новых таблицах.
- Триггер на `client_legal_details` (Phase 4).
- Изменения `orders_v2`, `crm_tasks`, UI, edge functions.
- Feature flag, admin_section, admin_resource inserts (Phase 7).
- Rollback как тест, повторный forward, DROP+CREATE cycle.
- Правки approved DDL/RLS/RPC.

## 4. Порядок выполнения

### 4.1 Preflight (read-only, без изменений)

Через `supabase--read_query`:

- Пересчитать `schema_hash` по формуле из `companies_read_only_proof.md §7` и сравнить с baseline `c41160b83c8e15c3d3c41a13028700d5`.
- Проверить отсутствие в `pg_proc` (правка №1): `crm_company_get_or_create`, `crm_company_link_contact`, `set_companies_public_id`.
- Проверить отсутствие в `pg_trigger` (правка №1): `trg_set_companies_public_id` на `public.companies`.
- Проверить отсутствие таблиц: `companies`, `client_legal_details_company_map`, `company_contacts`, `company_sync_queue`.
- Namespace guard (правка №3): `SELECT 1 FROM public_id_sequences WHERE entity_type='company' OR prefix='CMP'` → должно быть 0 строк. Запрещены все три ситуации (company/CMP занят; company с другим prefix; CMP с другим entity_type).
- Точные сигнатуры helpers (правка №2) через `pg_get_function_identity_arguments`:
  - `public.next_public_id(p_entity_type text)`
  - `public.update_updated_at_column()`
  - `public.has_role_v2(_user_id uuid, _role_code text)`
  Тип `app_role_v2` в контракте НЕ используется.
- 7 канонических ролей в `public.roles`.
- SYSTEM tenant (правка №4) — полный контракт одновременно:
  - `id = '00000000-0000-0000-0000-000000000001'`
  - `name = 'system'`
  - `is_personal = false`
- Отсутствие companies-related триггеров на `client_legal_details`.

### 4.2 Атомарность выполнения (правка №5)

Перед применением подтвердить фактический контракт `supabase--migration`:
- либо документально доказано, что одна миграция выполняется атомарно (Lovable оборачивает в транзакцию);
- либо SQL должен содержать собственные `BEGIN;` / `COMMIT;`.

При отсутствии подтверждённого контракта — HARD STOP. Частично применённый DDL недопустим.

### 4.3 Единственная forward migration

Одна `supabase--migration` строго из approved runnable plan, содержащая:

- `SET LOCAL lock_timeout = '3s'` и `SET LOCAL statement_timeout = '30s'` (внутри транзакции — либо гарантированной Lovable, либо явной);
- все approved `DO … RAISE EXCEPTION` guards §3.0 первым блоком, до DDL, включая namespace guard в форме правки №3;
- DDL в порядке: namespace INSERT (без `ON CONFLICT`) → companies → client_legal_details_company_map → company_contacts → company_sync_queue → индексы → `update_updated_at_column` триггеры → `set_companies_public_id()` + `trg_set_companies_public_id` → RPC-скелеты;
- для каждой таблицы: `CREATE TABLE` → `GRANT` → `ENABLE ROW LEVEL SECURITY` → `CREATE POLICY`;
- никаких `ON CONFLICT DO NOTHING` для namespace.

Diff-контроль (правка №6): миграция НЕ обязана побайтово совпадать с runnable plan. Требуется:
- содержательное и дословное совпадение DDL, constraints, FK actions, indexes, triggers, RLS и RPC-блоков с approved SQL;
- допускаются только заранее перечисленные execution-wrapper дополнения: `SET LOCAL lock_timeout`, `SET LOCAL statement_timeout`, опциональные `BEGIN`/`COMMIT`;
- до применения к отчёту прикладывается нормализованный diff между runnable plan §3–§6 и migration SQL.

Порядок фиксации SHA (правка №7):
1. создать migration-файл в `supabase/migrations/`;
2. зафиксировать в commit, зафиксировать commit SHA;
3. рассчитать SHA-256 файла миграции;
4. приложить нормализованный diff;
5. применить именно этот файл;
6. после применения повторно подтвердить тот же commit SHA и SHA-256 файла;
7. проверить наличие ровно одной новой записи в таблице истории миграций Supabase (`supabase_migrations.schema_migrations`).

### 4.4 Post-migration verification (read-only)

Через `supabase--read_query`:

**Схема и данные:**
- 4 таблицы существуют, все пустые (`count(*) = 0`).
- Поля, `NOT NULL`, `DEFAULT`, `CHECK`, `UNIQUE`, FK actions совпадают с runnable plan (проверка по `information_schema` и `pg_constraint` по именам ограничений).

**Baseline существующей схемы (правка №9):**
- Повторно рассчитать schema_hash семи исходных таблиц по формуле §7 read-only proof.
- Ожидание: `c41160b83c8e15c3d3c41a13028700d5`.
- Это доказательство, что существующие таблицы и контракты не изменены.

**RLS (правка №11):**
- Для 4 таблиц: `pg_class.relrowsecurity = true`.
- 13 policies в `pg_policies` с точными `cmd`, `roles`, `qual`, `with_check` (прикладываются полностью, а не только количество).

**GRANT-матрица:**
- `authenticated` имеет CRUD на 3 публичные таблицы.
- `company_sync_queue` доступна только `service_role`.
- `anon` не имеет доступа ни к одной из 4 таблиц.

**Security-контракт трёх функций (правка №10) — `crm_company_get_or_create`, `crm_company_link_contact`, `set_companies_public_id`:**
- `pg_get_functiondef` — полные тела приложить;
- `prosecdef = true` для SECURITY DEFINER функций;
- `proconfig` содержит `search_path=public`;
- отсутствие EXECUTE у `PUBLIC`;
- точные EXECUTE grants по approved matrix;
- guard-роли внутри тел соответствуют approved matrix;
- `crm_company_link_contact` skeleton не содержит DML;
- `crm_company_get_or_create` skeleton не содержит INSERT в `companies`.

**Дополнительно:**
- Namespace `('company','CMP',0)` присутствует ровно один раз.
- Триггеры `update_updated_at_column` на 4 таблицах и `trg_set_companies_public_id` на `companies` активны.
- На `client_legal_details` не появилось companies-related триггеров.

**Linter (правка №12):** запуск `supabase--linter`. Блокируют закрытие спринта:
- ошибки RLS;
- небезопасный `SECURITY DEFINER` (missing `search_path`, доступ `PUBLIC`);
- неверный `search_path`;
- лишние grants;
- доступ `anon` к новым таблицам;
- доступ `authenticated` к `company_sync_queue`;
- ошибки функций, constraints, FK.

Некритичные performance/info findings — перенос в follow-up с явным обоснованием, не блокируют.

### 4.5 Static verification vs runtime proof vs API smoke (правка №13)

Разделены три разных вида доказательств:

1. **Static / catalog verification** — §4.4 выше. Выполняется в этом спринте.
2. **Database RLS runtime proof** — фактический `SET LOCAL ROLE authenticated` с JWT-контекстом реального пользователя каждой из 7 ролей и проверкой SELECT/INSERT/UPDATE/DELETE. Вызов `SELECT has_role_v2(...)` НЕ является доказательством того, что RLS разрешает пользователю SELECT. Если реальный JWT-контекст под sandbox-ролью недоступен — статус:
   `DEFERRED TO FOLLOW-UP — не блокирует основной additive scope`.
3. **PostgREST / API smoke** — реальные HTTP-запросы к Data API под `anon` и `authenticated` JWT. Если недоступно — статус:
   `DEFERRED TO FOLLOW-UP — не блокирует основной additive scope`.

В отчёте запрещено писать, что доступ `admin`/`super_admin` подтверждён на основании одного лишь вызова `has_role_v2`.

### 4.6 Deferred proofs (правка №14)

В этом спринте НЕ доказывается и явно перечисляется в deferred:

- public ID trigger runtime (нужен INSERT);
- INSERT/UPDATE/DELETE по всем ролям;
- billing lineage через `client_legal_details_company_map`;
- runtime-ветки RPC (`crm_company_get_or_create`, `crm_company_link_contact`);
- performance-замеры индексов (правка №17: неинформативны на пустых таблицах, выполняются после backfill).

### 4.7 Rollback артефакт (правка №8)

Rollback SQL из §9 runnable plan сохраняется в репозитории, вне `supabase/migrations/` (например, `.lovable/rollback/companies-phase1/phase1_rollback.sql`), с расчётом SHA-256. **Не применяется.**

Разрешённый diff PR включает ровно три позиции:
1. один forward migration в `supabase/migrations/`;
2. один неисполняемый rollback SQL в `.lovable/rollback/companies-phase1/`;
3. один отчёт о выполненной работе (markdown).

## 5. Stop-guards (до применения миграции)

Остановиться и вернуться с отчётом-блокером, если:

- `schema_hash` отличается от `c41160b83c8e15c3d3c41a13028700d5`;
- любой из 4 объектов уже существует;
- namespace guard §4.1 нашёл строку с `entity_type='company'` ИЛИ `prefix='CMP'`;
- отсутствует SYSTEM tenant по полному контракту (правка №4);
- отсутствует любой helper с точной сигнатурой (правка №2) или любая из 7 канонических ролей;
- атомарность миграции не подтверждена (правка №5);
- diff миграции не соответствует approved runnable plan §3–§6 по правилам правки №6;
- в diff PR появились файлы вне трёх разрешённых позиций (правка №8).

## 6. Порядок действий при ошибке после commit (правка №15)

- **Миграция не применилась атомарно** → блокер-отчёт, повторный запуск запрещён, ждать отдельного решения.
- **Миграция применилась, но critical verification / linter check не прошёл**:
  - остановить спринт;
  - не переходить к Phase 2;
  - НЕ выполнять rollback автоматически;
  - представить blocker-отчёт с фактическими outputs;
  - запросить отдельное решение на применение сохранённого rollback SQL.

## 7. Deliverable

`Отчет о выполненной работе: CRM Companies — Phase 1 production execution` (на русском), содержащий:

- pre-migration `schema_hash` и подтверждение baseline;
- commit SHA и SHA-256 файла миграции (зафиксированные до применения, подтверждённые после);
- нормализованный diff runnable plan §3–§6 vs migration SQL;
- полный текст всех verification-запросов и фактические outputs (не только количества);
- post-migration schema_hash семи исходных таблиц с подтверждением равенства baseline (правка №9);
- полный security-контракт трёх функций (правка №10);
- полные `qual`/`with_check` для 13 policies и `relrowsecurity=true` для 4 таблиц (правка №11);
- linter findings с классификацией «блокирует / не блокирует» по правке №12;
- SHA-256 сохранённого rollback SQL и его путь в репозитории;
- запись в `supabase_migrations.schema_migrations` — подтверждение ровно одной новой строки (правка №7);
- явный deferred-список (правки №13, №14, №17);
- финальный статус (правка №16):
  ```
  Phase 1 forward:        APPLIED
  Static verification:    PASSED
  Rollback:               NOT EXECUTED
  RLS runtime proof:      DEFERRED
  PostgREST smoke:        DEFERRED
  Follow-up validation:   RECORDED / NOT EXECUTED
  ```
  Формулировка `Follow-up validation: SCHEDULED` запрещена, если запуск фактически не назначен.

## 8. Follow-up (отдельный спринт, вне scope)

- Rollback rehearsal и повторный forward — только на выделенной staging-БД, когда она появится.
- Полная RLS runtime matrix под всеми 7 ролями с реальным JWT.
- Реальный PostgREST/API smoke.
- Runtime-ветки RPC, public ID trigger runtime, billing lineage.
- Performance-замеры индексов — после backfill / на репрезентативных объёмах (правка №17).
- Phase 2 (полные RPC), Phase 3 (backfill), далее по roadmap.

## 9. Требование к языку

План должен быть составлен на русском языке.
Отчёт о выполненной работе должен быть составлен на русском языке.
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.

## 10. Текущий статус

- Runnable plan: APPROVED (commit `5c86f46511548a8fd4586838a2af67cbf19f6bd9`).
- Отдельный Supabase staging: НЕ ТРЕБУЕТСЯ.
- Production execution plan v2 (с правками 1–17): ОЖИДАЕТ СВЕРКИ СТАТУСОВ (внесено / частично внесено / не внесено).
- Production migration: НЕ ЗАПУСКАТЬ до отдельного approve.
