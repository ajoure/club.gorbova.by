# companies_rpc_inventory.md

Полная инвентаризация путей чтения/поиска, релевантных Companies. Проверены не только `search_*`, но и PostgREST-select, hooks, edge functions.

## 1. RPC-функции public

Запрос `pg_proc` показал только три search-функции:

| RPC | Назначение | Ссылка |
|---|---|---|
| `search_global` | Глобальный админский поиск | `rpc: public.search_global` |
| `search_deal_rows` | Поиск строк сделок | `rpc: public.search_deal_rows` |
| `search_club_members_enriched` | Поиск club members с enrichment | `rpc: public.search_club_members_enriched` |

Универсального `search_entities` **нет**. Единого `list_contacts` / `list_deals` RPC **нет** — большинство админских списков читают напрямую через PostgREST.

## 2. PostgREST-select пути (частичный обзор)

- `code: src/hooks/useTaskRelations.ts:L23-L60` — `.from('orders_v2').select(...)` с join `profile:profiles!fk`.
- Аналогичные `.from('profiles').select(...)`, `.from('orders_v2').select(...)`, `.from('crm_tasks').select(...)` — типовой паттерн admin-списков.
- Filters/pagination — client-side + server-side через `.range()`.

## 3. Tasks RPC (для будущей интеграции Phase 6)

- `crm_task_list(_filters jsonb)` — `code: src/hooks/useCrmTasks.ts:L60-L83`.
- `crm_task_create(payload jsonb)` — L88-L114.
- `crm_task_update_status(_task_id, _status, _result_comment)` — L133-L148.
- `crm_task_reassign(_task_id, _assignee)` — L156-L175.
- `crm_task_bulk_status(_task_ids, _status, _result_comment, _request_id)` — L214-L240.
- `crm_task_bulk_update(_task_ids, _patch, _request_id)` — L253-L275.

**Расширение для Phase 6:** добавить в `_filters` поле `company_id` (без DDL: filters — jsonb).

## 4. Command palette / global search / fuzzy

- `search_global` — единственный agregator.
- Отдельного command palette по «⌘K» с полнотекстом не найдено (grep по `command palette`, `cmdk` не даёт CRM-специфичных результатов вне shadcn primitive).
- Trigram / GIN индексы: см. `companies_performance_notes.md`.

## 5. Edge functions (relevant)

- `code: supabase/functions/amocrm-webhook/index.ts` — external companies events (см. freeze §7).
- `code: supabase/functions/integration-sync/index.ts` — Amo companies import.
- `code: supabase/functions/grp-lookup/index.ts` — гос. реестр.
- `code: supabase/functions/import-contacts-gc/index.ts` — GetCourse импорт (проверить в Phase 1 — может касаться компаний).
- `code: supabase/functions/manychat-inbound/index.ts` — ManyChat.

## 6. Решение по поиску компаний

- **Phase 1:** добавить companies к `search_global` (extend без breaking change) + новый RPC `search_companies(_filters jsonb)` для admin-таблицы `AdminCompanies` (пагинация, фильтры по статусу, УНП, стране, is_default_billing).
- **Отвергнуто:** унифицированный `search_entities` (см. freeze §Deferred D2). Причина: нет reuse-сайтов, потребует переделки всех admin-списков.
- **Reuse:** `crm_task_list` через jsonb-фильтр `company_id` — Phase 6.

## 7. Отсутствующие сейчас пути (нужны в Phase 1–7)

| Путь | Стадия | Комментарий |
|---|---|---|
| `search_companies(_filters)` | Phase 2 | admin-таблица |
| `company_upsert_from_billing(_client_legal_details_id)` | Phase 3 (backfill) | идемпотентно, использует `company_sync_queue` |
| `company_link_contact(_company_id, _profile_id, _role)` | Phase 5 | manual + auto |
| `company_merge(_source_id, _target_id)` | Phase 7/9 | admin action |
| `company_archive(_id, _reason)` | Phase 7 | admin action |

Все — SECURITY DEFINER, RLS-safe, с audit-инсертами.
