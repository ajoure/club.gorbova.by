# PATCH 1.0 — Existing Environment Reused

**Статус:** ✅ done (`2026-04-19`)
**Назначение:** конкретный inventory того, что ManyChat-интеграция переиспользует, чтобы будущие итерации не задублировали artifacts.

---

## A. Tables (reuse 1:1 + add-only extend)

| Table | Role | Operation в PATCH 1.1 |
|---|---|---|
| `integration_instances` | Источник истины для всех инстансов интеграций | `ADD COLUMN config_secrets jsonb` (A1) |
| `integration_logs` | Generic event/audit log per instance (admin RLS, indexed `created_at DESC`) | reuse as-is (для outbound + ingress audit) |
| `integration_sync_logs` | Sync results per entity (CHECK `result IN ('success','error','skipped')`) | reuse as-is (для ManyChat catalog sync) |
| `integration_sync_settings` | Per-entity sync config (UNIQUE `(instance_id, entity_type)`) | reuse as-is |
| `integration_field_mappings` | Universal field map UNIQUE `(instance_id, entity_type, project_field)` | reuse as-is для subscriber custom fields |
| `instagram_accounts` (1 row) | Per-instance IG account (UNIQUE `(integration_instance_id, instagram_page_id)`) | `ADD COLUMN provider_kind` (A2) |
| `instagram_contacts` (UNIQUE `(account_id, instagram_user_id)`) | Provider-identity bridge IG ↔ profile_id | `ADD COLUMN provider_kind` (A4) |
| `instagram_messages` (29 rows, UNIQUE `(account_id, external_message_id)`, partial idx `is_read=false`, `idx_ig_msg_peer_dialog`) | Inbox storage с CHECK `direction IN ('inbound','outbound')` | extend 6 columns + 3 partial indexes (A3) |
| `manychat_diagnose_log` (RLS superadmin only) | Diagnose-only capture buffer | reuse as-is (НЕ переименовываем, НЕ promo'тим в production) |
| `media_jobs` | Generic media worker queue (RPC `claim_media_jobs`, `unlock_stuck_media_jobs`) | reuse as-is для ManyChat media (с `provider_kind` dispatcher) |
| `domain_events`, `domain_executions` | Asynchronous downstream pipeline | reuse as-is (`emitEvent('manychat.*.v1')`) |
| `client_duplicates`, `merge_history`, `duplicate_cases` | Identity merge engine | reuse as-is |
| `audit_logs` | Critical actions audit (server-side mandate) | reuse as-is |

---

## B. Edge functions (reuse / extend)

| Function | Reuse type | Note |
|---|---|---|
| `integration-healthcheck` | **extend** (add `case "manychat"`) | A6 |
| `integration-sync` | **extend** (add `case "manychat"`) | A8 |
| `instagram-admin-chat` | **extend** (`sendReply()` branch by `provider_kind`) | A7 |
| `instagram-webhook` | reuse as-is | ApiX-Drive остаётся, ManyChat ingress = отдельная функция в PATCH 1.1 (или extension `integration-logs` ingress) |
| `manychat-diagnose-capture` | **reuse as-is** | НЕ переименовываем (см. README.md) |
| `merge-clients`, `unmerge-clients`, `detect-duplicates` | reuse as-is | Identity merge pipeline |
| `telegram-media-worker(-cron)` | **pattern reuse** | Шаблон media worker. ManyChat media — клон с минимальными правками (PATCH 1.1 / PATCH 2) |

---

## C. RPCs (reuse / extend)

| RPC | Reuse type | Note |
|---|---|---|
| `has_role_v2(_user_id, _role_code)` | reuse as-is | RBAC во всех новых operations |
| `has_permission(uid, key)` | reuse as-is | RLS на `integration_*` |
| `get_instagram_dialogs_v1(p_account_id)` | **extend** (return + `provider_kind`) | A9 |
| `instagram_outbox_pull_v1` | reuse as-is | Outbound queue для ApiX (ManyChat сразу POST через API без outbox в v1) |
| `claim_media_jobs`, `unlock_stuck_media_jobs` | reuse as-is | Generic media worker pattern |
| `get_inbox_dialogs_v1` | reuse as-is | Уже multi-source aggregator |

---

## D. UI components (reuse 1:1)

| Component | Reuse type |
|---|---|
| `src/hooks/useIntegrations.tsx` (`PROVIDERS[]`, `useIntegrations`, `useIntegrationMutations`) | extend (add row) — A5 |
| `src/components/integrations/IntegrationProviderCard.tsx` | reuse as-is (auto-renders из `PROVIDERS[]`) |
| `src/components/integrations/IntegrationInstanceList.tsx` | reuse as-is |
| `src/components/integrations/IntegrationSyncSettingsDialog.tsx` | reuse as-is для catalog/mapping/logs view |
| `src/components/integrations/FieldMappingDialog.tsx` | reuse as-is |
| `src/components/integrations/WebhookMonitoringPanel.tsx` | reuse as-is для External Request log view |
| `src/components/integrations/WebhookUrlDisplay.tsx` | reuse as-is для отображения ingest URL |
| `src/components/admin/communication/instagram/InstagramInboxView.tsx` | extend (provider badge) — A10 |
| `src/components/admin/communication/instagram/ContactInstagramChat.tsx` | reuse as-is (отрисовка messages не зависит от provider) |
| `src/components/admin/communication/InboxTabContent.tsx` | reuse as-is (tab routing уже multi-channel) |

---

## E. Storage buckets (reuse)

| Bucket | Public | Reuse |
|---|---|---|
| `telegram-media` | private | **candidate reuse** для ManyChat media (либо введение generic `provider-media` если докажется коллизия семантики) |
| `avatars` | public | reuse для подписчиков, если потребуется |

> Создание нового ManyChat-bucket запрещено без отдельного proof of impossibility.

---

## F. Cron / Scheduler (reuse pattern)

Pattern: `cron.job` через `pg_cron` + `net.http_post(url, headers, body)` к edge function. Все 10+ существующих cron-jobs следуют этому шаблону.

| Существующий job (образец) | Schedule | Pattern |
|---|---|---|
| `nightly-system-health-hourly` | `0 * * * *` | `net.http_post → /functions/v1/nightly-system-health` |
| `payments-reconcile-evening` | `0 18 * * *` | `net.http_post → /functions/v1/payments-reconcile` |
| `webinar-activity-consumer` | `* * * * *` | `net.http_post → /functions/v1/webinar-activity-consumer` |

ManyChat off-flow pull-diff в PATCH 2 = **одна** новая `cron.job` строка по тому же паттерну. Никаких новых scheduler-frameworks.

---

## G. RLS / RBAC (inherit pattern)

Все новые add-only колонки на `instagram_*` и `integration_*` наследуют существующие policies:
- `Admin access instagram_*` (`has_role_v2('admin' or 'super_admin')` для authenticated)
- `Service role access instagram_*` (full для service_role)
- `Admins can manage integration instances` (`has_permission('entitlements.manage')`)

Новых policies не требуется (gap не подтверждён).

---

## H. Docs (reuse)

| Doc | Reuse type |
|---|---|
| `README.md` | extend (add link to `reuse-matrix.md` as gate) |
| `capability-matrix.md` | minor update (catalog storage = on-demand, не cache-таблицы) |
| `compatibility-report.md` | minor update (provider-identity bridge = `instagram_contacts`, не новая таблица) |
| `external-request-setup.md` | reuse as-is |
| `diagnose-payloads.md` | reuse as-is (live capture pending) |
| `windowing-proof.md` | reuse as-is (live tests pending) |
| `reuse-matrix.md` | **новый — главный gate** |
| `gap-register.md` | **новый — closed allow-list** |
| `existing-environment-reused.md` | **новый — этот файл** |
| `api-probe-findings.md` | **новый — endpoint normalization** |

---

## I. Что **НЕ** переиспользуется (явно)

| Слой | Решение |
|---|---|
| Telegram bot infrastructure (`telegram_bots`, `telegram_clubs`, `telegram-webhook`) | Не переиспользуется, другая семантика |
| Email accounts (`email_accounts`, `send-email`) | Не переиспользуется (другой канал) |
| ApiX-Drive flow (`apix_instagram_dm` provider) | **Не трогаем**, остаётся legacy. ManyChat — отдельный provider в `PROVIDERS[]` |
