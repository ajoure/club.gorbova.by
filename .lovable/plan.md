

# План: PATCH 1.0 — ENV DISCOVERY (read-only) + Anti-Duplication Gate v2

## Scope

**ТОЛЬКО read-only discovery.** Никакого DDL, ни одного нового файла кода, ни одного изменения existing функций/RPC/cron. Цель — полная карта существующего контура + reuse-matrix как hard-stop перед PATCH 1.1.

## Этап 1. DB discovery

**1.1.** Через `supabase--read_query` собрать:
- Таблицы по маскам: `instagram_*`, `integration_*`, `manychat_*`, `inbox_*`, `messages*`, `conversations*`, `threads*`, `media_*`, `attachments*`, `contact_*`, `provider_*`
- Колонки, FK, индексы (включая **partial indexes**), enum (`provider_kind`, `message_type`, `direction`)
- **CHECK constraints** через `pg_constraint`
- **Generated columns** через `information_schema.columns`
- RLS policies
- RPC: `pg_proc` filter по `instagram|inbox|integration|media|merge|dedup`
- Cron jobs: `cron.job` связанные с интеграциями

## Этап 2. Edge functions discovery

**2.1.** Через `code--list_dir supabase/functions/` + `code--search_files`. Для каждой релевантной функции (`instagram-*`, `integration-*`, `manychat-*`, media workers) заполнить таблицу:

| function | ingress type | auth model | service-role usage | retry/idempotency | writes to tables | emits domain_events / direct write |

Это нужно для проверки соответствия domain isolation и anti-duplication.

## Этап 3. UI discovery

**3.1.** Поиск:
- Existing integration card pattern (`/admin/integrations`, `useIntegrations`, `IntegrationCard`)
- Existing settings dialog/page для интеграций
- Existing field mapping UI
- Existing event log UI
- Existing inbox / contact center: компоненты, hooks, routing, **provider badges / discriminators** (для mixed-provider mode)
- Existing test actions pattern

## Этап 4. Provider identity bridge discovery

**4.1.** Искать:
- Таблицы-бриджи `external_id ↔ contact` (`contact_identifiers`, `provider_subscribers`, etc.)
- **Manual merge code, confidence score, duplicate review queue** — чтобы не задублировать existing merge pipeline
- RPC/функции по match-логике

## Этап 5. Media pipeline discovery

**5.1.** Собрать:
- Storage buckets (`storage.buckets`) + private/public policy
- Workers (по образцу `telegram-media-worker`)
- **Signed URL pattern**
- **Dedup/storage naming strategy**
- **Fallback path** для media недоступного по URL
- Как сейчас обрабатываются image/video/audio в Instagram inbox

## Этап 6. Existing docs / prior ManyChat artifacts inventory

**6.1.** Через `code--list_dir docs/integrations/manychat/` + `code--view`:
- Полный список существующих файлов PATCH 0
- Что зафиксировано (контракты, JSON envelope, security model, capability matrix)
- Что нужно reuse, что extend, что заменить
- Защита от дублирования документов и повторного изобретения контрактов

## Этап 7. ManyChat API probe (read-only)

**7.1.** Через `supabase--curl_edge_functions` к `manychat-diagnose-capture` или прямой curl. Заполнить **endpoint normalization table**:

| endpoint | method | auth type | required params | status | body shape | подходит для healthcheck/catalog/subscriber/send | примечание (404 = wrong path / 400 = missing param) |

Тестировать минимум: `/page/getInfo`, `/fb/page/getInfo`, `/page/getFlows`, `/page/getTags`, `/page/getCustomFields`, `/subscriber/getInfo`, `/subscriber/findByName`. Зафиксировать endpoint-aware rate limits.

## Этап 8. REUSE MATRIX (anti-duplication gate)

Артефакт: `docs/integrations/manychat/reuse-matrix.md`. Минимум **16 областей**:

| Область | Existing artifact | Решение | Обоснование (file/table ref) |
|---|---|---|---|
| Карточка интеграции | … | reuse / extend / new + proof |
| Settings UI | … | … |
| Field mapping UI | … | … |
| Event log UI | … | … |
| Inbox storage | `instagram_messages` | extend add-only через `provider_kind` | … |
| Inbox provider badges | … | reuse / new + proof |
| Subscriber identity bridge | … | reuse / new + proof |
| **Identity merge pipeline** | … | reuse / new + proof |
| Media pipeline | … | … |
| Healthcheck framework | `integration-healthcheck` | extend | один endpoint multi-provider |
| Send routing | `instagram-admin-chat` | extend / new |
| Sync framework | `integration-sync` | extend | вместо cache-таблиц |
| **Catalog storage (flows/tags/fields)** | Public API | **default: on-demand read через Public API + optional existing sync framework**. Cache-таблицы запрещены без proof of perf blocker |
| **Domain event infrastructure** | `DomainEventService` (`src/lib/domain-events.ts`) | reuse as-is | стандартный emit/recordExecution |
| **Scheduler / cron reuse** | existing cron jobs | reuse / new + proof |
| **Docs / prior PATCH 0 artifacts** | 6 файлов в `docs/integrations/manychat/` | reuse / update | без дублирования |
| RBAC | inherit existing pattern | new только при подтверждённом gap |

Каждая ячейка `new` обязана содержать ссылку на конкретный existing файл/таблицу + причину невозможности reuse.

## Этап 9. Hard stop-guards

Зафиксировать письменно:

- ❌ Запрет создавать `manychat_flows_cache`, `manychat_tags_cache`, `manychat_fields_cache` без proof of perf/UX blocker
- ❌ Запрет создавать `manychat_subscribers` если есть existing provider-identity bridge
- ❌ Запрет новой страницы settings если existing dialog покрывает
- ❌ Запрет нового storage bucket для media если existing path работает
- ❌ Запрет нового inbox storage — только `instagram_messages` extension через `provider_kind='manychat'`
- ❌ Запрет multi-channel в v1 (только Instagram)
- ❌ Запрет новых RLS правил без gap
- ❌ Запрет healthcheck на `/me` без подтверждения probe
- ❌ **Запрет проектировать новый merge-flow `subscriber↔contact`, пока не доказано отсутствие existing merge mechanism**
- ❌ **Запрет новой event-ingest таблицы, если existing `domain_events` / logs / raw_payload storage покрывают нужный ingress**

## Этап 10. Документация (артефакты PATCH 1.0)

- `docs/integrations/manychat/reuse-matrix.md` — главный артефакт
- `docs/integrations/manychat/existing-environment-reused.md` — конкретные файлы/таблицы/функции/компоненты
- `docs/integrations/manychat/api-probe-findings.md` — endpoint normalization table + реальные ответы
- **`docs/integrations/manychat/gap-register.md`** — только подтверждённые gaps, требующие extend/new в PATCH 1.1
- Update `README.md` — ссылка на reuse-matrix как обязательный gate
- Update `capability-matrix.md` — заменить cache-таблицы на «existing sync framework / on-demand»
- Update `compatibility-report.md` — жёсткие границы real-time

## Этап 11. DoD PATCH 1.0

1. `reuse-matrix.md` заполнен по всем 16+ областям с явным решением
2. Каждый `new` имеет proof of impossibility со ссылкой на код
3. `existing-environment-reused.md` перечисляет конкретные артефакты
4. `api-probe-findings.md` содержит endpoint normalization table с реальными ответами
5. `gap-register.md` содержит только подтверждённые gaps
6. README ссылается на reuse-matrix как обязательный gate перед PATCH 1.1
7. **Подтверждение**: за PATCH 1.0
   - не создано ни одной таблицы / функции / UI компонента
   - **не изменено ни одной существующей функции**
   - **не изменён ни один SQL / RPC / cron job**
   - **все выводы подтверждены ссылками на конкретные файлы / таблицы / queries**

## Этап 12. Финальный отчёт PATCH 1.0 (структура)

Обязательные блоки:
1. **Confirmed reuse** — что точно переиспользуется как есть / extend
2. **Confirmed gaps** — что реально требует new
3. **Deferred / out of scope** — что отложено
4. **Hard-stop guards status** — каждый guard: соблюдён / нарушен (если нарушен — почему)
5. **What PATCH 1.1 is allowed to touch** — закрытый список разрешённых артефактов

## Порядок execute (после approve)

1. DB discovery (read_query) — таблицы, колонки, индексы, CHECK, generated, RLS, RPC, cron
2. Edge functions discovery (list_dir + search_files + view) — заполнение таблицы по 6 признакам
3. UI discovery (search_files + view) — карточки, settings, mapping, event log, inbox badges
4. **Existing docs / prior artifacts inventory** (list_dir docs/integrations/manychat/ + view)
5. ManyChat API probe (curl_edge_functions / прямой fetch) — endpoint normalization table
6. Заполнение reuse-matrix (16+ областей)
7. Создание/обновление 7 документов
8. Финальный отчёт по структуре из этапа 12

## Что будет в PATCH 1.1

Только то, что `gap-register.md` пометил как подтверждённый gap, а reuse-matrix — как `extend` или `new + proof`. Без PATCH 1.0 артефактов → PATCH 1.1 заблокирован.

