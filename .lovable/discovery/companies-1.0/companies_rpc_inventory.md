# companies_rpc_inventory.md

Полная инвентаризация путей чтения/поиска, релевантных Companies. Проверены `pg_proc`, PostgREST-select, hooks, edge functions.

## 1. RPC-функции public

Запрос `SELECT proname FROM pg_proc WHERE proname LIKE 'search_%'` показал:

| RPC | Назначение | Ссылка |
|---|---|---|
| `search_global` | Глобальный админский поиск | `rpc: public.search_global` |
| `search_deal_rows` | Поиск строк сделок | `rpc: public.search_deal_rows` |
| `search_club_members_enriched` | Поиск club members с enrichment | `rpc: public.search_club_members_enriched` |

Универсального `search_entities` **нет**. Единого `list_contacts` / `list_deals` RPC **нет** — большинство админских списков читают напрямую через PostgREST.

## 2. Public ID generator — реальный контракт

`SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname IN ('next_public_id','generate_admin_catalog_public_id');`:

- `public.next_public_id(p_entity_type text)` — plpgsql, SECURITY DEFINER, атомарный UPDATE `public_id_sequences.last_value`, возвращает `prefix || '-' || lpad(last_value,6,'0')`. Существующие prefixes: `CALL`, `CDS`, `FLD`, `PRD`, `SDB`, `SFS`, `SITE`, `T`, `TAG`, `TASK`, `TRN`, `pf-`. Формат — `PREFIX-000001`.
- `public.generate_admin_catalog_public_id(_prefix text)` — sql, возвращает `_prefix || '_' || encode(gen_random_bytes(6),'hex')`. Это отдельный случайный генератор, **не подходит** для канонического CMP-000001.

Вердикт: canonical generator для companies — `next_public_id('company')`, с записью `(entity_type='company', prefix='CMP', last_value=0)` в `public_id_sequences`. Формат — **`CMP-000001`**. Упоминания `generate_admin_catalog_public_id`, `generate_public_id('co')`, prefix=`co` в других документах отозваны и должны читаться как `next_public_id('company')` + `CMP`.

## 3. PostgREST-select пути

- `code: src/hooks/useTaskRelations.ts:L23-L60` — `.from('orders_v2').select(...)` с join `profile:profiles!fk`.
- Аналогичные `.from('profiles')`, `.from('orders_v2')`, `.from('crm_tasks')` — типовой паттерн admin-списков.
- Filters/pagination — client-side + server-side через `.range()`.

## 4. Tasks RPC (для Phase 6)

- `crm_task_list(_filters jsonb)` — `code: src/hooks/useCrmTasks.ts:L60-L83`.
- `crm_task_create(payload jsonb)` — L88-L114.
- `crm_task_update_status(_task_id, _status, _result_comment)` — L133-L148.
- `crm_task_reassign(_task_id, _assignee)` — L156-L175.
- `crm_task_bulk_status(_task_ids, _status, _result_comment, _request_id)` — L214-L240.
- `crm_task_bulk_update(_task_ids, _patch, _request_id)` — L253-L275.

Расширение для Phase 6: добавить в `_filters` поле `company_id` (jsonb, без DDL).

## 5. Command palette / global search

- `search_global` — единственный aggregator.
- Отдельного command palette по «⌘K» с полнотекстом за пределами shadcn primitive не найдено.

## 6. Edge functions (relevant)

- `code: supabase/functions/amocrm-webhook/index.ts` — external companies events (freeze §7). Canonical companies из webhook не создаются.
- `code: supabase/functions/integration-sync/index.ts` — Amo companies import.
- `code: supabase/functions/grp-lookup/index.ts` — гос. реестр.
- `import-contacts-gc` — **проверено `SELECT name FROM edge_functions_registry WHERE name ILIKE '%contact%'`**: функция существует как импортер контактов из GetCourse. К Companies отношения не имеет (импортирует только `profiles`), в Phase 1/2 не расширяется. Возможное расширение — Phase 9 (импорт компаний), тогда `import-contacts-gc` либо получает флаг `emit_companies=true`, либо parallel-функция `import-companies-gc`. Решение — отдельный ADR в Phase 9. Из freeze этот пункт исключён из blocking.

## 7. Согласованная Phase Matrix (canonical)

Единая матрица, приоритетнее любых противоречий в других документах.

| RPC | Создание | Первое использование | Roles (EXECUTE) |
|---|---|---|---|
| `crm_company_get_or_create(country,unp,full_name,company_kind,source,source_cld_id)` — **скелет** | Phase 1 | Phase 2 (полная реализация), Phase 3 (backfill) | authenticated + guard has_role_v2 |
| `crm_company_link_contact(company_id,profile_id,relationship_type,is_billing_contact,source,source_map_id)` — **скелет** | Phase 1 | Phase 2 (полная реализация), Phase 3 (backfill) | authenticated + guard |
| `crm_company_upsert_from_billing(client_legal_details_id)` | Phase 2 | Phase 3 (backfill), Phase 4 (sync worker) | service_role только |
| `search_companies(filters jsonb)` | Phase 2 | Phase 7 (AdminCompanies list) | authenticated + guard |
| `crm_company_merge(source_id,target_id)` | Phase 2 | Phase 7 (merge UI) | authenticated + guard admin/super_admin |
| `crm_company_archive(id,reason)` | Phase 2 | Phase 7 | authenticated + guard admin/super_admin |
| `crm_company_grp_refetch(id)` | Phase 2 | Phase 4 (sync worker) + Phase 7 (manual refresh) | authenticated + guard admin/menedzher |

`search_global` расширяется в Phase 2 (не Phase 1) — добавление branch «companies» в существующий RPC.

Формулировки типа «в Phase 1 добавить search_companies» в других документах отозваны — Phase 1 не создаёт search_companies и не изменяет search_global.

## 8. Deny-listed

- `search_entities` (см. freeze §Deferred D2).
- `notification_outbox` в роли data-sync очереди (freeze §Rejected X1).
- `generate_admin_catalog_public_id('co')` — использовать `next_public_id('company')` с prefix `CMP`.
