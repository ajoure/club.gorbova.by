# 0.4. Compatibility Report — `instagram_*` & ApiX-Drive

**Статус:** ✅ DB introspection выполнен `2026-04-19T08:24Z`
**Owner:** integration engineer
**Источник данных:** прямой `read_query` к `information_schema.columns`

---

## Hard-stop

Любой breaking change ApiX-Drive flow запрещён. Все добавления — add-only с дефолтами для legacy.

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
| `workspace_id uuid` | NULL → backfill | для multi-tenant разделения; для single-tenant можно не вводить в v1, но лучше сразу |

> **Замечание:** `provider_kind` ENUM в БД ещё **нет** — будет создан как plain text + CHECK для add-only-совместимости. Колонка `workspace_id` отсутствует в большинстве таблиц проекта — оставляем `integration_instance_id` как natural workspace boundary в v1.

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

**Записей:** 29. **`direction` уже NOT NULL** с двумя значениями: `inbound`, `outbound` ✅ — переиспользуем 1:1.

### ✅ Хорошие новости (можно переиспользовать без расширения)

| Колонка | Используется как |
|---|---|
| `external_message_id` | будет = `message.id` от ManyChat (idempotency) |
| `sender_id` / `peer_id` / `recipient_id` | = `manychat_subscriber_id` |
| `direction` | уже корректная семантика |
| `raw_payload` | jsonb уже есть — кладём raw ManyChat webhook |
| `status` | расширяемый text — добавим значения `queued`, `sent`, `delivered`, `read`, `failed` |
| `read_at` | уже есть |
| `media_url` / `media_type` | для attachments из ManyChat |

### ❌ Чего не хватает (требует add-only ALTER в PATCH 1)

| Колонка | Тип | Default | Назначение |
|---|---|---|---|
| `provider_kind` | text | `'apixdrive'` | Discriminator (без него legacy ApiX-Drive строки смешаются с ManyChat) |
| `provider_message_id` | text | NULL | ID сообщения у ManyChat (отдельно от `external_message_id` — для случаев когда ManyChat шлёт несколько ID) |
| `thread_key` | text | NULL | Детерминированный ключ треда: `${provider_kind}:${integration_instance_id}:${peer_id}` |
| `sent_at` | timestamptz | NULL | Сейчас есть `sending_at` (queued time), но нет фактического send time |
| `delivered_at` | timestamptz | NULL | Сейчас есть статус `delivered`, но нет timestamp |
| `idempotency_hash` | text | NULL | sha256 для anti-duplicate webhook |

> **Замечание:** колонки `created_at`, `sending_at`, `read_at` уже есть, но семантика разная. `created_at` = когда мы записали, `sending_at` = когда оператор кликнул "send", `read_at` = когда подписчик прочёл. Не хватает именно `sent_at` (когда ManyChat подтвердил отправку) и `delivered_at` (когда дошло до Instagram).

### Требуемые indexes / constraints (add-only)

| Объект | Назначение |
|---|---|
| `UNIQUE (instagram_account_id, provider_kind, provider_message_id) WHERE provider_message_id IS NOT NULL` | Idempotency для ManyChat без ломания legacy ApiX |
| `INDEX (thread_key) WHERE thread_key IS NOT NULL` | Группировка треда в Inbox |
| `INDEX (idempotency_hash) WHERE idempotency_hash IS NOT NULL` | Anti-duplicate webhook |

### Backfill plan для legacy ApiX-Drive строк

- `provider_kind` → `'apixdrive'` через DEFAULT (29 строк закроются автоматически)
- Остальные новые колонки → NULL для legacy, partial unique constraints их игнорируют
- **Не трогаем** `direction`, `status`, `created_at`, `is_read`, `read_at` — они уже корректные

---

## C. ApiX-Drive flow — что нельзя ломать

Известные точки contact с `instagram_messages`:
- `supabase/functions/instagram-webhook` — INSERT входящих
- `supabase/functions/instagram-admin-chat` — admin reply UI backend
- `supabase/functions/instagram-send` — outbound send
- RPC `get_instagram_dialogs_v1` (видим в network logs) — Inbox UI

| Контракт | Текущая семантика | Совместимость с ManyChat |
|---|---|---|
| `direction` enum | `inbound` / `outbound` | переиспользуем без изменений ✅ |
| `status` enum | свободный text, default `'delivered'` | расширяем значениями (`queued`, `sent`, `read`, `failed`) — не ломаем ✅ |
| Webhook idempotency у ApiX | через `external_message_id` (без unique constraint) | новый partial unique по `(account, provider_kind, provider_message_id)` legacy-rows не затрагивает ✅ |
| Account resolution | `instagram_account_id` FK | новый ManyChat account = новая строка `instagram_accounts` с `provider_kind='manychat'` ✅ |
| `get_instagram_dialogs_v1` | возвращает диалоги без фильтра по `provider_kind` | в PATCH 2 решение: либо добавить параметр `p_provider_kind`, либо оставить смешанный режим (UI один Inbox) — **выбираем смешанный**, как и было задумано в плане |

### Risk register

| Риск | Митигация |
|---|---|
| Existing `get_instagram_dialogs_v1` начнёт показывать ManyChat диалоги вперемешку с ApiX | **Это и есть цель** (один Inbox). Но колонка `provider_kind` в результате должна быть, чтобы UI мог показать badge ManyChat / ApiX. Доработать RPC в PATCH 2 |
| RLS на `instagram_messages` для service-role webhook ManyChat | Пересмотр в PATCH 1: убедиться что ManyChat webhook (service role) проходит INSERT — должен, по аналогии с ApiX |
| `peer_id NOT NULL` — у ManyChat есть подписчики без явного `peer_id`? | По live capture (PATCH 0.1) всегда есть `subscriber.id` — мапим в `peer_id` |

---

## D. Новые таблицы (DDL summary для PATCH 1)

### `manychat_subscribers` (бридж)

```
- id uuid PK DEFAULT gen_random_uuid()
- integration_instance_id uuid NOT NULL REFERENCES integration_instances(id) ON DELETE CASCADE
- manychat_subscriber_id text NOT NULL
- contact_id uuid NULL REFERENCES contacts(id) ON DELETE SET NULL  -- link только через explicit merge
- merge_confidence numeric NULL
- merge_method text NULL ('auto_email_match' / 'auto_phone_match' / 'manual')
- raw_subscriber jsonb
- metadata jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at, updated_at timestamptz NOT NULL DEFAULT now()
- UNIQUE (integration_instance_id, manychat_subscriber_id)
- RLS: admin SELECT, service_role write
```

> Без `workspace_id` — `integration_instance_id` уже даёт workspace boundary (один instance = один ManyChat workspace = один тенант в нашей модели).

### `integration_event_mappings`

```
- id uuid PK
- integration_instance_id uuid NOT NULL
- platform_event text NOT NULL  -- 'order.paid', 'subscription.cancelled', 'live_event.starting_soon'
- manychat_action text NOT NULL CHECK (IN ('trigger_flow', 'add_tag', 'remove_tag', 'set_field'))
- target_ref text NOT NULL  -- flow_ns / tag_name / field_name
- mapping jsonb NOT NULL DEFAULT '{}'::jsonb  -- payload mapping platform → params ManyChat
- is_active boolean NOT NULL DEFAULT true
- metadata jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at, updated_at, created_by, updated_by
- UNIQUE (integration_instance_id, platform_event, manychat_action, target_ref)
- RLS: admin only
```

---

## Decision записи (финал PATCH 0.4)

✅ **Финальный DDL для PATCH 1 migration:**
1. `ALTER TABLE instagram_accounts ADD COLUMN provider_kind text NOT NULL DEFAULT 'apixdrive' CHECK (provider_kind IN ('apixdrive', 'manychat'))`
2. `ALTER TABLE instagram_messages ADD COLUMN provider_kind text NOT NULL DEFAULT 'apixdrive' CHECK (provider_kind IN ('apixdrive', 'manychat'))`
3. `ALTER TABLE instagram_messages ADD COLUMN provider_message_id text` + partial UNIQUE
4. `ALTER TABLE instagram_messages ADD COLUMN thread_key text` + partial INDEX
5. `ALTER TABLE instagram_messages ADD COLUMN sent_at timestamptz`
6. `ALTER TABLE instagram_messages ADD COLUMN delivered_at timestamptz`
7. `ALTER TABLE instagram_messages ADD COLUMN idempotency_hash text` + partial INDEX
8. `CREATE TABLE manychat_subscribers (...)` + RLS
9. `CREATE TABLE integration_event_mappings (...)` + RLS

✅ **SELECT-запросы, требующие пересмотра в PATCH 2:**
- RPC `get_instagram_dialogs_v1` — добавить `provider_kind` в return (UI badge)
- Edge `instagram-admin-chat` — роутинг send: `if (provider_kind === 'manychat') call manychat-send else call instagram-send`

✅ **RLS пересмотр требуется на:** только новые таблицы (`manychat_subscribers`, `integration_event_mappings`). Existing `instagram_*` RLS не трогаем.

✅ **Backfill skript для legacy direction/status:** **НЕ требуется** — `direction` уже NOT NULL и корректный, `status` уже имеет default `'delivered'`. 29 legacy-строк автоматически получат `provider_kind='apixdrive'` через DEFAULT.
