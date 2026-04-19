# PATCH 1.0 — Gap Register (Confirmed Gaps Only)

**Статус:** ✅ done (`2026-04-19`)
**Назначение:** закрытый список того, что PATCH 1.1 **разрешено** создать или изменить. Всё остальное — нарушение anti-duplication gate.

> Каждый gap = (а) подтверждённое отсутствие в existing environment + (б) ссылка на проверку в `reuse-matrix.md` + (в) точная operation type.

---

## A. Confirmed gaps (PATCH 1.1 allow-list)

### A1. `integration_instances.config_secrets jsonb`
- **Operation:** `ALTER TABLE … ADD COLUMN config_secrets jsonb DEFAULT '{}'::jsonb`
- **Why:** существующий `config jsonb` не разделяет publishable / secret поля. Для `MANYCHAT_API_KEY` и `X-Workspace-Token` нужен encrypted-at-rest канал
- **Reuse-matrix ref:** строка #2
- **Proof:** колонки `integration_instances` подтверждены через `information_schema.columns`; `config_secrets` отсутствует
- **Backfill:** не требуется (default `'{}'`)

### A2. `instagram_accounts.provider_kind text`
- **Operation:** `ALTER TABLE … ADD COLUMN provider_kind text NOT NULL DEFAULT 'apixdrive' CHECK (provider_kind IN ('apixdrive','manychat'))`
- **Why:** discriminator для mixed-provider mode на 1 таблице
- **Reuse-matrix ref:** строка #6
- **Proof:** колонка отсутствует (8 текущих колонок)

### A3. `instagram_messages` extension (5 колонок add-only)
- **Operations:**
  - `ADD COLUMN provider_kind text NOT NULL DEFAULT 'apixdrive' CHECK (...)`
  - `ADD COLUMN provider_message_id text`
  - `ADD COLUMN thread_key text`
  - `ADD COLUMN idempotency_hash text`
  - `ADD COLUMN sent_at timestamptz`
  - `ADD COLUMN delivered_at timestamptz`
- **Indexes:**
  - `CREATE UNIQUE INDEX … ON instagram_messages (instagram_account_id, provider_kind, provider_message_id) WHERE provider_message_id IS NOT NULL`
  - `CREATE INDEX … ON instagram_messages (idempotency_hash) WHERE idempotency_hash IS NOT NULL`
  - `CREATE INDEX … ON instagram_messages (thread_key) WHERE thread_key IS NOT NULL`
- **Reuse-matrix ref:** строка #6
- **Proof:** колонки отсутствуют в 21-column current schema; индексы подтверждены через `pg_indexes`
- **Backfill:** не требуется (29 legacy строк получают `provider_kind='apixdrive'` через DEFAULT)

### A4. `instagram_contacts.provider_kind text`
- **Operation:** `ALTER TABLE … ADD COLUMN provider_kind text NOT NULL DEFAULT 'apixdrive' CHECK (provider_kind IN ('apixdrive','manychat'))`
- **Why:** существующий contact-bridge становится мульти-провайдерным (см. строка #8 reuse matrix)
- **Reuse-matrix ref:** строка #8
- **Proof:** UNIQUE `(instagram_account_id, instagram_user_id)` достаточен для уникальности при том же `provider_kind`. Если в будущем `instagram_user_id` коллидирует между `apixdrive` и `manychat` — пересмотрим UNIQUE на `(instance, provider_kind, instagram_user_id)`

### A5. PROVIDERS[] entry для ManyChat
- **Operation:** добавить запись в `src/hooks/useIntegrations.tsx` `PROVIDERS[]` (после `apix_instagram_dm`)
- **Fields:** `api_key` (password, required), `manychat_page_id` (text, required), `workspace_token` (password, optional — генерируется), `allowed_page_ids` (textarea, optional)
- **Reuse-matrix ref:** строка #1
- **Proof:** существующий registry, расширение add-only

### A6. `integration-healthcheck` extension
- **Operation:** добавить `case "manychat"` в существующий switch (lines ~96+, см. `supabase/functions/integration-healthcheck/index.ts`)
- **Probe:** `GET https://api.manychat.com/fb/page/getInfo` с `Authorization: Bearer <config_secrets.api_key>` → 200 OK + parse `data.is_pro`
- **Reuse-matrix ref:** строка #11
- **Proof:** capability-matrix.md probe `2026-04-19T08:27:31Z` подтвердил endpoint работает (26 ms)

### A7. `instagram-admin-chat` send routing extension
- **Operation:** в функции `sendReply()` добавить ветку `if (account.provider_kind === 'manychat') { ... }` → POST `/fb/sending/sendContent`
- **Reuse-matrix ref:** строка #12
- **Proof:** существующая функция уже handles мульти-action (`get_history`, `send_reply`, `mark_read`, `get_accounts`)
- **Изменение существующей функции:** ✅ allowed только в этом scope

### A8. `integration-sync` catalog extension
- **Operation:** в существующий switch по `provider` добавить `case "manychat"` → on-demand pull `getFlows`/`getTags`/`getCustomFields` → upsert в `integration_instances.config.catalog_snapshot jsonb`
- **Reuse-matrix ref:** строка #13
- **Proof:** функция уже мульти-провайдерная (getcourse + amocrm cases)
- **NB:** запись в `integration_sync_logs` через existing `logSync()` хелпер

### A9. RPC `get_instagram_dialogs_v1` extension
- **Operation:** добавить `provider_kind text` в return columns (DEFAULT `'apixdrive'` для legacy)
- **Reuse-matrix ref:** строка #7
- **Proof:** RPC подтверждена через `pg_proc`. UI не имеет provider-discriminator

### A10. `InstagramInboxView` provider badge
- **Operation:** добавить badge `<Badge>ManyChat</Badge>` в карточку диалога если `dialog.provider_kind === 'manychat'`
- **Reuse-matrix ref:** строка #7
- **Proof:** компонент существует, расширение визуальное

---

## B. Conditional gap (требует pre-execute proof в PATCH 1.1)

### B1. `integration_inbound_events` table
- **Status:** ⚠️ **не подтверждён как gap.**
- **Why conditional:** изначальный план PATCH 0 (compatibility-report.md §E) предусматривал отдельный буфер для ingress. Однако:
  - existing `integration_logs` имеет `payload_meta jsonb` + `event_type` — **может покрыть** ingress storage
  - `domain_events` infrastructure через `DomainEventService.emitEvent` обеспечивает асинхронный pipeline
  - **dedup UNIQUE** можно добавить отдельным constraint поверх `integration_logs (event_type, payload_meta->>'idempotency_hash')` через partial UNIQUE INDEX
- **Decision required в PATCH 1.1 dry-run:** проверить, выдержит ли `integration_logs` нагрузку External Request (RPS, размер payload, retention). Если **нет** — создать `integration_inbound_events` как новый artifact с обоснованием. Если **да** — extend `integration_logs` через partial UNIQUE INDEX
- **Proof of impossibility (для new):** должен быть приложен в PATCH 1.1 plan, иначе hard-stop

---

## C. Deferred / out of scope (PATCH 1.1 НЕ трогает)

| # | Item | Reason | Phase |
|---|---|---|---|
| C1 | ManyChat App / OAuth / Marketplace | Требует регистрации, модерации Manychat. v1 = только Public API + External Request | Phase 2+ |
| C2 | Generic `communications_*` layer | Multi-channel (FB/WA/TG через ManyChat) deferred — в v1 только Instagram | Phase 2 |
| C3 | Native ManyChat Inbox parity (mirror оператора, typing, presence) | Out of scope External Request | Phase 2 (только через App OAuth) |
| C4 | HMAC signature verification | ManyChat не подписывает External Request | Phase 2 (через App OAuth payload signing) |
| C5 | Cron-based off-flow diff sync | PATCH 2 (после PATCH 1.1 stable) | PATCH 2 |
| C6 | Dynamic Block (inline response) | PATCH 4 | PATCH 4 |
| C7 | Pause Automation TTL via direct API | PATCH 2/4 | После live test (windowing-proof.md) |
| C8 | Auto-create custom fields bootstrap | PATCH 1.1 follow-up или PATCH 2 | TBD |
| C9 | Triggers / Growth Tools API | PATCH 4 | PATCH 4 |

---

## D. Hard-stop guards status (PATCH 1.0)

| Guard | Статус | Подтверждение |
|---|---|---|
| Запрет `manychat_*_cache` таблиц | ✅ соблюдён | Не создавалось; решение «on-demand + optional snapshot в config jsonb» зафиксировано |
| Запрет `manychat_subscribers` | ✅ соблюдён | Решение использовать `instagram_contacts.provider_kind` |
| Запрет новой страницы settings | ✅ соблюдён | Reuse существующего `IntegrationInstanceList` + `IntegrationSyncSettingsDialog` |
| Запрет нового storage bucket | ✅ соблюдён | Решение reuse `telegram-media` либо PATCH 1.1 proof |
| Запрет нового inbox storage | ✅ соблюдён | Только extension `instagram_messages` |
| Запрет multi-channel в v1 | ✅ соблюдён | Instagram-only |
| Запрет новых RLS без gap | ✅ соблюдён | Inherit existing pattern |
| Запрет healthcheck `/me` | ✅ соблюдён | Используется `/fb/page/getInfo` (подтверждённый probe) |
| Запрет нового merge-flow | ✅ соблюдён | Reuse `merge-clients` + `client_duplicates` |
| Запрет новой event-ingest таблицы (без proof) | ⚠️ conditional | См. B1 — финальное решение в PATCH 1.1 dry-run |

---

## E. PATCH 1.1 closed allow-list (final)

PATCH 1.1 разрешено трогать **только** items A1–A10 + (условно) B1. Любое расширение = новый PATCH 1.0.
