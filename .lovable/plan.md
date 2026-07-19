Проверил. **Направление правильное, лишних работ в план не добавлено**, но это пока ещё не настоящий runnable-план, а техническое задание на его подготовку.

## Что нужно исправить до approval

1. **В документе нет полного SQL.** Там прямо указано, что фактический SQL будет написан позже, в build-режиме. Но итоговый runnable-план уже должен содержать готовые блоки:
  - preflight;
  - forward migration;
  - все таблицы и constraints;
  - 13 RLS policies;
  - triggers;
  - обе RPC;
  - verification;
  - rollback.
  Формулировки «определяется в build-режиме», «окончательное имя будет зафиксировано позже» и «SQL прописывается при подготовке» нужно убрать.
2. **Неверный порядок rollback.** Сейчас предложено сначала удалить функции, потом triggers. Так удалить `set_companies_public_id()` не получится, пока от неё зависит trigger.
  Правильный порядок:
  ```text
  triggers
  → RPC и trigger functions
  → policies
  → tables
  → public_id_sequences

  ```
3. **Не закрыт точный preflight SYSTEM workspace.** Сейчас написано, что таблица workspace/tenant будет определена позже. Нужно уже в плане указать конкретную таблицу, конкретный SQL и ожидаемый UUID или признак SYSTEM workspace.
4. **RLS runtime proof описан недостаточно точно.** Нужно определить, как именно будут проверяться все роли:
  - отдельные staging-аккаунты;
  - временная смена роли тестовой учётки;
  - impersonation через SQL/JWT;
  - обязательный возврат исходных ролей после теста.
  Одного упоминания `[1@ajoure.by](mailto:1@ajoure.by)` недостаточно для доказательства доступа восьми разных ролей.

## Итог

Архитектуру менять не нужно. Scope правильный:

```text
4 таблицы
+ CMP public ID
+ RLS
+ 2 RPC
+ verification
+ rollback

```

Без backfill, UI, сделок, задач, AmoCRM и синхронизации.

Lovable должен теперь не писать новый общий план, а **заполнить этот документ реальным полным SQL**, исправить rollback и закрыть два оставшихся точных механизма проверки. После этого документ можно будет утвердить и отдельно разрешить выполнение Phase 1.

&nbsp;

План: CRM Companies — Phase 1 Canonical Data Model

Статус: PLAN ONLY / READ-ONLY / DO NOT EXECUTE. Миграции, SQL, RPC, код, edge functions и БД не изменяются. Deliverable — единственный новый markdown-файл.

## Архитектурная база (не пересматривается)

- Architecture Freeze: commit `04f85026c3458cdd3c8398c1841c1e4371e3dbfa` (APPROVED / FROZEN).
- Technical amendments: commit `8649e2ba7d649a303e3a8e50c553ecd679d59acf`.
- Источники требований (read-only): `.lovable/discovery/companies-1.0/companies_architecture_freeze.md`, `companies_phase1_execution_plan.md`, `companies_permissions_matrix.md`, `companies_migration_strategy.md`, `companies_read_only_proof.md`, `companies_performance_notes.md`, `companies_rpc_inventory.md`.

Любое архитектурное отклонение — только через отдельный ADR и явное approval.

## Deliverable

Единственный новый файл:

```
.lovable/discovery/companies-1.0/companies_phase1_runnable_plan.md
```

Header документа:

```
Status: DRAFT / NOT APPROVED / DO NOT EXECUTE
Scope: Phase 1 Canonical Data Model (schema + public ID + RLS + 2 RPC skeletons)
Base: Freeze 04f85026 + Amendments 8649e2ba
```

Никаких иных файлов не создаётся и не изменяется. `companies_architecture_freeze.md` не редактируется. Ни один файл вне `.lovable/discovery/companies-1.0/` не затрагивается.

## Границы Phase 1 (жёсткие запреты, дублируются в документе)

Запрещено в Phase 1: backfill; trigger на `client_legal_details`; company-sync-worker; изменения `orders_v2`, `crm_tasks`; UI, AdminCompanies, CompanyDetailSheet; feature flag; `admin_section` / `admin_resource`; `role_admin_*` access; создание companies из AmoCRM; `external_ids`, `parent_company_id`, `hierarchy_type`; изменения document-flow; `company_contact_person_map`; любые работы Phase 2–11.

## Структура runnable-плана (разделы файла)

Документ содержит 11 разделов, каждый с полным SQL без многоточий и формулировок «аналогично». Ниже — контракт каждого раздела; фактический SQL прописывается в файле при его подготовке в build-режиме.

### §1. Preflight (read-only checks)

Для каждого пункта: точный SQL, ожидаемый результат, stop-guard, действие при несовпадении.

- Отсутствие 4 Phase 1 таблиц (`to_regclass IS NULL` × 4).
- `SELECT * FROM public_id_sequences WHERE entity_type='company'` — 0 строк; при наличии строки с `prefix<>'CMP'` — HARD STOP (без `ON CONFLICT DO NOTHING`).
- Существование и сигнатуры helper-функций: `next_public_id(text)`, `has_role_v2(uuid,text)`, `update_updated_at_column()` — через `pg_proc` + `pg_get_function_identity_arguments`.
- Существование SYSTEM workspace (точный SELECT из соответствующей таблицы workspace/tenant, определяется чтением проекта в build-режиме).
- Существование всех ролей (`super_admin`, `admin`, `menedzher`, `support`, `admin_gost`, `editor`, `user`) в `roles`.
- Отсутствие конфликтующих объектов: функций `crm_company_get_or_create` / `crm_company_link_contact`, индексов `idx_companies_*`, триггеров `trg_set_companies_public_id`, `trg_company_%`, `update_*_updated_at` для 4 таблиц, любых policies на будущих 4 таблицах.
- Snapshot `schema_hash` из §7 `companies_read_only_proof.md` = `c41160b83c8e15c3d3c41a13028700d5`.

Stop-guard: любое расхождение → execution не начинается.

### §2. Migration files

- Одна атомарная forward migration Phase 1 (single transaction, все DDL/GRANT/RLS/POLICY/TRIGGER/RPC внутри одного `BEGIN…COMMIT`).
- Отдельный rollback-документ (SQL) — не миграция, применяется вручную по §9.
- Именование: соответствует принятому в проекте паттерну `supabase/migrations/<timestamp>_phase1_companies_core.sql` (окончательное имя фиксируется build-этапом; в Phase 1-плане только контракт).
- Поведение при ошибке: полный `ROLLBACK` транзакции, БД остаётся в pre-Phase-1 состоянии, `schema_hash` не меняется.

### §3. DDL (полный, без сокращений)

Порядок строго: `companies` → `client_legal_details_company_map` → `company_contacts` → `company_sync_queue`.

Для каждой таблицы в документе перечислены поколоночно: имя, тип, NULL/NOT NULL, DEFAULT, FK + referential action, CHECK, UNIQUE, `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`, `created_at`, `updated_at`, `created_by`, `updated_by`. Точные имена всех constraints и индексов (`pk_*`, `fk_*`, `uq_*`, `ck_*`, `idx_*`).

Ключевой контракт billing lineage сохраняется дословно:

```
source_client_legal_details_map_id uuid NULL
  REFERENCES public.client_legal_details_company_map(id)
  ON DELETE RESTRICT
```

`companies.company_kind` — CHECK по `('legal_entity','entrepreneur','foreign','unknown')`. `company_contacts` без `role='billing'`, использует `relationship_type` + `is_billing_contact`. `company_sync_queue` содержит полный audit-набор, включая `created_by/updated_by`.

### §4. Public ID

- `INSERT INTO public_id_sequences(entity_type, prefix, last_value) VALUES ('company','CMP',0)` — без `ON CONFLICT DO NOTHING`; при существующей строке с иным prefix preflight §1 останавливает.
- Trigger function `public.set_companies_public_id()` — plpgsql, вызывает `next_public_id('company')`, если `NEW.public_id IS NULL`; если явно передан — валидирует формат `^CMP-\d{6}$` и уникальность (`UNIQUE(public_id)`).
- Trigger `trg_set_companies_public_id BEFORE INSERT ON public.companies FOR EACH ROW`.
- Формат: `CMP-000001` (совпадает с существующим `next_public_id`).
- Staging-проверка без расхода production id: staging — отдельная реплика; runtime proof на staging не влияет на production `last_value`.

### §5. GRANT / REVOKE / RLS (13 policies)

Полностью перечислены:

- `REVOKE ALL ON <table> FROM PUBLIC` для 4 таблиц.
- `GRANT` контракт:
  - `companies`, `client_legal_details_company_map`, `company_contacts`: `GRANT SELECT, INSERT, UPDATE, DELETE ON … TO authenticated; GRANT ALL … TO service_role;` без `anon`.
  - `company_sync_queue`: только `GRANT ALL … TO service_role`, никакого `authenticated`.
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY` × 4.
- 13 CREATE POLICY (точная разбивка per-table SELECT/INSERT/UPDATE/DELETE) — через guard `public.has_role_v2(auth.uid(), …)`; `company_sync_queue` — единственная policy `TO service_role USING (true) WITH CHECK (true)`.
- Матрица ролей (проверяется в §8): `super_admin`, `admin`, `menedzher` — full CRUD на companies/map/contacts; `support` — SELECT; `admin_gost`, `editor`, `user`, authenticated без CRM-роли, `anon` — 0 доступ; `service_role` — bypass.

### §6. RPC-контракты (Phase 1 skeletons)

Обе функции: `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO authenticated`, внутренний guard `has_role_v2(auth.uid(), …)` (иначе `RAISE EXCEPTION 'forbidden'`).

- `crm_company_get_or_create(_country text, _unp text, _full_name text, _company_kind text, _source text, _source_cld_id uuid) RETURNS uuid` — Phase 1 skeleton: **только SELECT существующей companies по `(country, unp_normalized)**`; если найдено — вернуть `id`, если нет — `RAISE EXCEPTION 'phase1_skeleton_no_create'`. Это устраняет семантический конфликт «get_or_create, но не создаёт»: имя сохранено под Phase 2 контракт, поведение Phase 1 явно документировано. Полное создание — Phase 2.
- `crm_company_link_contact(_company_id uuid, _profile_id uuid, _relationship_type text, _is_billing_contact boolean, _source text, _source_map_id uuid) RETURNS uuid` — Phase 1 skeleton: валидация входа, `INSERT … ON CONFLICT (company_id, profile_id, relationship_type) DO UPDATE SET is_billing_contact = EXCLUDED.is_billing_contact RETURNING id`. Идемпотентен.

Ошибки: `phase1_skeleton_no_create`, `forbidden`, `invalid_company_kind`, `invalid_relationship_type`. Явно указана граница «skeleton Phase 1 vs полная логика Phase 2».

### §7. Verification (machine-check SQL)

Полный набор пост-миграционных SELECT: 4 таблицы существуют; все обязательные колонки/constraints/FK actions/индексы; RLS enabled × 4; policies count = 13 и совпадают по именам; GRANT/REVOKE соответствуют §5; обе RPC существуют с точными сигнатурами (`pg_get_function_identity_arguments`); `public_id_sequences` содержит `(company,CMP,0)`; все 4 таблицы `count(*)=0`; `client_legal_details` не изменена; 0 триггеров `trg_company_*` на `client_legal_details`; `orders_v2`, `crm_tasks` не изменены; `admin_section`/`admin_resource`/`app_settings` не содержат новых Phase 1 записей; `schema_hash` из §7 read-only proof неизменен (`c41160b83c8e15c3d3c41a13028700d5`).

### §8. RLS runtime proof

Runtime smoke на staging для ролей: `service_role`, `anon`, authenticated без CRM-роли, `support`, `menedzher`, `admin`, `super_admin`, `admin_gost`. Тестовая админ-учётка — `1@ajoure.by`; пароль не хранится и не публикуется (используется существующий staging-механизм авторизации). Для каждой роли — ожидаемые SELECT/INSERT/UPDATE/DELETE/EXECUTE per-table и per-RPC, с ожидаемыми ошибками (`permission denied for table`, `forbidden`, `new row violates row-level security policy`).

### §9. Rollback (без CASCADE)

Порядок:

1. `DROP FUNCTION` `crm_company_get_or_create(...)`, `crm_company_link_contact(...)`, `set_companies_public_id()` — точные сигнатуры.
2. `DROP TRIGGER` — перечислены все 5: `trg_set_companies_public_id`, `update_companies_updated_at`, `update_client_legal_details_company_map_updated_at`, `update_company_contacts_updated_at`, `update_company_sync_queue_updated_at`.
3. `DROP POLICY` — все 13, поимённо, per-table.
4. `DROP TABLE` в порядке: `company_sync_queue` → `company_contacts` → `client_legal_details_company_map` → `companies`. Без `CASCADE`.
5. `DELETE FROM public_id_sequences WHERE entity_type='company' AND prefix='CMP'`.

Helper functions (`update_updated_at_column`, `has_role_v2`, `next_public_id`) явно исключены из rollback.

Пост-rollback checks: 4 regclass = NULL; 0 строк `entity_type='company'`; helper functions сохранены; `schema_hash = c41160b83c8e15c3d3c41a13028700d5`; существующие CRM/Billing таблицы не изменены.

### §10. Stop-guards

Execution обязан остановиться при: несовместимом существующем объекте; занятом/отличном company prefix; отсутствии helper function; отсутствии SYSTEM workspace; расхождении RLS proof; неудачном staging rollback; изменении таблицы вне scope; появлении файла вне `.lovable/discovery/companies-1.0/` (для plan-этапа) или вне утверждённых Phase 1 migration/rollback файлов (для execution-этапа).

### §11. Definition of Done

Точный чек-лист: forward migration подготовлена; rollback подготовлен; staging execution успешен; staging rollback успешен; повторное staging execution успешно (идемпотентность через rollback+re-apply); все schema checks §7 пройдены; все RLS role checks §8 пройдены; 4 таблицы пусты; backfill не выполнен; application code, edge functions, UI не изменены; отчёт содержит SQL proof и фактические outputs; production execution не выполнена без отдельного approval.

## Правила языка и формата

Файл целиком на русском языке. Отчёт о выполнении — на русском, начинается строго со строки `Отчет о выполнении: …`. План-сообщение по итогам подготовки файла начинается строго со строки `План: CRM Companies — Phase 1 Canonical Data Model`.

## Post-deliverable

После создания файла: сообщение-отчёт с указанием SHA нового commit (присваивается платформой), подтверждением что затронут только один markdown-файл, и статусом `DRAFT / NOT APPROVED / DO NOT EXECUTE`. Ожидается consolidated review перед разрешением исполнения Phase 1.