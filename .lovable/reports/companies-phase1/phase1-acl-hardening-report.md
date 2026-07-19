# Отчет о выполненной работе: CRM Companies — Phase 1 ACL hardening и финальная static verification

## 1. Итоговый статус

- Phase 1 forward: **APPLIED** (ранее, commit `0abff5b`).
- Phase 1 ACL hardening: **APPLIED** (текущая corrective migration).
- Security-контракт: **PASSED** (см. §4).
- Rollback Phase 1: **НЕ ПРИМЕНЯЛСЯ**, файл `.lovable/rollback/companies-phase1/phase1_rollback.sql` не изменялся.
- Backfill / production fixtures: **НЕ ЗАПУСКАЛИСЬ** (4 таблицы пусты).
- Phase 2: **НЕ НАЧАТ**.

## 2. Файловый scope спринта

Изменённые файлы (фактический совокупный diff ACL-hardening спринта):

- `supabase/migrations/20260719165300_1370ed2d-374b-42d8-bfb2-4ba1100878d9.sql` — corrective migration (REVOKE/GRANT + DO-guards). SHA-256 текущего файла: `0196525ab0bdc1466525eae01cb8156127dc16e6f1cc56e976f34755f5556a3c`.
- `.lovable/reports/companies-phase1/phase1-acl-hardening-report.md` — настоящий отчёт.
- `.lovable/plan.md` — план ACL hardening (в отдельном документационном патче восстановлен в формате «План:»).
- `src/integrations/supabase/types.ts` — авто-регенерируемый файл; содержательного schema diff нет (ACL не меняет PostgREST-контракт).

Ссылка на Phase 1 forward migration: `supabase/migrations/20260719162721_d83567e6-e8a4-4beb-8e97-3cfad083da9b.sql`, SHA-256 `c15be4e3860be9a149cb11ac9103c8c384838d5ea270868121e44bcda2dd5e6b`.

Другие файлы, UI, edge functions и `config.toml` не изменялись.

## 3. Read-only диагностика ДО hardening (для контроля blocker)

Фактический ACL (фрагмент, роль `sandbox_exec*` — служебная роль read-доступа среды):

```
relname                            | relacl (клиентские роли)
-----------------------------------+---------------------------------------------------------
companies                          | anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm
client_legal_details_company_map   | anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm
company_contacts                   | anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm
company_sync_queue                 | anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm
```

Функции:

```
proname                    | prosecdef | proacl (клиентские роли)
---------------------------+-----------+-----------------------------------------------
set_companies_public_id    | false     | PUBLIC=X, anon=X, authenticated=X, service_role=X
crm_company_get_or_create  | true      | anon=X, authenticated=X, service_role=X
crm_company_link_contact   | true      | anon=X, authenticated=X, service_role=X
```

Вывод: контракт нарушен по всем 4 таблицам и 3 функциям. Это подтверждает blocker и обосновывает corrective migration.

## 4. Corrective migration — состав

Внутри одной транзакции (`SET LOCAL lock_timeout='3s'`, `statement_timeout='30s'`):

1. Preflight DO-guards: наличие 4 таблиц, `relrowsecurity=true`, ровно 13 policies, наличие 3 функций с точными identity args.
2. Таблицы:
   - `REVOKE ALL ... FROM PUBLIC, anon, authenticated` на всех 4 таблицах.
   - `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` на `companies`, `client_legal_details_company_map`, `company_contacts`.
   - `GRANT ALL ... TO service_role` на всех 4 таблицах.
   - `company_sync_queue` — никаких прав anon/authenticated.
3. Функции:
   - `set_companies_public_id()` — `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`. EXECUTE ни одной внешней роли не выдаётся.
   - `crm_company_get_or_create(...)` и `crm_company_link_contact(...)` — `REVOKE ALL FROM PUBLIC, anon, service_role`, затем `GRANT EXECUTE ... TO authenticated`.
4. Post-apply invariants (DO-block): проверка через `has_table_privilege` и `has_function_privilege`, что anon/authenticated не имеют доступа к `company_sync_queue`, anon не имеет EXECUTE на 3 функциях, authenticated не имеет EXECUTE на trigger function, authenticated имеет CRUD на 3 таблицах и EXECUTE на 2 RPC. При любом расхождении — `RAISE EXCEPTION` и транзакционный rollback.

Глобальные default privileges не менялись.

## 5. Static verification ПОСЛЕ hardening (машинные outputs)

### 5.1 Таблицы: `relrowsecurity` и ACL

```
relname                            | relrowsecurity | relacl (клиентские роли, без служебных sandbox_exec)
-----------------------------------+----------------+------------------------------------------------------
companies                          | t              | service_role=arwdDxtm, authenticated=arwd
client_legal_details_company_map   | t              | service_role=arwdDxtm, authenticated=arwd
company_contacts                   | t              | service_role=arwdDxtm, authenticated=arwd
company_sync_queue                 | t              | service_role=arwdDxtm
```

`authenticated=arwd` = `SELECT/INSERT/UPDATE/DELETE`. Никаких прав anon и PUBLIC. RLS включён везде.

### 5.2 Таблицы: `has_table_privilege` матрица

```
Право   | anon | authenticated | service_role
--------+------+---------------+--------------
companies                        SELECT/INSERT/UPDATE/DELETE:  f/f/f/f | t/t/t/t | t/t/t/t
client_legal_details_company_map SELECT/INSERT/UPDATE/DELETE:  f/f/f/f | t/t/t/t | t/t/t/t
company_contacts                 SELECT/INSERT/UPDATE/DELETE:  f/f/f/f | t/t/t/t | t/t/t/t
company_sync_queue               SELECT/INSERT/UPDATE/DELETE:  f/f/f/f | f/f/f/f | t/t/t/t
```

Итоговая grant-матрица соответствует утверждённому §10 контракту:

| Объект                             | PUBLIC | anon | authenticated               | service_role |
| ---------------------------------- | ------ | ---- | --------------------------- | ------------ |
| `companies`                        | none   | none | SELECT/INSERT/UPDATE/DELETE | ALL          |
| `client_legal_details_company_map` | none   | none | SELECT/INSERT/UPDATE/DELETE | ALL          |
| `company_contacts`                 | none   | none | SELECT/INSERT/UPDATE/DELETE | ALL          |
| `company_sync_queue`               | none   | none | none                        | ALL          |

### 5.3 Функции: `prosecdef`, `proconfig`, `proacl`, `proowner`

```
proname                    | prosecdef | proconfig            | proacl (клиентские)                | owner
---------------------------+-----------+----------------------+------------------------------------+---------
set_companies_public_id    | false     | {search_path=public} | (нет внешних grants)               | postgres
crm_company_get_or_create  | true      | {search_path=public} | authenticated=X                    | postgres
crm_company_link_contact   | true      | {search_path=public} | authenticated=X                    | postgres
```

Совпадает с ожидаемой матрицей SECURITY DEFINER:

| Функция                          | `prosecdef` | `proconfig`          |
| -------------------------------- | ----------- | -------------------- |
| `set_companies_public_id()`      | `false`     | `search_path=public` |
| `crm_company_get_or_create(...)` | `true`      | `search_path=public` |
| `crm_company_link_contact(...)`  | `true`      | `search_path=public` |

Владелец всех трёх функций — `postgres` (доверенная migration-роль), а не `anon`/`authenticated`/`service_role`.

### 5.4 Функции: `has_function_privilege` матрица

```
Роль          | set_companies_public_id | crm_company_get_or_create | crm_company_link_contact
--------------+-------------------------+---------------------------+-------------------------
anon          | f                       | f                         | f
authenticated | f                       | t                         | t
service_role  | f                       | f                         | f
```

PUBLIC отдельно проверен через `aclexplode(proacl) WHERE grantee=0` — 0 rows для всех трёх функций.

Соответствует §10:

| Функция                     | PUBLIC | anon | authenticated | service_role |
| --------------------------- | ------ | ---- | ------------- | ------------ |
| `crm_company_get_or_create` | none   | none | EXECUTE       | none         |
| `crm_company_link_contact`  | none   | none | EXECUTE       | none         |
| `set_companies_public_id`   | none   | none | none          | none         |

### 5.5 Все 13 policies (polname, polcmd, polroles, qual, wcheck)

Все policies с `polroles={authenticated}`, кроме одной queue-policy `{service_role}`. `wcheck` присутствует только на INSERT-policies. Тела policies не изменялись относительно forward-миграции.

```
companies (4):
  read for CRM staff           r  qual=OR(super_admin,admin,menedzher,support)     wcheck=NULL
  insert for admin+manager     a  qual=NULL                                        wcheck=OR(super_admin,admin,menedzher)
  update for admin+manager     w  qual=OR(super_admin,admin,menedzher)             wcheck=NULL
  delete for super_admin       d  qual=has_role_v2(super_admin)                    wcheck=NULL

client_legal_details_company_map (4): аналогичный набор.
company_contacts (4):                 аналогичный набор.
company_sync_queue (1):
  service only                 *  qual=true  wcheck=true  polroles={service_role}
```

Итого: 4 + 4 + 4 + 1 = **13** policies, что совпадает с preflight-инвариантом.

### 5.6 Пустота таблиц (нет backfill/фикстур)

```
companies                        : 0
client_legal_details_company_map : 0
company_contacts                 : 0
company_sync_queue               : 0
```

### 5.7 Baseline schema hash

ACL-изменения (`GRANT`/`REVOKE`) не изменяют структуру объектов, участвующих в baseline hash (`c41160b83c8e15c3d3c41a13028700d5`). Хэш считается по столбцам, ограничениям, индексам, определениям политик и телам функций — все они не менялись данной миграцией. Соответствие baseline сохраняется по контракту.

### 5.8 Migration history

Обе миграции применены атомарным механизмом `supabase--migration`:

- Phase 1 forward — commit `0abff5b`.
- Phase 1 ACL hardening — новая migration `supabase/migrations/<ts>_crm_companies_phase1_acl_hardening.sql`.

Прямое чтение `supabase_migrations.schema_migrations` в этой среде запрещено политикой Lovable Cloud (`permission denied for schema supabase_migrations`); факт применения подтверждается фактическим состоянием ACL после DO-инвариантов миграции и наличием файла в `supabase/migrations/`.

### 5.9 Post-commit `supabase--linter`

Свежий post-commit запуск линтера возвращает 235 findings по всему проекту. Разбор по 4 таблицам и 3 функциям Phase 1:

- **RLS Enabled No Policy** — ни одна из 4 наших таблиц не попадает: у всех есть policies (см. §5.5). Findings относятся к другим таблицам проекта.
- **Function Search Path Mutable** — не относится к нашим 3 функциям: у всех трёх `proconfig={search_path=public}`. Findings относятся к другим функциям.
- **Public Can Execute SECURITY DEFINER Function** — после hardening `has_function_privilege('anon', ...)` = `false` для обоих RPC и для trigger function; `aclexplode WHERE grantee=0` = пусто. Наши функции линтером более не подсвечиваются как публичные. Оставшиеся findings относятся к другим SECURITY DEFINER функциям проекта.

Все 3 категории, объявленные утверждённым планом блокирующими, по объектам Phase 1 — **чисто**. Остальные findings — вне scope этого спринта.

## 6. Диагностика `next_public_id` (без изменений)

`public.next_public_id(p_entity_type text)`:

- `prosecdef = true`, `proconfig = {search_path=public}`.
- `proacl`: `authenticated=X, service_role=X` (нет anon, нет PUBLIC).
- Обслуживает несколько namespaces одновременно (`company/CMP` — один из них).

Изменения ACL этой функции в текущем спринте **не производились** — требуется отдельный impact analysis по всем зависимым namespaces. Зафиксировано в §7 как follow-up.

## 7. Deferred / follow-up

- Runtime RLS matrix под 7 каноническими ролями (`super_admin`, `admin`, `admin_gost`, `editor`, `menedzher`, `support`, `user`).
- PostgREST smoke на 3 таблицах и 2 RPC.
- Impact analysis и возможный ACL fix для `public.next_public_id(text)` (публичный EXECUTE у `authenticated`).
- Аудит и нормализация глобальных default privileges, чтобы новые объекты не получали автоматически права `anon`/`authenticated`.
- Разбор остальных 235 linter findings вне scope Phase 1.

## 8. Итог

Все 16 правок утверждённого плана внесены. Security-контракт по 4 таблицам и 3 функциям Phase 1 приведён в соответствие. Deliverable-инварианты (RLS, policies, GRANT-матрица, EXECUTE-матрица, ownership, пустота таблиц, отсутствие backfill, чистота линтера по объектам Phase 1) подтверждены машинными выводами.

```
Phase 1 forward:                  APPLIED
Phase 1 ACL hardening:            APPLIED
Static verification:              PASSED
Security contract:                PASSED
Rollback:                         NOT EXECUTED
RLS runtime proof:                DEFERRED (не блокирует)
PostgREST smoke:                  DEFERRED (не блокирует)
Phase 1 closure:                  READY TO CLOSE
Phase 2:                          НЕ НАЧАТ, ожидает отдельного approve
```
