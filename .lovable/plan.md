# План: CRM Companies — Phase 1 ACL hardening и финальная static verification

Статус: **APPROVED и APPLIED** (см. отчёт `.lovable/reports/companies-phase1/phase1-acl-hardening-report.md`, §9 — документационный closure-патч).
Файл восстановлен в формате «План:» вместо ранее ошибочно закоммиченного текста review.

## 1. Scope

- Одна corrective migration через `supabase--migration`: только `REVOKE` / `GRANT` и DO-guards. Никаких DDL, никаких изменений схем, RLS-политик, RPC-тел, триггеров.
- Один отчёт: `.lovable/reports/companies-phase1/phase1-acl-hardening-report.md`.
- Авто-регенерация `src/integrations/supabase/types.ts` допустима только как no-op (schema PostgREST не меняется).
- UI, edge functions, `supabase/config.toml`, cron, storage — не трогать.
- Phase 2 — не начинать.

## 2. Read-only диагностика ДО правок

1. `pg_class.relacl` и `has_table_privilege` для 4 таблиц Phase 1 (`companies`, `client_legal_details_company_map`, `company_contacts`, `company_sync_queue`).
2. `pg_proc.proacl`, `prosecdef`, `proconfig` для 3 функций (`set_companies_public_id`, `crm_company_get_or_create`, `crm_company_link_contact`).
3. `pg_policy` — 13 строк, полный вывод `polname/polcmd/polroles/polqual/polwithcheck` без сокращений.
4. Baseline schema hash по discovery-запросу (`information_schema.columns` семи исходных таблиц, поля `table_name, column_name, data_type`); ожидание `c41160b83c8e15c3d3c41a13028700d5`.
5. Наличие данных в 4 таблицах (4 × 0 rows подтвердить, но пустота **не** является предпосылкой hardening).

## 3. Corrective migration

Внутри одной транзакции с `SET LOCAL lock_timeout='3s'`, `statement_timeout='30s'`.

1. **Preflight DO-guards**: 4 таблицы существуют, `relrowsecurity=true` на каждой, ровно 13 policies, 3 функции с точными identity args (`public.set_companies_public_id()`, `public.crm_company_get_or_create(text,text,text,text,text,uuid)`, `public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)`).
2. **Таблицы**:
   - `REVOKE ALL ON <table> FROM PUBLIC, anon, authenticated` для всех 4.
   - `GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO authenticated` для `companies`, `client_legal_details_company_map`, `company_contacts`.
   - `GRANT ALL ON <table> TO service_role` для всех 4.
   - `company_sync_queue`: никаких прав anon/authenticated.
3. **Функции**:
   - `set_companies_public_id()` — `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`. Никакого GRANT.
   - `crm_company_get_or_create(...)` и `crm_company_link_contact(...)` — `REVOKE ALL FROM PUBLIC, anon, service_role`, затем `GRANT EXECUTE ... TO authenticated`. `service_role` явный EXECUTE не получает (использует superuser bypass при необходимости; matrix утверждена).
4. **Post-apply invariants (DO-block)** через `has_table_privilege` / `has_function_privilege`:
   - anon и authenticated не имеют доступа к `company_sync_queue`.
   - anon не имеет EXECUTE на 3 функциях.
   - authenticated не имеет EXECUTE на `set_companies_public_id()`.
   - authenticated имеет CRUD на 3 CRM-таблицах и EXECUTE на 2 RPC.
   - Любое расхождение → `RAISE EXCEPTION` → транзакционный rollback.

Global default privileges (`ALTER DEFAULT PRIVILEGES`) не трогать: вынесено в security follow-up.

## 4. Финальная static verification

Все проверки — read-only, машинные outputs без прозы:

1. Матрицы `has_table_privilege` (4 таблицы × 3 роли × 4 действия) и `has_function_privilege` (3 функции × 3 роли × EXECUTE).
2. `pg_class.relacl` для 4 таблиц; `pg_proc.proacl` для 3 функций.
3. Полный `pg_policy` вывод для 13 строк.
4. Владельцы 3 функций (`postgres`).
5. Повторный baseline hash — обязан совпасть с `c41160b83c8e15c3d3c41a13028700d5`.
6. Пустота 4 таблиц.
7. Свежий `supabase--linter` — без новых findings по Phase 1 объектам.
8. Поиск прямых вызовов `next_public_id` в `src/**` и `supabase/**` (ожидание: только wrapper-функции в public-схеме, никаких клиентских вызовов).
9. Migration history: попытка чтения `supabase_migrations.schema_migrations`; при отказе доступа — статус `NOT VERIFIED — permission denied`.
10. Фиксация фактического SHA-256 файла corrective migration после применения и точного пути миграции; pre-apply SHA/commit — permanent gap.

## 5. Файловый scope патча

- `supabase/migrations/<ts>_crm_companies_phase1_acl_hardening.sql` (создаётся `supabase--migration`, точный `<ts>` фиксируется в отчёте).
- `.lovable/reports/companies-phase1/phase1-acl-hardening-report.md`.
- `.lovable/plan.md` (этот файл).
- `src/integrations/supabase/types.ts` — только как no-op auto-regeneration.

Любой другой diff — HARD STOP.

## 6. Stop-guards

- Preflight DO-guard провалился → миграция не выполняется, транзакция откатывается.
- Post-apply invariant нарушен → миграция откатывается, отчёт фиксирует SQLSTATE.
- Baseline hash после применения ≠ `c41160b83c8e15c3d3c41a13028700d5` → HARD STOP, разбор до продолжения.
- Появился schema-diff в `types.ts` → HARD STOP.

## 7. Deferred (не входит в этот спринт)

- Затягивание default privileges на public-схеме (project-wide security follow-up).
- Runtime API proof (staging execution с реальными вызовами `crm_company_get_or_create` / `crm_company_link_contact`).
- Фиксация pre-apply SHA/commit процесса для будущих спринтов (process fix, не data fix).
- Backfill, sync worker, UI, Phase 2 RPC — по roadmap Discovery 1.0.
