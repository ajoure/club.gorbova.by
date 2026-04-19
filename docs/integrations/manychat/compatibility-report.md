# 0.4. Compatibility Report — `instagram_*` & ApiX-Drive

**Статус:** ✅ DB introspection выполнен `2026-04-19T08:24Z`
**Owner:** integration engineer
**Источник данных:** прямой `read_query` к `information_schema.columns`

---

## Hard-stop

Любой breaking change ApiX-Drive flow запрещён. Все добавления — add-only с дефолтами для legacy.

---

## Source of truth for observability (контракт v1)

> Этот раздел — **обязательный контракт** для подрядчика. Никто не имеет права обещать Inbox parity или real-time observability вне Flow.

| Слой observability | Источник | Гарантия | Что **НЕ** покрывает |
|---|---|---|---|
| **Real-time observability** | **Только** External Request action из конкретных Flows / ветвей automation, куда мы сами врезали ingress-вызов | Доставка ≤ 10s от триггера, при условии работы Flow и нашего endpoint | Любые события из Flows без External Request; ручные действия оператора |
| **Off-flow observability** | **Только** pull/diff через Public API (`getSubscriberInfo`, `getTags`, `getCustomFields`) по cron | Latency = период cron (минуты, не секунды); фиксируется как diff с предыдущим snapshot | Real-time реакция; точное время события (только сам факт изменения) |
| **Native ManyChat Inbox actions** | — | **НЕ наблюдаются в v1.** Ручные ответы оператора в native ManyChat Inbox UI, статусы `delivered`/`read` оператора, typing-indicators — **out of scope** | Всё перечисленное в этой строке |

**Следствие для контракта с подрядчиком:**
- ❌ нельзя обещать «полную видимость переписки в платформе»;
- ❌ нельзя обещать «зеркало native Inbox в нашей админке»;
- ✅ можно обещать «события из tracked Flows real-time + snapshot периодики через pull».

---

## A. `instagram_accounts` — текущее состояние

| # | Column | Type | Nullable | Default |
|---|---|---|---|---|
| 1 | `id` | uuid | NO | `gen_random_uuid()` |
| 2 | `integration_instance_id` | uuid | NO | — |
| 3 | `instagram_page_id` | text | YES | — |
| 4 | `is_active` | boolean | NO | `true` |
| 5 | `status` | text | NO | `'active'` |
| 6 | `error_message` | text | YES | — |
| 7 | `created_at` | timestamptz | NO | `now()` |
| 8 | `updated_at` | timestamptz | NO | `now()` |

**Записей:** 1 (`@katerina.gorbova`, integration_instance_id `676c484b-2bcc-4f52-aec9-55e9ee8e938e`).

### Что отсутствует (требует add-only расширения в PATCH 1)

| Изменение | Тип | Migration plan |
|---|---|---|
| `provider_kind text` | NOT NULL DEFAULT `'apixdrive'` | `ALTER TABLE … ADD COLUMN provider_kind text NOT NULL DEFAULT 'apixdrive'` + `CHECK (provider_kind IN ('apixdrive', 'manychat'))` |
| `workspace_id uuid` | NULL → backfill | для multi-tenant; в v1 single-tenant можно отложить, но лучше сразу |

> **Замечание по multi-channel:** колонки `instagram_*` остаются **Instagram-only** compatibility-layer. Расширение на Messenger / WhatsApp / Telegram **не делается** через эти таблицы — для этого в Phase 2 заводится generic `communications_accounts` / `communications_messages`.

---

## B. `instagram_messages` — текущее состояние

| # | Column | Type | Nullable | Default |
|---|---|---|---|---|
| 1 | `id` | uuid | NO | `gen_random_uuid()` |
| 2 | `instagram_account_id` | uuid | NO | — |
| 3 | `external_message_id` | text | YES | — |
| 4 | `sender_id` | text | NO | — |
| 5 | `sender_name` | text | YES | — |
| 6 | `ig_thread_id` | text | YES | — |
| 7 | `direction` | text | NO | — |
| 8 | `message_text` | text | YES | — |
| 9 | `media_url` | text | YES | — |
| 10 | `media_type` | text | YES | — |
| 11 | `raw_payload` | jsonb | YES | — |
| 12 | `is_read` | boolean | NO | `false` |
| 13 | `read_at` | timestamptz | YES | — |
| 14 | `status` | text | NO | `'delivered'` |
| 15 | `error_message` | text | YES | — |
| 16 | `created_at` | timestamptz | NO | `now()` |
| 17 | `peer_id` | text | NO | — |
| 18 | `sent_by_admin` | uuid | YES | — |
| 19 | `recipient_id` | text | YES | — |
| 20 | `sending_at` | timestamptz | YES | — |
| 21 | `sending_lock_id` | uuid | YES | — |

**Записей:** 29. **`direction` уже NOT NULL** ✅ — переиспользуем 1:1.

### ✅ Можно переиспользовать без расширения

| Колонка | Используется как |
|---|---|
| `external_message_id` | будет = `message.provider_message_id` от ManyChat (idempotency приоритет 2) |
| `sender_id` / `peer_id` / `recipient_id` | = `manychat_subscriber_id` |
| `direction` | уже корректная семантика |
| `raw_payload` | jsonb уже есть — кладём raw External Request payload |
| `status` | расширяемый text — добавим `queued`, `sent`, `delivered`, `read`, `failed` |
| `read_at`, `media_url`, `media_type` | переиспользуем |

### ❌ Чего не хватает (add-only ALTER в PATCH 1)

| Колонка | Тип | Default | Назначение |
|---|---|---|---|
| `provider_kind` | text | `'apixdrive'` | Discriminator |
| `provider_message_id` | text | NULL | ID сообщения у ManyChat |
| `thread_key` | text | NULL | Детерминированный ключ треда |
| `sent_at` | timestamptz | NULL | Когда ManyChat подтвердил отправку |
| `delivered_at` | timestamptz | NULL | Когда дошло до Instagram |
| `idempotency_hash` | text | NULL | Anti-duplicate (priority 2/3) |

### Indexes / constraints (add-only)

| Объект | Назначение |
|---|---|
| `UNIQUE (instagram_account_id, provider_kind, provider_message_id) WHERE provider_message_id IS NOT NULL` | Idempotency для ManyChat |
| `INDEX (thread_key) WHERE thread_key IS NOT NULL` | Inbox группировка |
| `INDEX (idempotency_hash) WHERE idempotency_hash IS NOT NULL` | Anti-duplicate |

---

## C. ApiX-Drive flow — что нельзя ломать

Известные точки contact с `instagram_messages`:
- `supabase/functions/instagram-webhook` — INSERT входящих
- `supabase/functions/instagram-admin-chat` — admin reply UI backend
- `supabase/functions/instagram-send` — outbound send
- RPC `get_instagram_dialogs_v1` — Inbox UI

| Контракт | Текущая семантика | Совместимость с ManyChat |
|---|---|---|
| `direction` enum | `inbound` / `outbound` | переиспользуем ✅ |
| `status` enum | свободный text, default `'delivered'` | расширяем (`queued`, `sent`, `read`, `failed`) ✅ |
| Webhook idempotency у ApiX | через `external_message_id` (без unique constraint) | новый partial unique по `(account, provider_kind, provider_message_id)` legacy не затрагивает ✅ |
| Account resolution | `instagram_account_id` FK | новый ManyChat account = новая строка с `provider_kind='manychat'` ✅ |
| `get_instagram_dialogs_v1` | возвращает диалоги без фильтра | в PATCH 2 добавить `provider_kind` в return для UI badge — **смешанный режим Inbox** |

---

## D. Что мы реально получаем через External Request (push) vs только pull/diff

### Push events (через External Request action) — real-time из Flow

| event_type | Триггер в ManyChat | Pre-req (что нужно настроить) |
|---|---|---|
| `message.received` | Default Reply / Keyword / любой message-trigger Flow | External Request **первым** action в Flow |
| `subscriber.created` | Welcome Flow / Subscribe trigger | External Request в welcome Flow |
| `subscriber.tagged` | Tag Applied trigger Flow (per-tag) | Отдельный Flow с триггером Tag Applied для каждого критичного тега |
| `subscriber.untagged` | Tag Removed trigger Flow | per-tag Flow |
| `subscriber.field_updated` | Custom Field Updated trigger / Set Field action | External Request после Set Field |
| `flow.completed` | Терминальный шаг Flow | External Request как последний action |

### Pull-only events (через Public API cron diff) — НЕ real-time

| Событие | Покрывается | Latency |
|---|---|---|
| Ручной ответ оператора в native Inbox | `getSubscriberInfo.last_interaction` diff | period cron (минуты) |
| Изменение тега вне Flow (manual в UI) | `getSubscriberInfo.tags` diff | period cron |
| Изменение custom field вне Flow | `getSubscriberInfo.custom_fields` diff | period cron |
| Opt-out / unsubscribe вне Flow | `getSubscriberInfo.subscribed` flag | period cron |
| Любое изменение, не привязанное к Flow с External Request | snapshot diff | period cron |

> **Зависимость от «нативных webhook events» из старого плана — invalidated.** Все обещания real-time для off-flow событий — **сняты**.

---

## E. Новые таблицы (DDL summary для PATCH 1)

### `manychat_subscribers` (бридж)

```
- id uuid PK DEFAULT gen_random_uuid()
- integration_instance_id uuid NOT NULL REFERENCES integration_instances(id) ON DELETE CASCADE
- manychat_subscriber_id text NOT NULL
- contact_id uuid NULL REFERENCES contacts(id) ON DELETE SET NULL
- merge_confidence numeric NULL
- merge_method text NULL
- raw_subscriber jsonb
- metadata jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at, updated_at timestamptz NOT NULL DEFAULT now()
- UNIQUE (integration_instance_id, manychat_subscriber_id)
- RLS: admin SELECT, service_role write
```

### `integration_event_mappings`

```
- id uuid PK
- integration_instance_id uuid NOT NULL
- platform_event text NOT NULL
- manychat_action text NOT NULL CHECK (IN ('trigger_flow','add_tag','remove_tag','set_field'))
- target_ref text NOT NULL
- mapping jsonb NOT NULL DEFAULT '{}'::jsonb
- is_active boolean NOT NULL DEFAULT true
- created_at, updated_at, created_by, updated_by
- UNIQUE (integration_instance_id, platform_event, manychat_action, target_ref)
- RLS: admin only
```

### `integration_inbound_events` (External Request ingest buffer)

```
- id uuid PK DEFAULT gen_random_uuid()
- integration_instance_id uuid NOT NULL REFERENCES integration_instances(id) ON DELETE CASCADE
- provider_kind text NOT NULL CHECK (provider_kind IN ('manychat'))
- event_type text NOT NULL
- manychat_page_id text NOT NULL
- manychat_subscriber_id text NOT NULL
- raw_payload jsonb NOT NULL
- raw_headers jsonb NOT NULL  -- secret-поля заменяются sha256-маркером
- source_ip inet NULL
- client_event_id text NULL          -- priority 1 dedup
- provider_message_id text NULL       -- priority 2 dedup
- idempotency_hash text NOT NULL      -- финальный resolved key (любой из priorities)
- received_at timestamptz NOT NULL DEFAULT now()
- processed_at timestamptz NULL
- processing_status text NOT NULL DEFAULT 'pending' CHECK (IN ('pending','processed','duplicate','failed'))
- processing_error text NULL
- UNIQUE (idempotency_hash)
- INDEX (integration_instance_id, processing_status, received_at)
- RLS: superadmin SELECT, service_role write
```

> **Назначение:** буфер всех входящих External Request. Endpoint `manychat-event-ingest` (PATCH 2) пишет сюда синхронно (200 OK сразу после INSERT), фоновый worker эмитит `domain_events` (`manychat.message.received.v1` и т.д.), downstream handlers подписываются на domain events. **Никаких прямых cross-domain вызовов из ingress.**

---

## F. Контракт безопасности входящих External Request

> ManyChat **не подписывает** External Request. Все прежние упоминания `signature_verified` / `x-manychat-signature` / HMAC из плана — **deprecated/invalidated assumption**.

Защита трёхуровневая (полный текст — в [external-request-setup.md](./external-request-setup.md)):

| Уровень | Механизм | Хранение | Проверка |
|---|---|---|---|
| 1. Authn | **`X-Workspace-Token` header** (основной канал); path-secret = legacy fallback с redaction | `integration_instances.config_secrets` (Vault-encrypted) | constant-time compare |
| 2. Authz | allowlist `manychat_page_id` (и `manychat_business_id` если придёт) | `instagram_accounts.instagram_page_id WHERE provider_kind='manychat'` + `integration_instances.config.allowed_page_ids` | `payload.workspace.manychat_page_id ∈ allowlist` |
| 3. Integrity | dedup по приоритетному ключу | `integration_inbound_events.idempotency_hash UNIQUE` | priority 1: `client_event_id` → priority 2: hash с `provider_message_id` → priority 3 (last resort): hash с time-bucket |

---

## Decision записи (финал PATCH 0.4)

✅ **Финальный DDL для PATCH 1 migration:**
1. `ALTER TABLE instagram_accounts ADD COLUMN provider_kind text NOT NULL DEFAULT 'apixdrive' CHECK (provider_kind IN ('apixdrive','manychat'))`
2. `ALTER TABLE instagram_messages ADD COLUMN provider_kind text NOT NULL DEFAULT 'apixdrive' CHECK (provider_kind IN ('apixdrive','manychat'))`
3. `ALTER TABLE instagram_messages ADD COLUMN provider_message_id text` + partial UNIQUE
4. `ALTER TABLE instagram_messages ADD COLUMN thread_key text` + partial INDEX
5. `ALTER TABLE instagram_messages ADD COLUMN sent_at timestamptz`
6. `ALTER TABLE instagram_messages ADD COLUMN delivered_at timestamptz`
7. `ALTER TABLE instagram_messages ADD COLUMN idempotency_hash text` + partial INDEX
8. `CREATE TABLE manychat_subscribers (...)` + RLS
9. `CREATE TABLE integration_event_mappings (...)` + RLS
10. `CREATE TABLE integration_inbound_events (...)` + RLS + UNIQUE(idempotency_hash) + columns `client_event_id`, `provider_message_id`
11. `ALTER TABLE integration_instances ADD COLUMN config_secrets jsonb` (для `shared_secret_token`/`workspace_token`, encrypted) + `config.allowed_page_ids`

✅ **Пересмотр в PATCH 2:**
- RPC `get_instagram_dialogs_v1` — добавить `provider_kind` в return (UI badge)
- Edge `instagram-admin-chat` — роутинг send: `if (provider_kind === 'manychat') call manychat-send else call instagram-send`
- Worker pipeline: `integration_inbound_events → domain_events → handlers` (никаких прямых cross-domain вызовов из ingress)

✅ **RLS пересмотр:** только новые таблицы. Existing `instagram_*` RLS не трогаем.

✅ **Backfill:** не требуется — `direction`/`status` уже корректные; 29 legacy получают `provider_kind='apixdrive'` через DEFAULT.
