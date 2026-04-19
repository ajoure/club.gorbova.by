# ManyChat Integration — PATCH 0 (DIAGNOSE)

Эта папка — единственный источник истины для всех контрактов интеграции ManyChat ↔ платформа.
Кодовые работы PATCH 1+ заблокированы до полного заполнения 4 артефактов ниже.

## Engineering flow
Diagnose → Plan → Dry run → Execute → Verify

---

## Реальный механизм событий из ManyChat (важно!)

В актуальном UI ManyChat **отсутствует** глобальная подписка на webhook events:
- `Settings → API` содержит **только API Key** (никакого `Webhooks` подраздела).
- `Settings → Apps` — это marketplace интеграций, не event-bus.
- Public API (`api.manychat.com/swagger`) **не имеет** ни одного `webhook`/`subscribe` endpoint.
- Полноценная глобальная подписка возможна только через регистрацию **Manychat App** (OAuth + модерация Manychat) — для v1 deferred.

### Утверждённый канонический подход v1 — **гибрид Pull + Push**

| Канал | Назначение | Как настраивается на стороне ManyChat |
|---|---|---|
| **A. Pull через ManyChat Public API** | Снапшоты `tags`, `custom_fields`, `flows`, `subscriber.info`; cron-diff для событий вне Flow | ничего, только API Key |
| **B. Push через External Request action** | Real-time события (`subscriber:created`, `message:received`, `subscriber:tagged`, `flow:completed`, `field:updated`) | в **каждом нужном Flow** добавляется action `External Request → POST` на наш ingest endpoint с ручным маппингом payload (см. [external-request-setup.md](./external-request-setup.md)) |

### Жёсткие границы PATCH 0 (зафиксированы)

- **Real-time события приходят только из тех Flows, куда мы сами вставили External Request.** Любой Flow без врезанного action — событие до платформы **не доедет**.
- **События вне Flow** (ручные действия в ManyChat Inbox оператором, прямые правки полей через UI без Flow) **не гарантируются** в real-time и покрываются исключительно pull/diff-механикой по cron.
- **Full parity с ManyChat Inbox не обещаем.** Зеркалирование оператора, набор `typing`, presence, read-receipts оператора — **out of scope v1**.
- **v1 — только Instagram.** Messenger / WhatsApp / Telegram через ManyChat — deferred.

---

## Артефакты PATCH 0 (DoD)

| # | Файл | Статус | Содержание |
|---|------|--------|------------|
| 1 | [diagnose-payloads.md](./diagnose-payloads.md) | ⏳ awaiting External Request capture | 3 живых POST от External Request action из тестового Flow → headers + body + наблюдения |
| 2 | [capability-matrix.md](./capability-matrix.md) | ✅ done (`2026-04-19`) | 8 API probes на live workspace, `is_pro=true`, 14 flows, 10 tags, 0 custom fields |
| 3 | [windowing-proof.md](./windowing-proof.md) | ⏳ awaiting test subscriber | 4 live-теста (24h, HUMAN_AGENT, delivered/read, Pause Automation) |
| 4 | [compatibility-report.md](./compatibility-report.md) | ✅ done (`2026-04-19`, обновлён под Push без подписи) | Полный DB introspection + финальный DDL для PATCH 1 |
| + | [external-request-setup.md](./external-request-setup.md) | ✅ done (`2026-04-19`) | Точная инструкция, как вставить External Request в Flow |

---

## Live capture endpoint (развёрнут, временный)

```
POST https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/manychat-diagnose-capture/{shared_secret_token}
```

- `GET` → health check + проверка наличия `MANYCHAT_TEST_API_KEY`.
- `POST` (External Request payload) → headers + body логируются в `public.manychat_diagnose_log` (RLS: только superadmin читает).
- `POST {"action":"probe"}` с superadmin auth → ManyChat API capability probe.

> **Важно:** этот endpoint остаётся **diagnose-only**. Production endpoint `manychat-event-ingest` создаётся **в PATCH 2**, когда контракт зафиксирован.

---

## Контракт безопасности входящих External Request

Так как ManyChat **не подписывает** исходящие External Request криптографически, защита делается на нашей стороне через **тройной guard**:

### 1. `shared_secret_token` в URL path
- Формат: random 32-byte URL-safe (`base64url(crypto.randomBytes(32))`).
- Генерируется per-workspace при создании `integration_instances` строки в PATCH 1.
- Передаётся **только через защищённый UI** оператору, который вставляет его в External Request URL.
- Хранится в `integration_instances.config_secrets` (зашифровано через Vault).
- Edge function сверяет `path_token === stored_token` через **constant-time compare**.
- **Rotate**: ручной reissue из админки → старый токен `revoked_at = now()`, обновляется URL во всех Flows (operational task).

### 2. Allowlist по `page_id` / `workspace_id` в payload
- Каждый External Request **обязан** включать в body:
  ```json
  { "manychat_page_id": "{{page_id}}", "manychat_subscriber_id": "{{user_id}}", ... }
  ```
- Edge function проверяет `payload.manychat_page_id ∈ instagram_accounts.instagram_page_id` для данного workspace.
- Несовпадение → `403 page_not_in_allowlist` + лог в `audit_logs`.

### 3. Dedup strategy (ManyChat не предоставляет `event_id`)

Идемпотентность обеспечивается на нашей стороне:

```
idempotency_hash = sha256(
  workspace_id    + '|' +
  manychat_page_id + '|' +
  manychat_subscriber_id + '|' +
  event_type      + '|' +
  floor(received_at_ms / 1000) + '|' +    -- 1-секундный bucket
  sha256(content_payload)
)
```

- Хранится в `integration_inbound_events.idempotency_hash` с `UNIQUE` constraint.
- Дубликат → `200 OK` + `{ status: "duplicate" }` (без записи).
- Окно валидности dedup: **24 часа** (после — старые хэши GC-ются).
- Best-effort, не криптографическая гарантия — фиксируется в `compatibility-report.md` как known limitation.

### Итоговая ответная семантика endpoint
| Случай | HTTP | Тело |
|---|---|---|
| Валидный новый event | 200 | `{ "status": "accepted", "event_id": "..." }` |
| Dedup hit | 200 | `{ "status": "duplicate" }` |
| Невалидный токен | 401 | `{ "error": "invalid_token" }` |
| Page не в allowlist | 403 | `{ "error": "page_not_in_allowlist" }` |
| Малформед payload | 400 | `{ "error": "schema_error", "details": [...] }` |
| Внутренняя ошибка | 500 | `{ "error": "internal" }` (ManyChat External Request **не делает retry** автоматически — см. capability-matrix) |

---

## Что нужно от заказчика для закрытия PATCH 0

1. ✅ **API Key** из `Settings → API` — добавлен (`MANYCHAT_TEST_API_KEY`).
2. ⏳ **PATCH 0.1 — External Request capture:** в одном тестовом Flow добавить action **External Request → POST** на live capture URL по инструкции [external-request-setup.md](./external-request-setup.md), спровоцировать 3 события (`subscriber:created`, `message:received`, `subscriber:tagged`). Затем сказать «PATCH 0.1 capture готов» — я прочитаю `manychat_diagnose_log`, заполню `diagnose-payloads.md` и зафиксирую финальный схемный контракт.
3. ⏳ **PATCH 0.3 — Live windowing tests:** дать `subscriber_id` тестового подписчика (или username) с `last_interaction > 25h ago` — запущу 4 теста автоматически через Public API.

---

## Hard-stops (зафиксированы в плане)

- НЕ трогаем ApiX-Drive (legacy)
- НЕ создаём новый Inbox UI
- НЕ обещаем full parity с ManyChat Inbox
- НЕ используем email/phone как primary identity
- НЕ пишем напрямую в CRM из webhook
- НЕ полагаемся на нативные ManyChat webhooks (их нет в UI)
- НЕ ожидаем встроенной подписи payload (используем `shared_secret_token` + allowlist)
- v1 — только Instagram

---

## Roadmap

- **PATCH 0 — DIAGNOSE** (текущий gate, 2/4 артефакта зелёные + инструкция External Request готова)
- PATCH 1 — Provider + UI + DDL расширения (`integration_instances.config_secrets`, `instagram_accounts.provider_kind`, `instagram_messages.*` add-only, `manychat_subscribers`, `integration_event_mappings`, `integration_inbound_events`)
- PATCH 2 — Production endpoint `manychat-event-ingest` + Inbox bridge + Pull-cron для событий вне Flow
- PATCH 3 — CRM-синхронизация через domain events
- PATCH 4 — Triggers + Dynamic Block (External Request с response для inline-ответов из платформы в Flow)
- PATCH 5 — Proof-пакет (machine-check DoD)
