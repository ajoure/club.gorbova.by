# 0.2. Capability Matrix — текущий ManyChat workspace

**Статус:** ✅ API probe выполнен `2026-04-19T08:27:31Z`
**Owner:** integration engineer
**Источник данных:** edge function `manychat-diagnose-capture` action=probe (8 probes на ManyChat Public API)

---

## Account / plan info

Probe: `GET /fb/page/getInfo` → 200 OK (26 ms)

| Параметр | Значение |
|---|---|
| Workspace name | `БУХГАЛТЕР-МИЛЛИОНЕР•О НАЛОГАХ И ПРАВАХ РБ` |
| Page ID | `null` (не возвращён в getInfo, см. ниже) |
| Channel | Instagram (по folder name + flows) |
| Timezone | `Europe/Warsaw` |
| **`is_pro: true`** | **✅ Pro plan подтверждён** |
| Avatar / username / category | `null` (нужны дополнительные scope или OAuth) |

> **Решение:** v1 интеграции работает поверх `is_pro=true` workspace. Это снимает блок по Pro-features (Webhooks API, Dynamic Block, sendContent с тегами).

---

## Доступные API endpoints (probed live)

Все 8 probe-endpoints вернули 200 OK с латентностью 22–36 ms:

| Endpoint | Status | Латентность | Объём данных |
|---|---|---|---|
| `GET /fb/page/getInfo` | 200 | 26 ms | 1 объект |
| `GET /fb/page/getTags` | 200 | 29 ms | 10 тегов |
| `GET /fb/page/getCustomFields` | 200 | 25 ms | 0 |
| `GET /fb/page/getBotFields` | 200 | 26 ms | 0 |
| `GET /fb/page/getGrowthTools` | 200 | 27 ms | 11 (все типа `feed_comment_trigger`) |
| `GET /fb/page/getOtnTopics` | 200 | 26 ms | 0 |
| `GET /fb/page/getWidgets` | 200 | 22 ms | 0 |
| `GET /fb/page/getFlows` | 200 | 36 ms | 14 flows (11 user + 3 system) |

> **Rate-limit headers:** ManyChat **НЕ возвращает** `X-RateLimit-*` или `Retry-After` заголовки в успешных GET-ответах. Throttler PATCH 2 должен быть **proactive** (token bucket по эмпирическим значениям из docs), а не reactive. Точные RPS-лимиты будут зафиксированы только после первого 429 (см. ниже).

---

## Существующие теги (snapshot)

Используются для маппинга в PATCH 3:

```
006, программа, рыбак, разборы, ФСЗН, цб2025, цб2024, цб2024, мини курс,
Предприниматель, бухгалтер
```

> **Замечание:** теги по продуктам уже реальные → можно мапить `manychat_tag → access_rule` напрямую. Например `цб2025` → доступ к продукту `cb20`.

---

## Существующие Flows (snapshot)

11 user flows + 3 системных (Instagram default reply, subscribe, unsubscribe):

```
программа, 006, "Хочу ссылку; Канал", рыбак, разборы, ФСЗН,
ЦБ миникурс, ЦБ 2025, ЗГ, ЦБ 2024, Дробление
```

Все в одной папке `Инстаграм` (`folder_id: 33096285`).

> **Готовность к PATCH 4 (`manychat-trigger-flow`):** идентификация flow идёт по `ns` (например `content20260412051807_750141` — это «ЦБ 2025»). Это и есть `target_ref` для `integration_event_mappings`.

---

## Custom Fields / Bot Fields

Оба пустые (`data: []`). Это **факт**, не предположение.

> **Следствие для PATCH 1:** при создании первого ManyChat instance в платформе нужно автосоздать стандартный набор Custom Fields (`platform_contact_id`, `platform_workspace_id`, `last_order_id`, `last_order_status`, `subscription_expires_at`) через `POST /fb/page/createCustomField` — иначе негде хранить bridge-поля.

---

## Send API limits

**Не замерено в этом probe.** Замер требует серии запросов к каждой группе endpoints до получения 429. Это deferred до PATCH 0.3 (windowing tests требуют тестового подписчика).

| Endpoint group | Endpoints | Документированный лимит (валидируется live) |
|---|---|---|
| `send` | `sendContent`, `sendFlow`, `sendContentByUserRef` | ~25 RPS (нужен live-замер) |
| `read_meta` | `getFlows`, `getTags`, `getCustomFields`, `getBotFields`, `getGrowthTools` | ~10 RPS (нужен live-замер) |
| `subscriber_ops` | `getInfo`, `findByName`, `findByCustomField`, `addTag`, `removeTag`, `setCustomField` | ~100 RPS (нужен live-замер) |

**Backoff strategy решение** (PATCH 2):
- Token bucket per `(integration_instance_id, endpoint_group)`
- Base delay: **1000 ms** (consensus default до live-замера)
- Max retries: **3** на 429/5xx
- Jitter: **±200 ms**
- Idempotency-key обязателен для `sendContent`

---

## Webhook / event delivery contract

> **КРИТИЧНО:** в актуальном UI ManyChat **отсутствует** глобальная подписка на webhook events. Раздела `Settings → API → Webhooks` **не существует**. Public API не содержит ни одного `webhook`/`subscribe` endpoint (проверено по Swagger).
>
> Единственный нативный способ доставки события из ManyChat в нашу систему — **External Request action внутри конкретного Flow** (Pro-feature, у нас `is_pro=true`). См. [external-request-setup.md](./external-request-setup.md).

| Параметр | Значение |
|---|---|
| Глобальная подписка на события | ❌ отсутствует в UI/API |
| Нативный путь push | ✅ External Request action в Flow (Pro-only) |
| Криптографическая подпись payload | ❌ ManyChat не подписывает |
| Глобальный `event_id` | ❌ не передаётся → dedup на нашей стороне (sha256-hash) |
| Auto-retry на 5xx | ❌ нет, 1 попытка |
| Hard timeout | 10 секунд (как у Dynamic Block) |
| Headers, контролируемые оператором | ✅ да (через UI External Request) |
| Body schema | ✅ полностью **наша** — собирается из `{{system}}`+`{{custom}}` плейсхолдеров ManyChat |

Финальный список Flows, в которые врезаны External Request actions, фиксируется в `diagnose-payloads.md` после PATCH 0.1 live capture.

---

## Dynamic Block / External Request

| Параметр | Значение |
|---|---|
| Доступен в текущем плане | ✅ доступен (Pro подтверждён, External Request — Pro-feature) |
| Точное имя feature в UI ManyChat | `External Request` (он же Dynamic Block) |
| Timeout на стороне ManyChat | **10 секунд** (ManyChat docs hard-limit) |
| Поддерживаемая response schema version | v2 (messages/actions/quick_replies) |
| Лимит размера response body | ~2 MB (документированный) |
| Поддержка дополнительных headers в request | ✅ да |
| Поддержка quick_replies / actions / messages в response | ✅ да |

---

## Pause Automation contract

**Не probed напрямую** (нужен тестовый subscriber_id). Контракт по docs:

| Параметр | Значение |
|---|---|
| Точное имя API action / endpoint | `POST /fb/subscriber/setCustomField` (с системным полем `__pause_automation__`) ИЛИ action в Flow «Pause all automations» |
| Параметры | `subscriber_id`, optional duration |
| Можно ли передать TTL pause | Через action в Flow — да; через прямой API — нет |
| Действует ли на activeFlow подписчика | Да |
| Возвращает ли конфирмацию | Да (`status: success`) |

> **Validate в PATCH 0.3** на тестовом подписчике перед PATCH 2.

---

## Inbox / handover

Probe Inbox seats отдельным endpoint не предусмотрен. Live Chat handover:
- Auto Human Agent при ручном ответе в ManyChat Inbox — гарантия ManyChat (не наша)
- Через API из платформы — невозможно зеркалить, это **deferred** (см. README hard-stops)

---

## Decision записи

✅ **Применённые контракты для PATCH 1+:**

- **Канал событий v1:** гибрид Pull (Public API) + Push (External Request action в выбранных Flows). Нативные глобальные webhooks недоступны и в плане **не используются**.
- **Минимальный набор Flows с External Request:** `subscriber:created`, `message:received`, `subscriber:tagged` — финализируется по факту PATCH 0.1 capture в `diagnose-payloads.md`.
- **События вне Flow** (ручные действия в Inbox, прямые правки полей через UI): покрываются **только** pull-diff cron'ом в PATCH 2 — **без** гарантий real-time.
- **Endpoint groups для throttler PATCH 2:** 3 группы (`send` 25 RPS, `read_meta` 10 RPS, `subscriber_ops` 100 RPS), proactive token bucket (rate headers ManyChat не возвращает).
- **Pause Automation API call для PATCH 2:** через action в Flow (прямой API без TTL); валидируется в PATCH 0.3.
- **Dynamic Block включаем в PATCH 4:** ✅ да, `is_pro=true` подтверждён, timeout 10s, schema v2.
- **Custom Fields bootstrap при создании instance:** обязательно создать `platform_contact_id`, `platform_workspace_id`, `last_order_id`, `last_order_status`, `subscription_expires_at` (сейчас 0 fields в workspace).
- **Защита входящих External Request:** `shared_secret_token` в URL path (constant-time compare) + allowlist по `manychat_page_id` + dedup `sha256(workspace|page|subscriber|event|sec_bucket|payload_hash)`. Криптографическая подпись недоступна в ManyChat — **не используем**.
