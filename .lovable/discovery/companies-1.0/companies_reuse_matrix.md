# companies_reuse_matrix.md

Матрица «блок Companies → существующее → вердикт». Легенда:

- **REUSE** — использовать как есть.
- **REUSE+PROPS** — использовать с новыми пропсами (без правки сигнатуры).
- **EXTRACT** — вынести shared-примитив (deferred, не блокирует Phase 1).
- **REFACTOR-FIRST** — требуется рефакторинг до использования (deferred).
- **NEW** — создать с нуля, аналога нет.

## Данные (БД)

| Блок | Существующее | Ссылка | Вердикт |
|---|---|---|---|
| Компания (canonical) | нет | — | NEW: `companies` |
| Связь profile↔company | нет | — | NEW: `company_contacts` |
| Маппинг legacy | нет | — | NEW: `client_legal_details_company_map` |
| Билинг реквизитов (compat) | `client_legal_details` | `db: public.client_legal_details` | REUSE (compat SoT, не переписываем) |
| Реквизиты юрлиц | `legal_entities_requisites` | `db: public.legal_entities_requisites` | REUSE — источник только `subject_type IN ('legal_entity','entrepreneur')` для system_customer; для company auto-source **не** используется (по инварианту) |
| Гос. реестр | `grp_*` в `client_legal_details` + `grp-lookup` | `code: supabase/functions/grp-lookup/index.ts` | REUSE через canonical companies.grp_* |
| Очередь синхронизации | `notification_outbox`, `domain_events`, специализированные queues | `db: public.notification_outbox` | NEW: `company_sync_queue` (см. `companies_architecture_freeze.md` §5) |
| Activity | `crm_activity_log` | `db: public.crm_activity_log` | REUSE, `source_entity_type='company'` |
| Domain events | `domain_events` / `domain_executions` | `db: public.domain_events` | REUSE, `event_type='company.*.v1'` |
| Audit | `audit_logs` | `db: public.audit_logs` | REUSE, `entity_type='company'` |
| Public ID | `public_id_sequences` + `generate_admin_catalog_public_id` | `db: public.public_id_sequences` | REUSE (`prefix='co'` для company) |
| RLS helper | `has_role_v2(uuid,text)` | `db: public.has_role_v2` | REUSE |
| Ownership tenants | `tenants` (single-deployment SYSTEM) | см. `.lovable/discovery/crm-tasks-diagnose.md` | REUSE (`workspace_id` DEFAULT SYSTEM) |

## RPC / поиск

| Блок | Существующее | Ссылка | Вердикт |
|---|---|---|---|
| Глобальный поиск | `search_global`, `search_deal_rows`, `search_club_members_enriched` | `rpc: public.search_global`, `search_deal_rows` | REUSE + extend: добавить companies в `search_global`; отдельный `search_companies` для admin-таблицы |
| Task list | `crm_task_list` | `code: src/hooks/useCrmTasks.ts:L60-L83` | REUSE (в Phase 1 задачи компании не создаются; в Phase 6 добавить фильтр `company_id`) |

## UI

| Блок | Существующее | Ссылка | Вердикт |
|---|---|---|---|
| Sheet primitive | shadcn `SheetContent` | `code: src/components/admin/DealDetailSheet.tsx:L17,L539` | REUSE |
| Tabs primitive | shadcn `Tabs`/`TabsList`/`TabsTrigger` | `code: src/components/admin/ContactDetailSheet.tsx:L26,L1754-L1787` | REUSE |
| DetailSheet shell (Contact/Deal) | `ContactDetailSheet.tsx` (4074 строки), `DealDetailSheet.tsx` (1371 строки) | те же | EXTRACT (deferred) — паттерн копируется, но общий wrapper не извлекать в этот спринт |
| Timeline | `crm_activity_log` → `ContactFeedTab.tsx` | `code: src/components/admin/contact/ContactFeedTab.tsx` | REUSE+PROPS (передать `entity_type/entity_id`) |
| Tasks section | `CrmTasksSection.tsx`, `TasksListView.tsx` | `code: src/components/admin/tasks/CrmTasksSection.tsx` | REUSE+PROPS (Phase 6, не Phase 1) |
| Calls section | `CallsHistorySection.tsx` | `code: src/components/admin/calls/CallsHistorySection.tsx` | REUSE+PROPS (Phase 6) |
| Documents | `admin_docs`, `document_package_sessions` + UI | — | REUSE как есть; в Phase 10 — совместимость |
| Deals list в контакте | `ContactDealsTab.tsx`, `bepaid/ContactDealsDialog.tsx` | `code: src/components/admin/contact/ContactDealsTab.tsx` | REUSE+PROPS |
| Bulk actions | `KanbanBulkActionsBar.tsx`, `TasksBulkActionsBar.tsx` | `code: src/components/admin/deals/KanbanBulkActionsBar.tsx` | REUSE (паттерн) |
| Filters bar | `DealsFiltersBar.tsx`, `tasks/filters/*` | `code: src/components/admin/deals/DealsFiltersBar.tsx` | REUSE (паттерн) |
| Toolbar / search input | shadcn Input + `useDealsFilters` | `code: src/hooks/useDealsFilters.ts` | REUSE (паттерн) |

## Hooks / services

| Блок | Существующее | Ссылка | Вердикт |
|---|---|---|---|
| Tasks | `useCrmTasks`, `useCrmTaskTypes`, `useCrmTaskAutomationRules`, `useDealTaskSummary`, `useTaskRelations` | `code: src/hooks/useCrmTasks.ts`, `src/hooks/useTaskRelations.ts` | REUSE (расширять в Phase 6) |
| Deals | `useDealsBoard`, `useDealsFilters`, `useDealsBulkDelete` | `code: src/hooks/useDealsBoard.ts` | REUSE |
| Contacts | `useLiveContactSheet`, `useContactArtifacts`, `useContactInstallmentsData` | `code: src/hooks/useLiveContactSheet.ts` | REUSE |
| Permissions | `useRbac`, `usePermissions`, `has_role_v2` | `code: src/hooks/useRbac.ts` | REUSE |
| Integrations | `useIntegrationSync` | `code: src/hooks/useIntegrationSync.tsx` | REUSE (AmoCRM adapter) |

## Edge functions / integrations

| Блок | Существующее | Ссылка | Вердикт |
|---|---|---|---|
| AmoCRM webhook | `amocrm-webhook` | `code: supabase/functions/amocrm-webhook/index.ts:L40, L93-L96, L396-L409` | REUSE как anti-corruption layer; **не** заводит canonical companies (см. freeze §7) |
| AmoCRM sync | `integration-sync` | `code: supabase/functions/integration-sync/index.ts:L378, L449-L453` | REUSE как ACL; canonical `companies` не создаются автоматически из Amo |
| GRP lookup | `grp-lookup` | `code: supabase/functions/grp-lookup/index.ts` | REUSE |
| Sync worker | нет для entities | — | NEW: `company-sync-worker` |

## Что **запрещено** дублировать

- Timeline: не писать `CompanyTimeline`, использовать `ContactFeedTab.tsx` через параметры entity.
- Tasks: не писать `CompanyTasks`, использовать существующую Task Infrastructure.
- Calls: не писать `CompanyCalls`, использовать `CallsHistorySection.tsx`.
- Search: не создавать `search_entities` (см. freeze §Deferred D2); отдельный `search_companies` — допустимо.
- Queue: не пере-использовать `notification_outbox` для data-sync (см. freeze §Rejected X1).
- Legal data: не создавать третий SoT реквизитов; canonical — `companies`, legacy — `client_legal_details` (compat).
