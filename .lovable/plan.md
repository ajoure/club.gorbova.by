# да, согласен, с учетом правок:

Проверен загруженный план Phase 2. Архитектурные границы в целом соблюдены: Phase 2 ограничена RPC-слоем, `search_global` и ADR-0002; backfill, worker, UI и интеграционные FK вынесены в следующие фазы. Это соответствует утверждённой phase matrix.

## Критические правки

### 1. Исправить обязательный заголовок отчёта

В §14 сейчас указано:

```text
Отчет о выполнении:

```

По правилам проекта должно быть дословно:

```text
Отчет о выполненной работе: CRM Companies — Phase 2 discovery и runnable plan

```

### 2. Разрешить неопределённость компаний без УНП

`crm_company_get_or_create` заявлен идемпотентным по:

```text
(country, unp_normalized)

```

Но таблица допускает `unp_normalized IS NULL`, а `company_kind` содержит `foreign | unknown`. При `NULL` повторные вызовы смогут создавать дубликаты.

В Phase 2 нужно принять один точный контракт:

```text
crm_company_get_or_create поддерживает только
company_kind IN ('legal_entity','entrepreneur')
и требует непустой нормализованный УНП.

```

Ручное создание `foreign/unknown` без УНП — отдельный Phase 7 RPC или отдельное решение с другим устойчивым ключом.

Нельзя использовать `full_name` как скрытый natural key.

### 3. Зафиксировать контракт `_source`

Для `crm_company_get_or_create` определить допустимые значения `_source`, например:

```text
manual
billing_requisites
backfill

```

И правила:


| `_source`            | `*source*client_legal_details_id`                  |
| -------------------- | -------------------------------------------------- |
| `manual`             | обязан быть `NULL`                                 |
| `billing_requisites` | обязателен, строка должна быть `purpose='billing'` |
| `backfill`           | обязателен, те же billing-guards                   |


Неизвестный `_source` → ошибка.

Также определить, какие activity/event/audit записи создаются для каждого source.

### 4. Добавить concurrency-safe алгоритм get-or-create

Одной проверки `SELECT → INSERT` недостаточно: два параллельных вызова могут столкнуться на unique index.

План должен содержать конкретный алгоритм:

```sql
INSERT ...
ON CONFLICT (country, unp_normalized)
WHERE unp_normalized IS NOT NULL AND status <> 'merged'
DO NOTHING
RETURNING id;

```

Затем повторный `SELECT`.

Если PostgreSQL не принимает conflict inference для partial unique index в требуемой форме, использовать:

- advisory transaction lock по нормализованному `(country, unp)`; либо
- обработку `unique_violation` с повторным чтением.

Фраза «идемпотентен» без race-proof недостаточна.

### 5. Не вызывать guarded RPC из service-role RPC напрямую

`crm_company_upsert_from_billing` имеет `service_role only`, а `crm_company_get_or_create` проверяет:

```text
super_admin | admin | menedzher

```

Если billing RPC вызовет get-or-create напрямую, `auth.uid()` для service-role может быть `NULL`, и явный role guard вернёт `forbidden`. `SECURITY DEFINER` не отменяет написанную внутри функции проверку.

Нужно выбрать и описать один вариант:

1. private internal helper без внешнего EXECUTE, используемый обоими RPC; либо
2. отдельная concurrency-safe реализация resolve/create внутри billing RPC.

Предпочтительно:

```text
crm_company_resolve_or_create_internal(...)

```

- не является публичным API;
- EXECUTE отсутствует у `PUBLIC`, `anon`, `authenticated`, `service_role`;
- вызывается только функциями-владельцами;
- включается в migration, verification и rollback.

При добавлении helper число новых функций и rollback-список нужно обновить.

### 6. Сделать `crm_company_link_contact` race-safe

Требуется конкретный `INSERT ... ON CONFLICT` алгоритм по:

```text
(company_id, profile_id, relationship_type)

```

При конфликте:

- `is_billing_contact` объединяется через OR;
- `is_primary` не понижается;
- валидная billing lineage не теряется;
- существующий `source_client_legal_details_map_id` не заменяется произвольным map;
- повторный вызов без фактического изменения не создаёт событие.

### 7. Усилить merge-контракт

Добавить:

- разрешение source через цепочку `merged_into_company_id`;
- запрет циклов;
- блокировку source и target в детерминированном порядке;
- блокировку переносимых map/contact rows;
- проверку, что `merged_into_company_id` target не ведёт обратно к source;
- точное правило объединения `metadata`;
- точное правило выбора billing lineage при конфликте;
- событие и audit только при первом фактическом merge.

Повторный merge уже merged source в тот же canonical target должен возвращать target UUID без повторных событий.

### 8. Определить дедупликацию `crm_company_grp_refetch`

Сейчас не указан `idempotency_key`, а постоянный ключ вида:

```text
company:{id}:grp_refetch

```

навсегда заблокирует повторный refetch после `done`.

Без новой таблицы/индекса нужно использовать:

1. advisory transaction lock по `company_id`;
2. поиск существующей строки `status IN ('queued','running')`;
3. если есть — вернуть её UUID;
4. если нет — создать новую строку с уникальным ключом, включающим request UUID или timestamp.

Точный формат ключа должен быть указан в runnable-плане.

### 9. Добавить строгую валидацию `_filters`

Для `search_companies` определить:

- неизвестные ключи: ошибка либо игнорирование — выбрать одно;
- `limit`: `1..100`;
- `offset >= 0`;
- whitelist `sort_by`;
- `sort_dir IN ('asc','desc')`;
- допустимые значения `status[]` и `company_kind[]`;
- пустые строки нормализуются в `NULL`;
- `profile_id` фильтруется через `EXISTS`, чтобы не дублировать компании.

Если используется dynamic SQL, identifiers должны выбираться только из whitelist. Значения — только bind/PLpgSQL variables.

### 10. Зафиксировать event idempotency

Недостаточно правила «повтор не создаёт дубликаты». Для каждого state-changing RPC указать:

```text
event_type
entity_id
idempotency_key
payload version
условие создания

```

Например:


| Операция       | Событие создаётся                                         |
| -------------- | --------------------------------------------------------- |
| get-or-create  | только при INSERT новой компании                          |
| billing upsert | только при фактическом изменении canonical полей/snapshot |
| link contact   | только при создании или материальном изменении связи      |
| merge          | только при первом merge                                   |
| archive        | только при переходе `active → archived`                   |
| GRP refetch    | только при создании нового queue job                      |


Writer-контракты должны быть выведены из фактических схем `crm_activity_log`, `domain_events` и `audit_logs`, как уже предусмотрено discovery-разделом. Архитектурный freeze закрепляет раздельное назначение этих таблиц.

### 11. Исправить последовательность runtime proof

Сейчас логика противоречива:

- функции появляются только после применения migration;
- но при невозможности proof предлагается migration не применять.

Нужно выбрать исполнимую последовательность:

```text
1. Preflight.
2. Commit migration.
3. Отдельная транзакция runtime proof.
4. Все тестовые DML → ROLLBACK всей proof-транзакции.
5. Отдельное read-only подтверждение отсутствия fixtures.

```

Если post-commit runtime proof не прошёл:

- Phase 2 closure блокируется;
- Phase 3 не начинается;
- применённая migration не редактируется;
- автоматический Phase 2 rollback не запускается;
- формируется blocker-отчёт и отдельное решение на corrective migration или rollback.

Формулировку:

```text
Phase 2 migration не применяется

```

заменить на этот порядок.

Альтернатива допустима только при доказанной возможности выполнить migration и proof внутри одной внешней транзакции до COMMIT.

### 12. Migration history не должна быть недостижимым hard stop

В Lovable Cloud ранее чтение:

```text
supabase_migrations.schema_migrations

```

возвращало `permission denied`.

Поэтому обязательны до execution:

- commit SHA;
- SHA-256 migration;
- exact filename;
- нормализованный diff.

Migration history после применения:

```text
VERIFIED

```

либо честно:

```text
NOT VERIFIED — permission denied

```

Сам по себе запрет чтения системной таблицы не блокирует execution, если применение подтверждено инструментом и post-migration catalog state.

### 13. Уточнить archive idempotency

Для уже архивированной компании определить:

- тот же reason → вернуть company UUID без новых audit/event;
- другой reason → либо ошибка, либо отдельная admin-update операция.

Нельзя молча перезаписывать первоначальную причину архивирования.

### 14. ADR-0002 не должен необоснованно блокировать весь RPC core

Если discovery покажет, что `integration_field_mappings` недостаточно для external company IDs:

- external-ID часть ADR получает статус `BLOCKED / NEEDS SEPARATE DDL APPROVAL`;
- никакой `external_ids` DDL не добавляется;
- core RPC Phase 2 может оставаться исполнимым, поскольку перечисленные RPC не требуют внешних ID.

Останавливать весь Phase 2 нужно только если конкретный RPC действительно зависит от нерешённого external mapping.

### 15. Полный SQL должен включать helper-функции и их rollback

Если для нормализации, shared create logic, event writing или merge понадобится private helper, runnable-план обязан перечислить:

- имя;
- сигнатуру;
- owner;
- `SECURITY DEFINER/INVOKER`;
- `search_path`;
- ACL;
- dependency graph;
- порядок DROP в rollback.

Нельзя спрятать дополнительные функции внутри формулировки «полный SQL».

## Некритичные правки

### 16. Уточнить metadata snapshot

В `billing_snapshot` хранить уже нормализованные значения, а обновление snapshot и target выполнять в одной транзакции.

Также фиксировать:

```json
{
  "last_billing_client_legal_details_id": "uuid",
  "last_billing_synced_at": "timestamptz",
  "last_billing_source_updated_at": "timestamptz"
}

```

Это позволит отличить повторный sync от более старого события и не применять stale billing row.

### 17. Тестовую учётную запись использовать только для authenticated RPC

`[1@ajoure.by](mailto:1@ajoure.by)` применяется для:

- admin-guard;
- authenticated RPC;
- runtime RLS proof.

`crm_company_upsert_from_billing` проверяется отдельно под `service_role`, без подмены admin JWT.

Требование использовать выделенную тестовую админ-учётку для UI/runtime proof сохраняется; пароль не хранить и не передавать.

## Решение

```text
План Phase 2: СОГЛАСОВАН С УЧЁТОМ ПРАВОК 1–17
Создание двух DRAFT-документов: РАЗРЕШЕНО
Read-only discovery: РАЗРЕШЕНО
Миграции и изменение RPC: DO NOT EXECUTE
Phase 2 production execution: NOT APPROVED

```

Lovable должен создать только два заявленных DRAFT-файла. После этого следующая проверка будет по статусам **«внесено / частично внесено / не внесено»** для правок 1–17.

План: CRM Companies — Phase 2 Canonical RPC Layer и ADR-0002

**Статус:** `PLAN ONLY / READ-ONLY / DO NOT EXECUTE`.

Этот план описывает подготовку двух DRAFT-документов Phase 2. Миграции, SQL-функции, UI, edge functions, `.lovable/plan.md` и данные production в рамках этого этапа не изменяются.

## 1. Базовая точка

```text
Repository:              ajoure/club.gorbova.by
Phase 1 closure commit:  ab2d4b05321938c01cf7ada07dda40c9a3e7de86
Database ref:            hdjgkjceownmmnrqqtuz
Phase 1:                 CLOSED
Baseline schema hash:    c41160b83c8e15c3d3c41a13028700d5
```

Не пересматривается:

- `companies` — самостоятельная canonical CRM-сущность;
- `client_legal_details` — compatibility SoT, остаётся writable;
- автоматический источник — только `purpose='billing'` и `client_type IN ('legal_entity','entrepreneur')`;
- доступы, entitlements и Telegram связаны только с `profile_id`;
- `company_contact_person_map` в Phase 2 не входит.

## 2. Единственный разрешённый результат этапа

Создаются ровно два файла:

```text
.lovable/discovery/companies-1.0/adr-0002-company-external-ids.md
.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md
```

Оба документа помечаются:

```text
Status: DRAFT / NOT APPROVED / DO NOT EXECUTE
```

Запрещено изменять: `supabase/migrations/**`, существующие RPC, таблицы и данные, `.lovable/plan.md`, `src/**`, `supabase/functions/**`, `supabase/config.toml`. Любой другой diff — HARD STOP.

## 3. Read-only discovery (только SELECT, фактические outputs в документе)

### 3.1 Состояние Phase 1

- 4 таблицы существуют, `relrowsecurity=true`, 13 policies без дрейфа;
- ACL совпадает с закрытым Phase 1;
- таблицы пусты;
- в `public_id_sequences` есть строка `(company, CMP, 0)`;
- Phase 1 функции сохранили сигнатуры и ACL;
- повторный baseline hash = `c41160b83c8e15c3d3c41a13028700d5`.

Любой дрейф — HARD STOP.

### 3.2 Точные определения объектов

Собрать `pg_get_functiondef`, identity args, return type, owner, `prosecdef`, `proconfig`, `proacl` для:

```text
crm_company_get_or_create
crm_company_link_contact
search_global
has_role_v2
next_public_id
```

Для `search_global` дополнительно сохранить SHA-256 нормализованного текста pre-Phase-2 definition (нужен для rollback).

### 3.3 Проектные паттерны RPC

Изучить реальные определения `search_global`, `search_deal_rows`, `crm_task_list`, `crm_task_create`, `crm_task_apply_automation` и зафиксировать стандарт: `RETURNS TABLE` vs `jsonb`, пагинация, `items/total`, sort, лимиты, пустые фильтры, authorization guard, формат ошибок. Return-контракт `search_companies` формулируется только после этого шага.

### 3.4 Таблицы событий и аудита

Получить фактические схемы, constraints, обязательные поля и примеры writer-функций для:

```text
crm_activity_log
domain_events
domain_executions
audit_logs
```

### 3.5 Billing mapping

На основе точной схемы `client_legal_details` составить machine-checkable таблицу:

```text
client_type | source column | target companies column | normalization | nullable behaviour | ownership rule
```

Определить источники: УНП (ЮЛ и ИП), полное наименование, адрес, email/phone, руководитель, основание полномочий, банковские реквизиты, GRP-поля. `purpose='document'` не используется.

### 3.6 Тестовая учётная запись

Read-only подтвердить, что `1@ajoure.by` существует в `auth.users`, связана с `profiles` и имеет роль `admin` в `user_roles_v2`. Пароль не читается и не сохраняется.

## 4. ADR-0002 — external company IDs

Discovery: точная схема `integration_field_mappings`, unique-ограничения, индексы, provider/entity-type значения, writers/readers, AmoCRM/GetCourse/ManyChat mappings, возможность детерминированно связать внешний company ID с `companies.id`, наличие workspace/provider scope, поведение при merge.

Рекомендуемое решение (если нет blocker):

```text
ADR-0002: external IDs продолжают храниться в integration_field_mappings.
Колонка external_ids в companies не добавляется.
```

Если контракт не покрыт — ADR описывает альтернативы, но никакой DDL в Phase 2 без отдельного approve ADR не выполняется.

## 5. RPC Phase 2

Runnable-план содержит полный SQL, точные сигнатуры, ACL, guards, транзакционную логику и rollback для всех перечисленных RPC.

### 5.1 `crm_company_get_or_create` (полная реализация, сигнатура Phase 1 не меняется)

Нормализация `country` и УНП; поиск только по canonical `(country, unp_normalized)`; переход к `merged_into_company_id` при legacy merged ID; запрет использовать merged company как самостоятельную; создание только при отсутствии canonical строки; `CMP-*` через существующий trigger; идемпотентность; запрет explicit `public_id`. Guard: `super_admin | admin | menedzher`. EXECUTE: только `authenticated`; service_role напрямую не получает.

### 5.2 `crm_company_link_contact` (полная реализация, сигнатура Phase 1 не меняется)

`profile_id` обязателен (external contacts — Phase 9); компания должна существовать и не быть merged; идемпотентность по `(company_id, profile_id, relationship_type)`; `is_billing_contact=true` требует `source='billing_requisites'` и валидного `source_client_legal_details_map_id`, привязанного к той же компании; billing-флаг нельзя автоматически понижать `true→false`. Guard: `super_admin | admin | menedzher`. EXECUTE: только `authenticated`.

### 5.3 `crm_company_upsert_from_billing(_client_legal_details_id uuid)`

EXECUTE только `service_role`. Проверка `purpose='billing'` и `client_type IN ('legal_entity','entrepreneur')`; нормализованный УНП обязателен; создаёт или обновляет только `companies`; map и `company_contacts` не создаёт (Phase 3); `purpose='document'` не читает; `client_legal_details` не изменяет; идемпотентен.

### 5.4 Field ownership (единый metadata-контракт, без новой таблицы)

```json
{
  "company_sync": {
    "billing_snapshot": {},
    "last_billing_client_legal_details_id": null,
    "last_billing_synced_at": null
  }
}
```

Алгоритм для mutable billing-полей:

1. `target IS NULL` → записать billing value.
2. target равен предыдущему `billing_snapshot[field]` → обновить новым billing value.
3. Иначе → admin/import override: target не перезаписывать, snapshot обновить, conflict записать в `crm_activity_log`.
4. `country`, `unp_normalized`, `company_kind` задаются только при создании.
5. `grp_*` этот RPC не изменяет.

### 5.5 `search_companies(_filters jsonb)`

Return type фиксируется после §3.3. Минимальный фильтр-контракт:

```text
q, status[], company_kind[], country, profile_id, include_merged, limit, offset, sort_by, sort_dir
```

Поиск: `public_id`, `full_name`, `short_name`, `unp_normalized`, `email`, `phone`. Merged исключены по умолчанию; hard cap `limit ≤ 100`; банковские реквизиты не возвращаются. Read guard: `super_admin | admin | menedzher | support`; deny — `admin_gost | editor | user`. EXECUTE: только `authenticated`.

### 5.6 `crm_company_merge(_source_id uuid, _target_id uuid)`

Guard: `super_admin | admin`. Запрет `source=target`; блокировка `FOR UPDATE` в детерминированном порядке UUID; одинаковый `workspace_id`; target не может быть `merged`; повторный merge в тот же target — идемпотентен, в другой — ошибка. Переносятся `client_legal_details_company_map` и `company_contacts`; конфликты unique-link разрешаются детерминированно (target-link сохраняется, `is_billing_contact`/`is_primary` — OR, valid billing lineage приоритет, source link удаляется после переноса metadata). Target field-ы автоматически не переписываются полями source. Source: `status='merged'`, `merged_into_company_id=target`, merge metadata с actor/time. Hard delete запрещён.

### 5.7 `crm_company_archive(_id uuid, _reason text)`

Guard: `super_admin | admin`. Reason обязателен; merged архивировать нельзя; идемпотентно; `status='archived'`, `archived_at=now()`; reason и actor — в metadata/audit; связи не удаляются.

### 5.8 `crm_company_grp_refetch(_id uuid)`

Phase 2 HTTP-вызов GRP не выполняет. Guard: `super_admin | admin | menedzher`. Проверяет active company; через SECURITY DEFINER создаёт или переиспользует pending `company_sync_queue` с `run_reason='grp_refetch'`; при существующем `queued/running` — возвращает тот же UUID. Worker — Phase 4.

## 6. `search_global` — additive branch `company`

Сигнатура и return type не меняются; существующие branches семантически идентичны; company branch виден только read-ролям (`super_admin | admin | menedzher | support`); возвращает UUID, `CMP-*`, full name, УНП/short name и entity marker; merged rows скрыты; ACL/owner/`SECURITY DEFINER` сохраняются. К плану прикладывается нормализованный diff старого и нового definition; rollback восстанавливает exact pre-Phase-2 body. Универсальный `search_entities` создавать запрещено.

## 7. Activity, events и audit

После §3.4 фиксируется точная event matrix. Минимальный набор:

```text
company.created.v1
company.upserted_from_billing.v1
company.linked_to_contact.v1
company.merged.v1
company.archived.v1
company.grp_refetch_requested.v1
```

Правила: события пишутся только при фактическом state change; идемпотентный повтор дубликатов не создаёт; `entity_id` — UUID canonical company; admin create/merge/archive → `audit_logs`; billing auto-sync в audit не пишется; activity использует `source_entity_type='company'`; backfill-события в Phase 2 отсутствуют.

## 8. Security

Все RPC:

```text
SECURITY DEFINER
SET search_path = public
owner = trusted migration role
PUBLIC EXECUTE = none
anon   EXECUTE = none
```


| RPC                               | authenticated | service_role |
| --------------------------------- | ------------- | ------------ |
| `crm_company_get_or_create`       | EXECUTE       | none         |
| `crm_company_link_contact`        | EXECUTE       | none         |
| `search_companies`                | EXECUTE       | none         |
| `crm_company_merge`               | EXECUTE       | none         |
| `crm_company_archive`             | EXECUTE       | none         |
| `crm_company_grp_refetch`         | EXECUTE       | none         |
| `crm_company_upsert_from_billing` | none          | EXECUTE      |


Роли: read — `super_admin, admin, menedzher, support`; write/link/create — `super_admin, admin, menedzher`; archive/merge — `super_admin, admin`; deny — `admin_gost, editor, user`. Global default privileges не меняются.

## 9. Миграционная стратегия

Одна атомарная миграция:

```text
supabase/migrations/<ts>_crm_companies_phase2_rpc_layer.sql
```

До применения: отдельный commit, SHA-256 файла, нормализованный diff, подтверждение файлового scope, отдельный execution approve.

Внутри миграции:

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
```

Порядок: `DO … RAISE EXCEPTION` guards → `CREATE OR REPLACE` двух skeleton RPC → создание пяти новых RPC → replacement `search_global` последним.

## 10. Runtime proof (транзакционно, без постоянных фикстур)

Один транзакционный proof с `SAVEPOINT`; идентичность `1@ajoure.by` подставляется через JWT-context/UUID без пароля.

Проверяется:

- manual create; повторный get-or-create; автоматический `CMP-*`;
- link contact и повторный link;
- rejection невалидного billing lineage;
- billing upsert create/update/idempotency; admin override preservation;
- search filters/pagination; support read; support write deny; `admin_gost` deny;
- archive; merge с конфликтующими links; GRP queue deduplication;
- additive company branch в `search_global`;
- ACL service-role/authenticated.

Далее `ROLLBACK TO SAVEPOINT` и подтверждение: 4 Phase 1 таблицы пусты, `public_id_sequences.last_value` вернулся к исходному, тестовые строки activity/events/audit/queue отсутствуют, production fixtures не сохранились.

Если транзакционный proof невозможен — статус `RUNTIME PROOF BLOCKED`; Phase 2 migration не применяется до отдельного решения (для Phase 2 static proof недостаточен).

## 11. Rollback

```text
.lovable/rollback/companies-phase2/phase2_rpc_rollback.sql
```

Rollback: восстанавливает exact Phase 1 skeleton body `crm_company_get_or_create` и `crm_company_link_contact`; удаляет пять новых Phase 2 RPC; восстанавливает exact pre-Phase-2 `search_global` (по SHA §3.2); восстанавливает прежние ACL; таблицы и данные не изменяет; `CASCADE` не использует. Не выполняется без отдельного решения.

## 12. Stop-guards

Немедленная остановка при любом из:

- дрейф Phase 1 schema/ACL/policies;
- неожиданные данные в 4 таблицах;
- отличия skeleton signatures;
- невозможно получить exact definition `search_global`;
- отсутствует тестовая admin-учётка;
- billing mapping неоднозначен;
- ownership algorithm требует изменения frozen schema;
- ADR-0002 требует новый DDL;
- runtime proof нельзя выполнить транзакционно;
- diff затрагивает UI, edge functions, backfill, worker или таблицы;
- migration history или SHA не фиксируются до исполнения.

## 13. Явно вне Phase 2

Backfill; trigger на `client_legal_details`; `company-sync-worker`; cron; `orders_v2.company_id`; `crm_tasks.company_id`; UI `/admin/companies`; feature flag; admin section/resource inserts; CSV/Amo import canonical companies; documents compatibility; hierarchy; `company_contact_person_map`; изменение global default privileges.

## 14. Deliverable

По завершении этапа Lovable возвращает сообщение «Отчет о выполнении:» и сохраняет два DRAFT-документа:

```text
.lovable/discovery/companies-1.0/adr-0002-company-external-ids.md
.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md
```

Runnable-план содержит: все read-only outputs; точные RPC signatures и return types; полный SQL migration; полный rollback SQL; ACL matrix; source-to-target billing mapping; ownership algorithm; event/audit contracts; runtime proof SQL; verification SQL; SHA/diff workflow; файловый scope; stop-guards; DoD.

## 15. Definition of Done этапа

- Созданы ровно два файла §2 со статусом DRAFT.
- Никаких изменений в БД, миграциях, RPC, UI, edge functions, `.lovable/plan.md`, `supabase/config.toml`.
- Все утверждения о текущем состоянии подкреплены фактическими read-only outputs.
- ADR-0002 либо подтверждает переиспользование `integration_field_mappings`, либо перечисляет альтернативы без DDL.
- Runnable-план содержит полный migration SQL и полный rollback SQL без применения.
- Phase 2 миграция не запускается до отдельного согласования.

Вся переписка, пояснения и результаты — только на русском языке.