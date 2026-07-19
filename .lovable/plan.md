# да, согласен, с учетом правок:

1. Заголовок итогового отчёта должен быть дословно:

```text
Отчет о выполненной работе: CRM Companies — Phase 2 runnable SQL финальная материализация

```

Не использовать `Отчет о выполнении`.

2. В §3.1 заменить вымышленный перечень полей на фактическую схему `public.companies`.

В таблице существуют:

```text
company_kind
country
unp_normalized
full_name
short_name
legal_form
legal_address
legal_address_structured
email
phone
director_name
director_position
acts_on_basis
bank_account
bank_name
bank_code
status
merged_into_company_id
archived_at
grp_*
metadata
created_by
updated_by

```

Полей `display_name`, `legal_name`, `registration_country`, `address_*`, `bank_*`, `contact_*`, `archived_reason` в таблице нет. Их использование — `HARD STOP`.

3. Billing mapping брать только из уже зафиксированного §4:

```text
set-once:
- country
- unp_normalized
- company_kind

mutable через ownership snapshot:
- full_name
- short_name
- legal_form
- legal_address
- director_name
- director_position
- acts_on_basis
- bank_account
- bank_name
- bank_code
- email
- phone

```

`legal_address_structured` и `grp_*` Phase 2 billing RPC не пишет.

4. Удалить требование:

```sql
INSERT ... ON CONFLICT (country, unp_normalized) DO UPDATE

```

из `crm_company_upsert_from_billing`.

Утверждённый алгоритм остаётся:

```text
1. SELECT client_legal_details FOR UPDATE.
2. Валидация purpose/client_type/УНП.
3. _crm_company_resolve_or_create_internal(...).
4. SELECT companies FOR UPDATE.
5. Stale guard по last_billing_source_updated_at.
6. Явные ownership-блоки mutable-полей.
7. Единый UPDATE companies.
8. Activity/event только при материальном изменении.

```

Повторный UPSERT через `ON CONFLICT` обходит утверждённый helper и смешивает create-логику с ownership-логикой.

5. Для nullable billing-полей зафиксировать единое правило:

```text
Нормализованное входное значение NULL:
- target не очищать;
- billing_snapshot[field] не менять;
- conflict не создавать;
- поле не включать в changed_fields.

```

Это и есть `last non-null wins`. Иначе запись `NULL` в snapshot ошибочно превратит следующее billing-обновление в admin override.

6. `country`, `unp_normalized`, `company_kind` запрещено включать в mutable ownership-блоки. Они задаются только при создании canonical company.
7. В §3.2 исправить merge-финализацию.

Запрещено:

```sql
status = 'archived'
archived_reason = ...

```

Canonical source после merge должен получить:

```sql
status = 'merged',
merged_into_company_id = v_target_leaf

```

с merge-данными в `metadata`. Именно такой контракт уже зафиксирован в §7.6.

8. `crm_company_merge` возвращает `uuid` canonical target, а не «структуру результата». Return type менять нельзя:

```text
RETURNS uuid
RETURN v_target_leaf

```

Статистика перенесённых строк остаётся в event payload.

9. Не использовать конструкцию:

```text
UPDATE ... ON CONFLICT

```

PostgreSQL не поддерживает `ON CONFLICT` для `UPDATE`.

Для `company_contacts` сохранить детерминированный row-by-row алгоритм:

```text
- блокировка source/target rows;
- поиск target-конфликта;
- при отсутствии — UPDATE company_id;
- при наличии — объединение флагов, lineage, source и metadata;
- DELETE source contact только после успешного объединения.

```

Текущий контракт уже описывает этот порядок.

10. Для `client_legal_details_company_map` не проектировать conflict handling.

Unique constraint находится на:

```text
client_legal_details_id

```

а не на `(company_id, client_legal_details_id)`. Простое изменение `company_id` не создаёт конфликтов этого unique constraint.

Нужен обычный заблокированный:

```sql
UPDATE public.client_legal_details_company_map
SET company_id = v_target_leaf, ...
WHERE company_id = _source_id;

```

11. Не добавлять `*crm*jsonb_deep_merge` в этом patch.

Утверждённая модель metadata merge:

```sql
COALESCE(source.metadata, '{}'::jsonb)
||
COALESCE(target.metadata, '{}'::jsonb)

```

Target имеет приоритет на совпадающих top-level ключах. Новый deep-merge helper изменит архитектуру с `2 private helper` на `3 private helper`, ACL matrix, dependency graph, forward count и rollback.

12. Forward SQL должен иметь следующий dependency order:

```text
1. BEGIN / timeouts / preflight.
2. _crm_company_emit_domain_event.
3. _crm_company_resolve_or_create_internal.
4. Семь public RPC.
5. Полный search_global replacement.
6. REVOKE/GRANT.
7. Post-apply guards.
8. COMMIT.

```

Emit-helper обязан создаваться раньше resolve-helper и всех RPC, которые его вызывают.

13. В rollback не выполнять:

```sql
DROP FUNCTION public.search_global(...)

```

`search_global` — существующий production RPC. Его нужно восстановить через один exact:

```sql
CREATE OR REPLACE FUNCTION public.search_global(...)

```

с pre-Phase-2 body и прежним ACL. DROP создаёт лишнее окно отсутствия объекта и риск зависимостей.

14. В rollback не удалять два Phase 1 RPC:

```text
crm_company_get_or_create
crm_company_link_contact

```

Их нужно восстановить через `CREATE OR REPLACE` с exact Phase 1 skeleton bodies.

Rollback удаляет только:

```text
5 новых public RPC:
- crm_company_upsert_from_billing
- search_companies
- crm_company_merge
- crm_company_archive
- crm_company_grp_refetch

2 private helper:
- _crm_company_resolve_or_create_internal
- _crm_company_emit_domain_event

```

Ожидаемое число `DROP FUNCTION` в canonical rollback SQL — **7, не 10**.

15. Rollback definition count должен проверяться отдельно:

```text
CREATE OR REPLACE:
- crm_company_get_or_create skeleton
- crm_company_link_contact skeleton
- search_global pre-Phase-2 body

Итого: 3

```

Не требовать симметричные `10 DROP`, поскольку Phase 1 RPC и `search_global` существовали до Phase 2.

16. Forward count при отсутствии новых helpers:

```text
7 public RPC
2 private helper
1 search_global
= 10 CREATE OR REPLACE FUNCTION

```

Если фактический count отличается — `HARD STOP`.

17. Проверку event helper считать по точным паттернам, а не по общему количеству упоминаний имени:

```text
PERFORM public._crm_company_emit_domain_event(

```

Ожидание в caller bodies — **ровно 7**.

Дополнительно:

```text
CREATE OR REPLACE FUNCTION public._crm_company_emit_domain_event

```

— ровно 1;

```text
INSERT INTO public.domain_events

```

в canonical forward SQL — ровно 1 и только внутри тела emit-helper;

```text
ON CONFLICT ((payload->>'idempotency_key'))

```

— 0.

Общее число `14` нестабильно из-за ACL, описаний и rollback-сигнатур и не должно быть критерием приёмки.

18. Сделать §11 и §12 единственными canonical executable blocks:

```text
PHASE2_FORWARD_SQL_BEGIN
```sql
...

```

PHASE2_FORWARD_SQL_END

PHASE2_ROLLBACK_SQL_BEGIN

```sql
...

```

PHASE2_ROLLBACK_SQL_END

```

Внутри каждого canonical block не должно быть markdown-прозы между SQL statements. Пояснения размещать до или после блока.

19. Placeholder scan ограничивать canonical SQL blocks, а не всем текстом §11/§12. В описательной части допустимы ссылки вида `см. §`.

В scan добавить оба варианта многоточия:

```text
...
…

```

и паттерны:

```text
сокращено
см. body
см. helpers
при финализации
в фактической миграции
аналогично
остальные поля
TODO
FIXME
<...>
{{...}}
TBD

```

20. Copy-paste checklist в итоговом документе должен быть отмечен как выполненный:

```text
- [x]

```

Наличие `[ ]` означает, что runnable SQL ещё не финализирован.

21. Полный `search_global` forward body должен содержать:

- exact исходные `contacts/deals/messages`;
- новое объявление `v_companies jsonb`;
- additive company query;
- company role guard;
- итоговый ключ `'companies', v_companies`;
- прежние signature, owner, `SECURITY DEFINER`, `search_path` и ACL.

Rollback должен содержать exact pre-Phase-2 body без company branch.

22. Перед статусом `FINALIZED` добавить статический schema-whitelist check:

```text
Все упомянутые в SQL колонки companies,
company_contacts,
client_legal_details_company_map,
company_sync_queue,
client_legal_details
сверены с фактическим discovery output.
Неизвестных колонок: 0.

```

23. В конец плана добавить дословно:

```text
План должен быть составлен на русском языке.
Отчет о выполненной работе должен быть составлен на русском языке.
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.

```

```text
Documentation-only patch: APPROVED
Разрешённый файл: companies_phase2_runnable_plan.md
Database changes: PROHIBITED
Migration files: PROHIBITED
Admin fixture blocker: СОХРАНИТЬ
Phase 2 production execution: NOT APPROVED


План: CRM Companies — Phase 2 окончательная материализация migration и rollback SQL
```

Статус: PLAN ONLY. Documentation-only patch. БД, migrations и `src/` не менять. Phase 2 execution: NOT APPROVED. Admin fixture blocker выносится в отдельный последующий план.

## 1. Scope

Единственный редактируемый файл:

```
.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md
```

Любой другой diff — HARD STOP. `.lovable/plan.md`, ADR-0002, миграции, rollback-артефакты Phase 1, код `src/**` и `supabase/**` не трогать.

## 2. Цель патча

Довести §11 (forward migration) и §12 (rollback) до состояния «copy-paste из markdown в один SQL-файл без ручного дописывания». Убрать все placeholder-конструкции и обещания «развернуть при финализации».

## 3. Правки §11 (forward migration SQL)

3.1. **Billing-upsert (`crm_company_upsert_from_billing`)** — развернуть полностью:

- Для каждого целевого поля `companies` (`display_name`, `legal_name`, `short_name`, `unp_normalized`, `country`, `company_kind`, `registration_country`, `address_*`, `bank_*`, `contact_*`, `metadata`, любые прочие, включённые в контракт §7.1) — привести явный ownership-блок: источник из `client_legal_details`, правило нормализации, поведение при NULL, правило «last non-null wins» с проверкой `updated_at`.
- Удалить фразы «аналогично», «остальные поля по той же схеме», «в фактической миграции».
- Финальный `INSERT ... ON CONFLICT (country, unp_normalized) DO UPDATE SET ...` со всеми колонками в явном виде.
- Вызов `_crm_company_emit_domain_event(...)` сохранить в текущем виде.

3.2. **Merge (`crm_company_merge`)** — заменить `... см. §7.5 body` на полный SQL:

- Явный `UPDATE public.company_contacts SET company_id = _target_id WHERE company_id = _source_id` с обработкой конфликта уникального индекса `(company_id, profile_id, relationship_type)` через `ON CONFLICT DO NOTHING` + последующий `DELETE` осиротевших строк источника.
- Явный `UPDATE public.client_legal_details_company_map SET company_id = _target_id WHERE company_id = _source_id` с аналогичной обработкой уникального ключа.
- Полный SQL рекурсивного `jsonb` merge `metadata` (target имеет приоритет; для NULL используется source; функция `_crm_jsonb_deep_merge`, если она уже введена в §10, — привести её тело здесь же, без ссылок «см. helpers»).
- `UPDATE public.companies SET status='archived', archived_at=now(), archived_reason='merged_into:'||_target_id::text WHERE id=_source_id`.
- Emit `company.merged.v1` через `_crm_company_emit_domain_event`.
- Возврат структуры результата в явном виде.

3.3. **Archive (`crm_company_archive`)** — убедиться, что тело приведено полностью, без ссылок на §7.6 body. Если остались `...` — раскрыть.

3.4. `**search_global**` — заменить описание «старое body + additive-блок» одним полным `CREATE OR REPLACE FUNCTION public.search_global(...) RETURNS ... LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ ... $$;`:

- Скопировать текущее production-тело (SHA-256 уже зафиксирован в плане) в раздел as-is.
- Добавить additive-ветку по `companies` внутри тела.
- Финальный текст должен компилироваться самостоятельно, без склейки из двух источников.

3.5. **Helpers §10** — если `_crm_jsonb_deep_merge` или иные private helpers упомянуты в §11 без полного тела в §10, привести их `CREATE OR REPLACE FUNCTION` целиком в §10.

3.6. **Idempotency helper `_crm_company_emit_domain_event**` — оставить без изменений (уже финализирован в v3-патче: advisory lock + `NOT EXISTS`).

## 4. Правки §12 (rollback SQL)

- Развернуть полный `DROP FUNCTION IF EXISTS public.<name>(<exact signature>);` для всех 7 public RPC и 2 private helpers, с точными identity args.
- `DROP FUNCTION IF EXISTS public.search_global(<signature>);` + `CREATE OR REPLACE FUNCTION public.search_global(...)` восстановление pre-Phase-2 тела целиком (то же, что использовано в §11.4 as-is блок).
- Явно снять все `GRANT`/`REVOKE`, добавленные Phase 2.
- Убрать любые `...`, «аналогично», «см. §11».
- Rollback должен применяться в один файл без ручной подстановки.

## 5. Запрет placeholder-паттернов

После правок в §11 и §12 не должно оставаться ни одной из строк (case-insensitive):

```
\.\.\.        (внутри code fence sql)
сокращено
см\. §
см\. body
см\. helpers
при финализации
в фактической миграции
аналогично
остальные поля
TODO
FIXME
```

## 6. Static verification (внутри того же патча)

Добавить в §13 (или создать §13, если отсутствует) блок «Placeholder scan» с фактическим результатом `rg` по перечню §5, ограниченным диапазонами §11 и §12. Ожидание: 0 совпадений. Вывод `rg` приложить дословно.

Дополнительно:

- `rg -n 'CREATE OR REPLACE FUNCTION' §11` — ожидается ровно 7 public RPC + 2 private helper + 1 `search_global` = 10 определений.
- `rg -n 'DROP FUNCTION' §12` — ожидается ровно 10 сигнатур (симметрично §11).
- `rg -n '_crm_company_emit_domain_event\(' §11` — число вызовов не меньше зафиксированного в v3 (14), прямых `INSERT INTO public.domain_events` в телах RPC — 0.

## 7. Copy-paste readiness

В конце §11 добавить checklist:

- Весь SQL §11 заключён в один `sql` code fence либо в непрерывную последовательность fence-блоков без прозы между DDL-стейтментами.
- Никаких переменных вида `<...>`, `{{...}}`, `TBD` в теле SQL.
- Порядок стейтментов соответствует зависимостям (helpers → public RPC → grants → search_global).

Аналогичный checklist — в §12.

## 8. Stop-guards

- Placeholder scan §6 нашёл ≥1 совпадение → патч не финализируется, правки продолжаются.
- Число определений/удалений в §11/§12 не совпадает → HARD STOP, разбор.
- Обнаружен diff вне `companies_phase2_runnable_plan.md` → HARD STOP, откат правки.

## 9. Deliverable

Отчёт «Отчет о выполнении: Phase 2 runnable SQL финальная материализация» со структурой:

1. Изменённый файл и его SHA-256 до/после.
2. Diff-summary по §10, §11, §12, §13 (число добавленных/удалённых строк, без полного тела).
3. Дословный вывод placeholder scan (§6).
4. Подтверждение счётчиков `CREATE OR REPLACE FUNCTION` / `DROP FUNCTION` / `_crm_company_emit_domain_event`.
5. Явное подтверждение: БД, migrations, `src/`, `.lovable/plan.md`, ADR-0002 не изменялись.
6. Статус: Phase 2 runnable plan FINALIZED. Admin fixture blocker сохранён. Phase 2 execution NOT APPROVED.

## 10. Deferred (следующие отдельные планы)

- Admin fixture: `1@ajoure.by` → добавить роль `admin`, сохранить `menedzher`, before/after proof, точный DML, проверка `has_role_v2`, rollback, запрет изменения пароля.
- Execution package: фактические migration + rollback файлы, SHA-256, commit SHA, exact diff, отдельный execution approve.
- Runtime proof: применение миграции, authenticated proof под `1@ajoure.by`, service_role proof для billing-upsert, merge/archive под admin, откат тестового DML отдельной транзакцией, отсутствие fixtures, запрет авто-rollback при ошибке.