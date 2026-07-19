да, согласен, с учетом правок:

1. **Исправить EXECUTE-матрицу RPC.**  
В плане ошибочно добавлен прямой `GRANT EXECUTE ... TO service_role`. Утверждённая матрица для двух Phase 1 RPC — `authenticated + guard has_role_v2`; `service_role` для этих скелетов не предусмотрен. Исходная forward-миграция также явно выдавала EXECUTE только `authenticated`.
  Corrective SQL должен быть:
  ```sql
  REVOKE ALL ON FUNCTION
    public.crm_company_get_or_create(text,text,text,text,text,uuid)
  FROM PUBLIC, anon, service_role;

  REVOKE ALL ON FUNCTION
    public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)
  FROM PUBLIC, anon, service_role;

  GRANT EXECUTE ON FUNCTION
    public.crm_company_get_or_create(text,text,text,text,text,uuid)
  TO authenticated;

  GRANT EXECUTE ON FUNCTION
    public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)
  TO authenticated;

  ```
  `authenticated` сохраняется, потому что доступ дополнительно ограничивается внутренним role guard.
2. **Не выдавать прямой EXECUTE на trigger function ни одной внешней роли.**  
Для `set_companies_public_id()` убрать `GRANT EXECUTE ... TO service_role`. Эта функция вызывается триггером и не является публичным RPC. В approved forward для неё отдельный GRANT отсутствовал.
  Требуется:
  ```sql
  REVOKE ALL ON FUNCTION public.set_companies_public_id()
  FROM PUBLIC, anon, authenticated, service_role;

  ```
  Владельцу функции права сохраняются. Прямой клиентский или service-role вызов не требуется.
3. **Зафиксировать точные ожидания `SECURITY DEFINER`.**
  В verification должно быть не общее «проверить `prosecdef`», а точная матрица:

  | Функция                          | `prosecdef` | `proconfig`          |
  | -------------------------------- | ----------- | -------------------- |
  | `set_companies_public_id()`      | `false`     | `search_path=public` |
  | `crm_company_get_or_create(...)` | `true`      | `search_path=public` |
  | `crm_company_link_contact(...)`  | `true`      | `search_path=public` |

  Trigger function создана без `SECURITY DEFINER`, а два RPC — с ним.
4. **Исправить диагностику ACL, чтобы она действительно показывала `PUBLIC`.**  
`information_schema.role_table_grants` может не дать полной картины для `PUBLIC` и ролей вне текущего enabled-role context. Нужна machine-check проверка через `aclexplode` либо дополнительно через `has_table_privilege` и `has_function_privilege`.
  После hardening обязательно приложить матрицу:
  ```sql
  SELECT role_name, object_name, privilege_name, has_privilege
  FROM (
    VALUES
      ('anon'), ('authenticated'), ('service_role')
  ) AS roles(role_name)
  CROSS JOIN (
    VALUES
      ('companies'),
      ('client_legal_details_company_map'),
      ('company_contacts'),
      ('company_sync_queue')
  ) AS objects(object_name)
  CROSS JOIN (
    VALUES
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
  ) AS privileges(privilege_name)
  CROSS JOIN LATERAL (
    SELECT has_table_privilege(
      role_name,
      format('public.%I', object_name),
      privilege_name
    )
  ) AS result(has_privilege);

  ```
  Для функций — аналогичная матрица через `has_function_privilege(..., 'EXECUTE')`. Проверку `PUBLIC` сделать отдельно через разбор `proacl`/`relacl` с `aclexplode`.
5. **Вернуть pre-apply контроль целостности corrective migration.**  
До применения:
  1. создать migration-файл;
  2. зафиксировать его в Git;
  3. указать полный commit SHA;
  4. вычислить SHA-256 файла;
  5. приложить diff, доказывающий, что внутри только `REVOKE`, `GRANT`, timeout и guards;
  6. применить именно этот файл;
  7. после применения повторно подтвердить тот же SHA-256.
  Сейчас план требует commit SHA только в итоговом отчёте, но не фиксирует неизменяемый артефакт до production execution.
6. **Добавить атомарность и timeout corrective migration.**
  Corrective migration должна содержать:
  ```sql
  SET LOCAL lock_timeout = '3s';
  SET LOCAL statement_timeout = '30s';

  ```
  и выполняться одной транзакцией через тот же подтверждённый атомарный механизм `supabase--migration`.
  Формулировку `без auto-rollback` исправить:
  - автоматический транзакционный rollback **обязателен**, если corrective migration падает;
  - запрещён только автоматический запуск сохранённого **Phase 1 rollback SQL**, удаляющего таблицы.
7. **Данные в таблицах не должны останавливать security hardening.**
  Текущий stop-guard опасен: если обнаружатся строки, план оставляет избыточные ACL открытыми.
  Правильный порядок:
  - зафиксировать counts и минимальные безопасные метаданные найденных строк;
  - не изменять и не удалять данные;
  - применить ACL hardening, поскольку он только сокращает доступ;
  - после hardening пометить Phase 1 closure как `BLOCKED` и представить отдельный incident/blocker report.
  Наличие данных блокирует **закрытие Phase 1**, но не блокирует отзыв лишних прав.
8. **Добавить внутренние guards перед REVOKE/GRANT.**
  В начале corrective migration проверить через `DO … RAISE EXCEPTION`:
  - существуют все четыре таблицы;
  - существуют три функции с точными identity arguments;
  - у четырёх таблиц включён RLS;
  - существуют ровно 13 ожидаемых policies;
  - определения `polqual`/`polwithcheck` не дрейфовали;
  - Phase 1 forward присутствует в migration history.
  При несовпадении — транзакция откатывается до изменения ACL.
9. **Post-commit linter нельзя “исправить в этой же миграции”.**
  После применения migration-файл неизменяем. Формулировку:
  > «либо PASSED, либо адресный fix в этой же миграции»
  заменить на:
  - если свежий post-commit linter показывает критическую проблему — остановить закрытие;
  - не изменять уже применённый migration-файл;
  - не запускать Phase 1 rollback;
  - представить blocker-отчёт;
  - подготовить отдельный план и отдельную corrective migration.
10. **Разделить ожидаемые ACL по объектам дословно.**

Итоговая матрица должна быть:


| Объект                             | PUBLIC | anon | authenticated               | service_role |
| ---------------------------------- | ------ | ---- | --------------------------- | ------------ |
| `companies`                        | none   | none | SELECT/INSERT/UPDATE/DELETE | ALL          |
| `client_legal_details_company_map` | none   | none | SELECT/INSERT/UPDATE/DELETE | ALL          |
| `company_contacts`                 | none   | none | SELECT/INSERT/UPDATE/DELETE | ALL          |
| `company_sync_queue`               | none   | none | none                        | ALL          |
| `crm_company_get_or_create`        | none   | none | EXECUTE                     | none         |
| `crm_company_link_contact`         | none   | none | EXECUTE                     | none         |
| `set_companies_public_id`          | none   | none | none                        | none         |


Права владельца объектов показываются отдельно и не считаются внешним grant.

11. **Generated types не должны содержательно измениться из-за ACL.**

ACL migration не меняет схему PostgREST-типов. Поэтому:

- нормальное ожидание — `src/integrations/supabase/types.ts` без изменений;
- если Lovable его перегенерировал, приложить diff;
- разрешены только технические/форматные изменения без новых таблиц, колонок, RPC или изменения сигнатур;
- любой содержательный schema diff — HARD STOP.

12. **Уточнить файловый и commit scope.**

Допустимы два последовательных commit:

1. corrective migration;
2. итоговый markdown-отчёт и, только при автоматической регенерации, `types.ts`.

Итоговый отчёт не обязан существовать до применения migration, поэтому требование «ровно три файла» нужно оценивать по совокупному diff спринта, а не требовать появления отчёта в pre-apply commit.

13. **Добавить отдельный контроль владельцев функций.**

В verification вывести `proowner` и подтвердить, что владельцем трёх функций не являются:

```text
anon
authenticated
service_role

```

Владелец должен быть доверенной migration/database ролью.

14. **Диагностировать, но не менять в этом патче `next_public_id`.**

`next_public_id(p_entity_type text)` — существующий `SECURITY DEFINER` helper, который теперь обслуживает namespace `company/CMP`.

В read-only proof добавить:

- `prosecdef`;
- `proconfig`;
- `proacl`;
- наличие прямых вызовов из клиентского кода/RPC.

Изменять его ACL в этом спринте запрещено без отдельного impact analysis, потому что он обслуживает и другие public ID namespaces. Возможный публичный EXECUTE зафиксировать в follow-up, не смешивая с текущими тремя функциями.

15. **Глобальные default privileges вынести в явный follow-up.**

Текущий патч корректно не должен менять глобальные default privileges. Но нужно записать отдельный deferred-пункт:

```text
Проверить и нормализовать default privileges для будущих таблиц и функций,
чтобы новые объекты автоматически не получали права anon/authenticated.
Отложено на отдельный security follow-up; текущий ACL hardening не блокирует.

```

16. **Добавить точные языковые требования из правил проекта.**

В конец плана включить дословно:

```text
План должен быть составлен на русском языке.
Отчет о выполненной работе должен быть составлен на русском языке.
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.

```

## Решение

План по сути правильный и решает обнаруженный ACL blocker, но **пока не готов к execution** из-за неверной EXECUTE-матрицы `service_role`, неполной ACL-диагностики и неоднозначного порядка обработки ошибок.

```text
План: СОГЛАСОВАН С УЧЕТОМ ПРАВОК 1–16
Corrective migration: DO NOT EXECUTE
Phase 1 rollback: НЕ ПРИМЕНЯТЬ
Phase 2: НЕ НАЧИНАТЬ

```

После внесения правок следующий проход — только статусы **«внесено / частично внесено / не внесено»**.

&nbsp;

План: CRM Companies — Phase 1 ACL hardening и финальная static verification

Статус: PLAN ONLY / DO NOT EXECUTE. Ожидается явный approve перед применением corrective migration.

## 1. Контекст и границы

Phase 1 forward-миграция уже APPLIED (commit `0abff5b`). Rollback не применяется. Настоящий план закрывает только два открытых пункта:

- Приведение ACL к утверждённому security-контракту (blocker).
- Полный набор доказательств static verification (deliverable).

Явные запреты:

- Не откатывать Phase 1.
- Не менять DDL таблиц, constraints, FK, индексы, RLS-политики, тела RPC/trigger-функций.
- Не запускать backfill, не создавать production-фикстуры.
- Не начинать Phase 2.
- Не менять глобальные default privileges проекта.
- Не трогать `.lovable/rollback/companies-phase1/phase1_rollback.sql`.

## 2. Read-only диагностика (перед corrective migration)

Собрать фактическое состояние ACL и зафиксировать в отчёте одним блоком:

Таблицы (`companies`, `client_legal_details_company_map`, `company_contacts`, `company_sync_queue`):

```
SELECT n.nspname, c.relname, c.relrowsecurity, c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('companies','client_legal_details_company_map','company_contacts','company_sync_queue');

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name IN ('companies','client_legal_details_company_map','company_contacts','company_sync_queue')
ORDER BY table_name, grantee, privilege_type;
```

Функции (`set_companies_public_id()`, `crm_company_get_or_create(text,text,text,text,text,uuid)`, `crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)`):

```
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('set_companies_public_id','crm_company_get_or_create','crm_company_link_contact');
```

В отчёте развернуть ACL по ролям отдельно: `PUBLIC`, `anon`, `authenticated`, `service_role`.

## 3. Corrective migration (одна, атомарная)

Файл: `supabase/migrations/<ts>_crm_companies_phase1_acl_hardening.sql`.

Содержит только REVOKE/GRANT, никакого DDL. Порядок:

1. Таблицы — сначала полный REVOKE у клиентских ролей, затем точечный GRANT:

```
REVOKE ALL ON public.companies, public.client_legal_details_company_map,
              public.company_contacts, public.company_sync_queue
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.companies,
  public.client_legal_details_company_map,
  public.company_contacts
TO authenticated;

GRANT ALL ON
  public.companies,
  public.client_legal_details_company_map,
  public.company_contacts,
  public.company_sync_queue
TO service_role;
-- company_sync_queue: НИКАКИХ прав anon/authenticated (в т.ч. SELECT).
```

2. Функции — REVOKE у PUBLIC/anon, GRANT согласно `companies_rpc_inventory.md §7`:

```
REVOKE ALL ON FUNCTION public.set_companies_public_id()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) TO authenticated, service_role;
-- set_companies_public_id() — trigger function, EXECUTE клиентским ролям не выдаётся;
-- оставляем только владельцу/service_role.
GRANT EXECUTE ON FUNCTION public.set_companies_public_id() TO service_role;
```

Global default privileges не трогаем.

## 4. Post-migration static verification (обязательный deliverable)

После применения приложить в отчёте фактические outputs (не галочки):

1. Git commit SHA corrective migration и список изменённых файлов (включая авто-обновление `src/integrations/supabase/types.ts`, если Lovable его перегенерирует).
2. Нормализованный diff runnable plan vs фактическая forward migration (для протокола, one-off).
3. Baseline schema hash до/после — должны совпасть с `c41160b83c8e15c3d3c41a13028700d5` по контракту (хэш считается по объектам вне ACL; ACL-изменения baseline не сдвигают — зафиксировать это отдельно).
4. `relrowsecurity=true` для всех 4 таблиц (вывод запроса из §2).
5. Полная таблица GRANT после hardening (PUBLIC/anon/authenticated/service_role × 4 таблицы).
6. Полная EXECUTE-матрица трёх функций с `prosecdef`, `proconfig`, `proacl`.
7. Все 13 policies: `polname`, `polcmd`, `polroles`, `pg_get_expr(polqual)`, `pg_get_expr(polwithcheck)`.
8. Подтверждение пустоты таблиц: `SELECT count(*)` по 4 таблицам = 0.
9. Подтверждение отсутствия backfill/фикстур (нет INSERT в 4 таблицы и в `company_sync_queue`).
10. Записи из `supabase_migrations.schema_migrations` для обеих миграций (forward + hardening).
11. Свежий post-commit `supabase--linter` с явным разбором находок по 4 таблицам и 3 функциям (RLS-without-policy, mutable search_path, SECURITY DEFINER public EXECUTE) — либо PASSED, либо адресный fix в этой же миграции.

## 5. Файловый scope (жёсткий)

Разрешено ровно:

- `supabase/migrations/<ts>_crm_companies_phase1_acl_hardening.sql` — corrective migration.
- `.lovable/reports/companies-phase1/phase1-acl-hardening-report.md` — итоговый отчёт.
- `src/integrations/supabase/types.ts` — только если Lovable перегенерирует автоматически; изменение отдельно указывается в отчёте и не редактируется вручную.

Запрещено любое иное изменение файлов, UI, edge functions, `config.toml`.

## 6. Stop-guards

Немедленная остановка (без auto-rollback) при:

- Расхождении baseline schema hash по non-ACL объектам.
- Обнаружении данных в любой из 4 таблиц.
- Присутствии grants на `company_sync_queue` для anon/authenticated после hardening.
- Присутствии EXECUTE у PUBLIC/anon на любой из 3 функций после hardening.
- Изменении polqual/polwithcheck хотя бы одной из 13 policies относительно forward-миграции.

При срабатывании — blocker-отчёт, без Phase 2, без применения rollback.

## 7. Итоговый отчёт

Заголовок дословно:
`Отчет о выполненной работе: CRM Companies — Phase 1 ACL hardening и финальная static verification`

Язык — русский. Deferred: runtime RLS matrix под 7 каноническими ролями и PostgREST smoke — фиксируются в follow-up и не блокируют закрытие Phase 1 после успешного hardening.