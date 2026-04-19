# PATCH 1.0 — Reuse Matrix (Anti-Duplication Gate)

**Статус:** ✅ done (`2026-04-19`, read-only discovery)
**Owner:** integration engineer
**Назначение:** обязательный hard-stop gate перед PATCH 1.1. Любая попытка `new` без `proof of impossibility` ниже — нарушение Platform Bible (anti-duplication).

> Все ссылки — на реально существующие файлы/таблицы, проверенные через `code--view`/`supabase--read_query` 2026-04-19. Backfill ссылок при изменениях обязателен.

---

## Главная матрица (16 областей)

| # | Область | Existing artifact (file/table) | Решение | Обоснование / proof |
|---|---|---|---|---|
| 1 | Карточка интеграции | `src/hooks/useIntegrations.tsx` (`PROVIDERS[]`, line 54-180) + `src/components/integrations/IntegrationProviderCard.tsx` | **reuse as-is + extend (add row)** | Уже существует registry провайдеров с типизированной схемой полей. Достаточно добавить запись `{ id: "manychat", name: "ManyChat", icon: "MessageCircle", category: "socials", fields: [...] }` |
| 2 | Хранилище инстанса (config + secrets) | `integration_instances` (PK + `provider`, `category`, `config jsonb`, `status`, `last_check_at`, `error_message`) | **reuse as-is** для config; **add column `config_secrets jsonb`** для encrypted secrets | Текущая `config` jsonb хранит только publishable значения. Для `X-Workspace-Token` и `MANYCHAT_API_KEY` нужно отдельное Vault-encrypted поле. Это **единственный** add-only ALTER на существующей таблице |
| 3 | Settings UI (создать/редактировать) | `src/components/integrations/IntegrationInstanceList.tsx` + auto-form по `PROVIDERS[].fields` | **reuse as-is** | Существующий механизм генерирует форму из `fields[]` schema. ManyChat подключается **без** новой страницы — через тот же диалог. Новых компонентов не требуется |
| 4 | Field mapping UI | `src/components/integrations/IntegrationSyncSettingsDialog.tsx` + `src/components/integrations/FieldMappingDialog.tsx` + table `integration_field_mappings` (UNIQUE `(instance_id, entity_type, project_field)`) | **reuse as-is** | Универсальная таблица + готовый UI. ManyChat custom_fields → mapping `entity_type='subscriber'` с `project_field`/`external_field`. Никаких новых таблиц |
| 5 | Event log UI | `integration_logs` + `integration_sync_logs` (admin RLS, indexed `created_at DESC`) + `WebhookMonitoringPanel.tsx` | **reuse as-is** | События ingest (External Request) и outbound API calls пишутся в `integration_logs` с `event_type='manychat.*'`. Новая таблица не нужна |
| 6 | Inbox storage | `instagram_messages` (21 column, UNIQUE `(instagram_account_id, external_message_id)`, `direction CHECK`, partial index `is_read=false`, `idx_ig_msg_peer_dialog`) | **extend add-only через `provider_kind`** | См. compatibility-report.md §B/C. Колонки `external_message_id`, `peer_id`, `raw_payload`, `direction`, `media_url`/`media_type` уже покрывают ManyChat 1:1. Нужны только: `provider_kind text DEFAULT 'apixdrive'`, `provider_message_id text`, `thread_key text`, `idempotency_hash text` + partial UNIQUE/INDEX. **Новая таблица сообщений запрещена** |
| 7 | Inbox provider badges (mixed mode) | `src/components/admin/communication/instagram/InstagramInboxView.tsx` + RPC `get_instagram_dialogs_v1` | **extend в PATCH 1.1**: добавить `provider_kind` в return RPC + бейдж в карточке диалога | RPC возвращает 11 полей без `provider_kind`. UI не имеет provider-discriminator, потому что сейчас один источник. Расширение — add-only (новое поле в return, fallback `'apixdrive'`) |
| 8 | Subscriber identity bridge | **отсутствует в чистом виде.** Есть `instagram_contacts (instagram_account_id, instagram_user_id, profile_id)` UNIQUE по `(account, user_id)` | **reuse as-is + extend через `provider_kind`** | `instagram_contacts` — это **уже** provider-identity bridge для Instagram-контура. ManyChat subscriber = тот же `instagram_user_id` (через `ig_id` в payload). Достаточно добавить `provider_kind` discriminator. **Создание `manychat_subscribers` запрещено** (см. hard-stop) — это была бы параллельная сущность поверх существующей |
| 9 | Identity merge pipeline | `merge-clients/`, `unmerge-clients/`, `detect-duplicates/` edge functions + `client_duplicates`, `merge_history`, `duplicate_cases` tables | **reuse as-is** | Полноценный merge-движок с confidence/audit уже есть. ManyChat → `instagram_contacts.profile_id` → существующий merge-pipeline. **Новый merge-flow проектировать запрещено** |
| 10 | Media pipeline | `media_jobs` table + RPC `claim_media_jobs`, `unlock_stuck_media_jobs` + `telegram-media-worker(-cron)` edge functions + storage buckets `telegram-media` (private), `avatars` (public) | **reuse as-is + extend по provider_kind** | Generic worker pattern уже работает. ManyChat media → `media_jobs` с `provider_kind='manychat'`, тот же worker (или клон с минимальными правками в PATCH 1.1). **Новый bucket запрещён** — переиспользуем `telegram-media` или создаём `provider-media` универсальный, только если PATCH 1.1 докажет необходимость |
| 11 | Healthcheck framework | `supabase/functions/integration-healthcheck/index.ts` (546 строк, switch по `provider`, JWT superadmin guard, fetchWithTimeout 10s) | **extend (add `case "manychat"`)** | Существующий мульти-провайдер healthcheck. ManyChat case = GET `/fb/page/getInfo` с `Authorization: Bearer <api_key>` (подтверждённый endpoint, см. `api-probe-findings.md`). **Новая функция `manychat-healthcheck` запрещена** |
| 12 | Send routing | `supabase/functions/instagram-admin-chat/index.ts` (action='send_reply' + `sendReply()`) + outbox через `instagram_outbox_pull_v1` RPC | **extend в PATCH 1.1**: внутри `sendReply` ветка `if (account.provider_kind === 'manychat')` → POST `/fb/sending/sendContent` | UI уже вызывает `instagram-admin-chat`. Роутинг по `provider_kind` — изоляция в одной функции. **Новая `manychat-send` запрещена** |
| 13 | Sync framework (catalog) | `supabase/functions/integration-sync/index.ts` (switch по `provider`, читает `integration_sync_settings`, пишет `integration_sync_logs`) | **extend (add `case "manychat"`)** для on-demand sync flows/tags/custom_fields | Универсальный паттерн. ManyChat case → batch GET к Public API → нормализация в jsonb. Результат хранится в `integration_instances.config` (key `catalog_snapshot` с `synced_at`). **Cache-таблицы запрещены** — см. hard-stop |
| 14 | Catalog storage (flows/tags/fields) | По умолчанию: **on-demand read через Public API** (latency 22-36 ms на probe, см. capability-matrix). Optional snapshot в `integration_instances.config.catalog_snapshot jsonb` через existing `integration-sync` | **default: on-demand. Snapshot — optional через existing config jsonb** | Probe показал sub-50ms latency. Нет UX-блока для cache. Snapshot нужен только если PATCH 1.1 докажет: (а) >100ms latency на UI; (б) >10 запросов/мин с одного admin tab. **Создание `manychat_flows_cache`/`manychat_tags_cache`/`manychat_fields_cache` ЗАПРЕЩЕНО** |
| 15 | Domain event infrastructure | `src/lib/domain-events.ts` (`DomainEventService.emitEvent` / `recordExecution` / `updateExecution`) + tables `domain_events`, `domain_executions` | **reuse as-is** | Стандартный канонический lifecycle. Все downstream-эффекты ManyChat (CRM, access_rules) обязаны идти **только** через `emitEvent('manychat.message.received.v1', ...)`. Прямые cross-domain вызовы из ingress запрещены |
| 16 | Scheduler / cron reuse | Existing `cron.job` через `pg_cron` + `net.http_post` (10+ jobs: `nightly-system-health`, `payments-reconcile`, `webinar-activity-consumer`, etc.) | **reuse as-is**: для off-flow pull-diff в PATCH 2 добавить **одну** новую cron-запись (тот же паттерн `net.http_post → manychat-pull-diff`) | Шаблон cron установлен. Новый scheduler не нужен. Одна строка в `cron.job` через миграцию в PATCH 2 |
| + | **Docs / prior PATCH 0 artifacts** | `docs/integrations/manychat/`: `README.md`, `capability-matrix.md`, `compatibility-report.md`, `diagnose-payloads.md`, `external-request-setup.md`, `windowing-proof.md` | **reuse + targeted update** | 6 файлов уже зафиксировали: канонический envelope, security contract, DDL plan, endpoint normalization, NFR throttling. PATCH 1.0 артефакты только **дополняют**, не дублируют. См. update list ниже |
| + | RBAC | `has_role_v2(_user_id, _role_code)` + `has_permission(uid, 'entitlements.manage')` + service-role для edge functions. Существующие RLS policies на `instagram_*` (`Admin access`/`Service role access`) и на `integration_*` (`Admins can manage…`) | **inherit pattern** | Никаких новых ролей. Все новые объекты PATCH 1.1 (если будут) — те же `has_role_v2('admin')` + service-role для edge функций |

---

## Hard stop-guards (зафиксировано)

См. также раздел в `gap-register.md` для tracking violations.

- ❌ `manychat_flows_cache`, `manychat_tags_cache`, `manychat_fields_cache` — **запрещены без proof of perf/UX blocker** (probe latency 22-36 ms, нет блокера)
- ❌ `manychat_subscribers` — **запрещена**, есть `instagram_contacts` (provider-identity bridge через `provider_kind` discriminator)
- ❌ Новая страница `/admin/integrations/manychat/:id` — **запрещена**, существующий `IntegrationInstanceList` + `IntegrationSyncSettingsDialog` покрывают
- ❌ Новый storage bucket для ManyChat media — **запрещён без отдельного proof**, переиспользуем `telegram-media` (private) либо вводим generic `provider-media` только при доказанной коллизии семантики
- ❌ Новое inbox-хранилище сообщений — **запрещено**, только `instagram_messages` extension через `provider_kind='manychat'`
- ❌ Multi-channel в v1 (FB/WA/Telegram через ManyChat) — **запрещён**, только Instagram
- ❌ Новые RLS правила без подтверждённого gap — **запрещены**
- ❌ Healthcheck endpoint `/me` — **запрещён** (нет в Public API). Использовать **`GET /fb/page/getInfo`** (probe 200 OK, 26 ms, см. api-probe-findings.md)
- ❌ **Новый merge-flow `subscriber↔contact`** — **запрещён**, есть `merge-clients` + `client_duplicates` + `merge_history`
- ❌ **Новая event-ingest таблица** — **запрещена, если** `domain_events` + `integration_logs` (для raw payload + headers) покрывают ingress. Решение по `integration_inbound_events` пересмотрено: **в PATCH 1.1** проверяем, достаточно ли `integration_logs.payload_meta` + `domain_events`. Создание `integration_inbound_events` оставлено как **conditional gap** в `gap-register.md` — финальное решение по результатам PATCH 1.1 dry-run

---

## Подтверждение DoD PATCH 1.0

За PATCH 1.0:
- ✅ не создано ни одной таблицы
- ✅ не создано ни одной edge function
- ✅ не создано ни одного UI компонента
- ✅ не изменено ни одной существующей edge функции
- ✅ не изменён ни один SQL / RPC / cron job
- ✅ все выводы подтверждены ссылками на конкретные файлы/таблицы (см. колонку «Existing artifact»)
- ✅ запрос `supabase--read_query` к `pg_proc`, `pg_constraint`, `pg_indexes`, `cron.job`, `storage.buckets` подтверждает реальное состояние БД

---

## Что PATCH 1.1 разрешено трогать (closed list)

См. `gap-register.md` — **только** confirmed gaps оттуда. Любое расширение scope = новый PATCH 1.0 повторно.
