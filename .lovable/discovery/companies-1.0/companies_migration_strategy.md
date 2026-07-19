# companies_migration_strategy.md

Paper-only. Никакой SQL в этом Discovery не исполняется.

## 1. Разделение спринтов

- **Main implementation:** schema → RPC → backfill → sync → integration → UI.
- **Follow-up validation:** runtime smoke → regression → performance → cleanup → deferred debt.

Некритичные proof gaps не блокируют основной scope, фиксируются в `companies_phase1_execution_plan.md` §Deferred.

## 2. Последовательность DDL (Phase 1, DRAFT)

```
1. EXTENSION pg_trgm — уже установлен.
2. INSERT INTO public_id_sequences ('company','CMP',0) ON CONFLICT DO NOTHING.
3. CREATE TABLE public.companies (см. execution_plan §2.1).
4. GRANT SELECT/INSERT/UPDATE/DELETE ON companies TO authenticated;
   GRANT ALL ON companies TO service_role.
5. ALTER TABLE companies ENABLE ROW LEVEL SECURITY + 4 policies.
6. CREATE TABLE client_legal_details_company_map (полный audit-набор:
   created_at/updated_at/created_by/updated_by/metadata) → GRANT → RLS → policies.
   Создаётся ДО company_contacts, т.к. company_contacts.source_client_legal_details_map_id → map(id).
7. CREATE TABLE company_contacts (утверждённый контракт: relationship_type/source/is_billing_contact,
   без role='billing'; profile_id nullable для внешнего импорта; source_client_legal_details_map_id
   FK на map, созданную в шаге 6) → GRANT → RLS → policies.
8. CREATE TABLE company_sync_queue (полный audit-набор, включая created_by/updated_by)
   → GRANT только service_role (никакого authenticated SELECT) → RLS → single policy service_role.
9. Индексы (см. performance_notes §4-7).
10. Триггер update_updated_at_column на 4 таблицы (все имеют updated_at).
11. Триггер trg_set_companies_public_id, вызывающий next_public_id('company').
12. RPC-скелеты crm_company_get_or_create и crm_company_link_contact (см. execution_plan §4).
```

Вне Phase 1: trigger на `client_legal_details` (Phase 4), feature flag / admin_section / admin_resource (Phase 7), backfill (Phase 3), sync worker (Phase 4), UI (Phase 7+).

## 3. Phase 2 RPC (создание)

Полная согласованная matrix — в `companies_rpc_inventory.md` §7. Резюме:

- `crm_company_upsert_from_billing(_client_legal_details_id uuid)`
- `search_companies(_filters jsonb)`
- `crm_company_merge(_source_id, _target_id)`
- `crm_company_archive(_id, _reason)`
- `crm_company_grp_refetch(_id)`
- Полная реализация `crm_company_get_or_create` / `crm_company_link_contact` (в Phase 1 — только скелеты).

Все — SECURITY DEFINER, `SET search_path=public`, guard `has_role_v2`.

## 4. Backfill (Phase 3)

Backfill выполняется через edge function `company-backfill-run`, вызывающую RPC Phase 2. Триггера на `client_legal_details` **нет** — enqueue делается явно скриптом backfill.

```
FOR each row IN client_legal_details
    WHERE purpose='billing' AND client_type IN ('legal_entity','entrepreneur')
LOOP
  v_company_id := crm_company_upsert_from_billing(row.id);
  IF row.profile_id IS NOT NULL THEN
    v_map_id := INSERT INTO client_legal_details_company_map(...) ON CONFLICT DO NOTHING RETURNING id;
    PERFORM crm_company_link_contact(
      v_company_id, row.profile_id,
      'billing_contact', true,
      'billing_requisites', v_map_id
    );
  END IF;
END LOOP;
```

## 5. Verification (после Phase 3 backfill) — исправленные проверки

Исходное количество source rows (проверено read-only на текущий момент):

```
SELECT count(*) FROM client_legal_details
  WHERE purpose='billing' AND client_type IN ('legal_entity','entrepreneur');
-- 17

SELECT count(DISTINCT COALESCE(leg_unp, ent_unp)) FROM client_legal_details
  WHERE purpose='billing' AND client_type IN ('legal_entity','entrepreneur');
-- 16

SELECT count(DISTINCT profile_id) FROM ...;
-- 16
```

Ожидаемые проверки после backfill:

- `COUNT(companies)` = **distinct (country, unp_normalized)** билинговых источников (сейчас 16).
- `COUNT(client_legal_details_company_map)` = **COUNT(source rows)** (сейчас 17). Каждой billing-строке — ровно одна запись map.
- `COUNT(company_contacts WHERE is_billing_contact=true)` = **distinct (company_id, profile_id)** билинг-пар (≤ COUNT(source rows), т.к. несколько billing-строк одного profile для одной компании могут дать одну company_contacts-связь).
- `SELECT count(*) FROM companies WHERE company_kind IN ('legal_entity','entrepreneur','foreign','unknown')` = `COUNT(companies)` (100% покрытие CHECK). Никаких проверок на `client_type` — такой колонки в `companies` **нет** (правка B8 review).
- 0 orphan `company_contacts.profile_id` где `relationship_type <> 'external_contact'`.
- 0 orphan `client_legal_details_company_map`.
- `company_sync_queue.status='failed'` = 0 через 5 минут после старта воркера (Phase 4).

Идемпотентность:

- Повторный запуск backfill не создаёт дубликатов (проверка через ON CONFLICT в RPC).

## 6. Sync (Phase 4)

- Trigger AFTER INSERT/UPDATE на `client_legal_details` WHERE `purpose='billing' AND client_type IN ('legal_entity','entrepreneur')` → INSERT в `company_sync_queue`.
- Единый канонический `idempotency_key`: **`cld:{client_legal_details_id}:{updated_at_epoch_ms}`**. Формат `(entity_id, run_reason)` из ранней версии отозван (может навсегда заблокировать re-sync той же записи).
- Cron `company-sync-worker` каждую минуту.

## 7. Integration (Phase 5-6)

- Phase 5: `orders_v2.company_id` (nullable) + FK RESTRICT + trigger emit `company.linked_to_deal.v1`.
- Phase 6: `crm_tasks.company_id` (nullable).

## 8. Feature flag / registry inserts

- `app_settings.feature_companies_enabled` (boolean) — **добавляется в Phase 7**, не в Phase 1. Единственное каноническое имя — `feature_companies_enabled` (SQL-совместимо, без точек). Формы `feature.companies.enabled` в других документах отозваны.
- `admin_section` / `admin_resource` / `role_admin_*_access` inserts — тоже Phase 7.

## 9. Queue permissions — единый контракт

`company_sync_queue`:

- GRANT ALL TO service_role.
- **Никакого GRANT для authenticated** (в том числе SELECT). Форма «GRANT SELECT TO authenticated (readonly)» из ранней версии отозвана.
- RLS enabled, single policy для service_role. Клиенты не должны знать о задачах синхронизации.

## 10. Production switch (Phase 7)

1. Backfill проверен в staging (реплика).
2. Включить `feature_companies_enabled=true` сначала для `super_admin` (через `role_admin_section_access.access_level` scope или явную client-side проверку).
3. Через 24 часа — для `admin`/`menedzher`.
4. `support` — через 72 часа.
5. `admin_gost` — не включается (см. permissions matrix §3).

## 11. Rollback

Полный порядок — в `companies_phase1_execution_plan.md` §8. Ключевое:

- Все 4 таблицы новые → DROP по одной, **без CASCADE**.
- `orders_v2.company_id` (Phase 5) — nullable, `DROP COLUMN` не ломает существующие сделки (rollback Phase 5).
- Backfill идемпотентен → повторный запуск после rollback безопасен.
- В Phase 1 нет изменений в `client_legal_details`, поэтому rollback не касается billing-домена.

## 12. Deferred (follow-up)

- pg_trgm GIN индексы (см. `companies_performance_notes.md` §4).
- Virtualization в admin UI при N>1000.
- Merge UI polish.
- Import CSV/xlsx (Phase 9), включая правило создания/поиска profile до вставки `company_contacts` для внешних контактов.
- Совместимость с Documents (Phase 10).
