# 0.4. Compatibility Report — `instagram_*` & ApiX-Drive

**Статус:** ⏳ awaiting DB introspection
**Owner:** integration engineer
**Pre-req:** доступ к чтению схемы БД (read_query)

---

## Цели

Зафиксировать **точный diff** между текущей схемой `instagram_*` и тем, что требуется для `provider_kind = 'manychat'` compatibility layer. PATCH 1 DDL опирается **только** на этот файл.

Hard-stop: **любой** breaking change ApiX-Drive flow запрещён. Все добавления — add-only с дефолтами для legacy.

---

## A. `instagram_accounts` — текущее состояние

Probe:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'instagram_accounts'
ORDER BY ordinal_position;
```

| Column | Type | Nullable | Default | Используется ApiX-Drive | Trip ManyChat |
|---|---|---|---|---|---|
| `<TBD fill from probe>` | | | | | |

### Требуемые изменения

| Изменение | Add-only | Breaking | Migration plan |
|---|---|---|---|
| `provider_kind` колонка / enum | `<yes если отсутствует>` | `no — default 'apixdrive' для legacy` | `ALTER TABLE … ADD COLUMN provider_kind text NOT NULL DEFAULT 'apixdrive'`, далее CHECK (`provider_kind IN ('apixdrive', 'manychat')`) |
| `integration_instance_id` FK на `integration_instances` | `<TBD: уже есть?>` | `<no>` | nullable до backfill |
| `workspace_id` | `<TBD: уже есть?>` | `<no>` | если нет — отдельный backfill из integration_instances |

---

## B. `instagram_messages` — текущее состояние

Probe:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'instagram_messages'
ORDER BY ordinal_position;
```

| Column | Type | Nullable | Default | ApiX-Drive семантика | ManyChat reuse 1:1 |
|---|---|---|---|---|---|
| `<TBD fill from probe>` | | | | | |

### Требуемые добавления (все nullable / с дефолтом — add-only)

| Колонка | Тип | Default | Назначение |
|---|---|---|---|
| `provider_kind` | text | `'apixdrive'` | Discriminator |
| `provider_message_id` | text | NULL | ID сообщения у ManyChat (idempotency / status linking) |
| `thread_key` | text | NULL | Детерминированный ключ треда: `${provider_kind}:${integration_instance_id}:${subscriber_id}` |
| `direction` | text | NULL → backfill из существующих флагов | `inbound` / `outbound` |
| `status` | text | NULL | `queued` / `sent` / `delivered` / `read` / `failed` |
| `sent_at` | timestamptz | NULL | |
| `delivered_at` | timestamptz | NULL | |
| `read_at` | timestamptz | NULL | |
| `raw_payload` | jsonb | NULL | Полный raw webhook payload для аудита |
| `idempotency_hash` | text | NULL | sha256 на основе capture из 0.1 |
| `workspace_id` | uuid | NULL → backfill | Multi-tenant |

### Требуемые indexes / constraints

| Объект | Назначение |
|---|---|
| `UNIQUE (workspace_id, integration_instance_id, provider_message_id) WHERE provider_message_id IS NOT NULL` | Idempotency для ManyChat без ломания legacy |
| `INDEX (thread_key)` | Группировка треда в Inbox |
| `INDEX (idempotency_hash)` | Anti-duplicate webhook |

### Backfill plan для legacy ApiX-Drive строк

- `provider_kind` → `'apixdrive'` через DEFAULT
- `direction` → восстановить из существующих полей (`is_outgoing` / `from_admin` / etc — узнать в probe)
- `status` → восстановить из существующего статуса (если есть)
- `provider_message_id` / `thread_key` остаются NULL для legacy — это OK, новые unique constraints partial

---

## C. ApiX-Drive flow — что нельзя ломать

Probe edge functions: `instagram-webhook`, `instagram-admin-chat`, `instagram-send`.

| Контракт | Текущая семантика | Совместимость |
|---|---|---|
| Имя колонки sender/recipient | `<TBD>` | переиспользуем |
| Enum статусов | `<TBD>` | расширяем без удаления |
| Webhook idempotency у ApiX | `<TBD: возможно нет>` | новый `idempotency_hash` nullable, не мешает |
| Account resolution (`instagram_account_id`) | `<TBD>` | новый bridge через `provider_kind` discriminator |

### Risk register

| Риск | Митигация |
|---|---|
| Existing query без фильтра по `provider_kind` начнёт смешивать ManyChat и ApiX | Audit всех SELECT по `instagram_messages` в `<TBD list>`, добавить `WHERE provider_kind = 'apixdrive'` где legacy-only |
| Existing UI Inbox показывает только ApiX поля | После PATCH 2 проверить рендер новых полей (`status`, `delivered_at`) — fallback на legacy-поля |
| Trigger / RLS на `instagram_messages` ломается на NULL новых колонок | Все ALTER — с дефолтами или nullable; RLS пересмотр в DDL PATCH 1 |

---

## D. Новые таблицы (DDL summary для PATCH 1)

### `manychat_subscribers`

Минимальный контракт:
- `id uuid PK`
- `public_id text` (для admin URL)
- `workspace_id uuid NOT NULL`
- `integration_instance_id uuid NOT NULL REFERENCES integration_instances(id)`
- `manychat_subscriber_id text NOT NULL`
- `contact_id uuid NULL REFERENCES contacts(id)` — link **только** через explicit merge flow
- `merge_confidence numeric NULL`
- `merge_method text NULL` — `auto_email_match` / `auto_phone_match` / `manual` / etc
- `raw_subscriber jsonb`
- `metadata jsonb DEFAULT '{}'`
- `created_at`, `updated_at`, `created_by`, `updated_by`
- UNIQUE `(workspace_id, integration_instance_id, manychat_subscriber_id)`
- RLS: workspace-scoped read для admins, write только из service role

### `integration_event_mappings`

Маппинг доменных событий платформы → действий ManyChat:
- `id uuid PK`, `public_id`
- `workspace_id uuid NOT NULL`
- `integration_instance_id uuid NOT NULL`
- `platform_event text NOT NULL` (например `order.paid`, `subscription.cancelled`, `live_event.starting_soon`)
- `manychat_action text NOT NULL CHECK (manychat_action IN ('trigger_flow', 'add_tag', 'remove_tag', 'set_field'))`
- `target_ref text NOT NULL` (flow_ns / tag_name / field_name)
- `mapping jsonb DEFAULT '{}'` (маппинг payload платформы → params ManyChat)
- `is_active boolean DEFAULT true`
- `metadata jsonb`
- timestamps + actors
- UNIQUE `(workspace_id, integration_instance_id, platform_event, manychat_action, target_ref)`
- RLS: admin-only

---

## Decision записи (заполняется после probe)

- **Финальный DDL для PATCH 1 migration:** ссылка на готовый `.sql` черновик
- **Список SELECT-запросов, требующих `provider_kind` фильтра:** `<file:line list>`
- **RLS пересмотр требуется на:** `<list of tables>`
- **Backfill skript для legacy direction/status:** `<готов / не требуется>`
