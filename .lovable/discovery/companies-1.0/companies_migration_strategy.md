# companies_migration_strategy.md

Paper-only. Никакой SQL в этом Discovery не исполняется.

## 1. Разделение спринтов

- **Main implementation:** schema → RPC → backfill → sync → integration → UI.
- **Follow-up validation:** runtime smoke → regression → performance → cleanup → deferred debt.

Некритичные proof gaps не блокируют основной scope, фиксируются в `companies_phase1_execution_plan.md §Deferred`.

## 2. Последовательность DDL (Phase 1, DRAFT)

```
1. CREATE EXTENSION IF NOT EXISTS pg_trgm  -- уже есть
2. CREATE TABLE public.companies (...)
3. GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
   GRANT ALL ON public.companies TO service_role;
4. ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
5. CREATE POLICY (super_admin/admin/menedzher/support) — см. permissions matrix.
6. CREATE TABLE public.company_contacts (...);
   GRANT ...; ENABLE RLS; POLICY.
7. CREATE TABLE public.client_legal_details_company_map (...);
   GRANT ...; ENABLE RLS; POLICY.
8. CREATE TABLE public.company_sync_queue (...);
   GRANT SELECT ON ... TO authenticated (readonly);
   GRANT ALL TO service_role;
   ENABLE RLS; POLICY service_role only.
9. Индексы (см. performance_notes §4-7).
10. Триггер updated_at (public.update_updated_at_column) на 4 таблицы.
11. Триггер `trg_set_companies_public_id` через `public_id_sequences` (prefix='co').
12. Функция validate_unp(country, unp) — normalize + checksum.
```

## 3. RPC (Phase 2)

```
- search_companies(_filters jsonb)
- company_upsert_from_billing(_client_legal_details_id uuid)
- company_link_contact(_company_id, _profile_id, _role)
- company_unlink_contact(_link_id)
- company_merge(_source_id, _target_id)
- company_archive(_id, _reason)
- company_grp_refetch(_id)
```

Все — SECURITY DEFINER, `SET search_path = public`, guard `has_role_v2`.

## 4. Backfill (Phase 3)

```
1. Feature flag OFF.
2. Idempotent script (edge function `company-backfill-run`):
   FOR each client_legal_details WHERE purpose='billing'
     AND client_type IN ('legal_entity','entrepreneur')
   LOOP
     upsert into companies matching (country, unp_normalized).
     upsert into company_contacts (company, profile_id, role='billing').
     upsert into client_legal_details_company_map.
     emit domain_events lineage.
   END.
3. Verification:
   - COUNT(companies) == distinct(unp_normalized)
   - COUNT(company_contacts) >= COUNT(source rows)
   - 0 orphan mappings.
4. Idempotency: повторный запуск не создаёт дубликатов.
```

## 5. Sync (Phase 4)

- Trigger AFTER INSERT/UPDATE на `client_legal_details` (только billing legal_entity/entrepreneur) → INSERT в `company_sync_queue`.
- Cron `company-sync-worker` каждую минуту.
- Idempotency: `(entity_id, run_reason)`.

## 6. Integration (Phase 5-6)

- Phase 5: `orders_v2.company_id` (nullable) + FK RESTRICT + trigger emit event.
- Phase 6: `crm_tasks.company_id` (nullable, необязательно в Phase 1 core).

## 7. UI (Phase 7-8)

- Phase 7: `/admin/companies` + `CompanyDetailSheet`.
- Phase 8: вкладка «Компании» в `ContactDetailSheet`.

## 8. Feature flag

- `app_settings.feature_companies_enabled` (boolean) — гейт для UI-точек входа.
- RPC/tables создаются сразу, но UI не показывается до включения флага.

## 9. Production switch

1. Проверить backfill в staging (реплика).
2. Включить сначала для `super_admin`.
3. Через 24 часа — для `admin`/`menedzher`.
4. `support` — через 72 часа.

## 10. Rollback

- Все таблицы новые → drop-safe.
- `orders_v2.company_id` — nullable, `DROP COLUMN` не ломает существующие сделки (Phase 5 rollback).
- Feature flag OFF — мгновенный откат UI.
- Backfill идемпотентен → повторный запуск после rollback безопасен.

## 11. Verification checks (после каждой фазы)

- `SELECT count(*) FROM companies` = ожидаемое.
- 0 записей с NULL `unp_normalized` где `country IS NOT NULL AND client_type <> 'individual'`.
- 0 orphan `company_contacts.profile_id`.
- 0 orphan `client_legal_details_company_map`.
- `company_sync_queue.status='failed'` = 0 через 5 минут после старта воркера.

## 12. Deferred (follow-up)

- pg_trgm GIN индексы (см. performance_notes §4).
- Table virtualization в admin UI при N>1000.
- Merge UI polish.
- Import CSV/xlsx (Phase 9).
- Совместимость с Documents (Phase 10).
