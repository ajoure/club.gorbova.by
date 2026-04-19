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

> **Решение:** v1 интеграции работает поверх `is_pro=true` workspace. Это снимает блок по Pro-features (External Request action в Flow, Dynamic Block).

---

## 4-колоночная capability матрица v1 (главная секция)

| Покрывается **Public API (Pull)** | Покрывается **External Request (Push, real-time)** | **Не покрывается в v1** | **Deferred (Phase 2)** |
|---|---|---|---|
| `getSubscriberInfo` | `message.received` (только из Flow с врезанным action) | Ручные ответы оператора в native ManyChat Inbox | Full Manychat App (OAuth + модерация Manychat) |
| `getTags` | `subscriber.created` (из welcome/onboarding Flow) | Stories Reply (если не заведено в Flow) | Inbox parity (зеркалирование оператора, typing, presence) |
| `getCustomFields` | `subscriber.tagged` (per-tag Flow) | Voice messages (out of scope медиа в v1) | Advanced event bridge (глобальные subscription endpoints через App) |
| `getBotFields` | `subscriber.untagged` (per-tag Flow) | `delivered` / `read` статусы вне Flow | Multi-channel через ManyChat (Messenger / WhatsApp / Telegram) — generic `communications_*` layer |
| `getFlows` | `subscriber.field_updated` (Flow с set_field action) | Изменение тегов вне Flow (только pull/diff) | Криптографически подписанный payload (требует регистрации App) |
| `getGrowthTools` | `flow.completed` (терминальный action в Flow) | Изменение custom fields вне Flow (только pull/diff) | Глобальный server-to-server event bus от ManyChat |
| `sendContent`, `sendFlow` (send-side) | (real-time только если оператор врезал External Request) | Opt-out / unsubscribe вне Flow (только pull/diff) | Webhook signature verification |
| `addTag`, `removeTag`, `setCustomField` | — | Native push-нотификации от Inbox | TTL-based Pause Automation через прямой API |

> **Канон v1:** Push покрывает **только** то, куда мы вручную врежем External Request action. Всё остальное — **только** pull/diff. Native Inbox — **не** наблюдаем.

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

> **Rate-limit headers:** ManyChat **НЕ возвращает** `X-RateLimit-*` или `Retry-After` заголовки в успешных GET-ответах. Throttler PATCH 2 должен быть **proactive endpoint-aware** (token bucket по группам), а не reactive с одной общей цифрой.

---

## Authentication contract (Public API)

| Параметр | Значение |
|---|---|
| Тип ключа | **API Key** из `Settings → API` (Account Public API key, **не** page token) |
| Где брать | UI: `Settings → API` → `Generate / Show API Key` |
| Скоуп | весь workspace (Account-level), все pages в нём |
| Хранение у нас | secret `MANYCHAT_TEST_API_KEY` (для diagnose) → в production через `integration_instances.config_secrets` (Vault-encrypted) per workspace |
| Ротация | ручной reissue в UI ManyChat → инвалидирует старый ключ моментально |
| Ограничения | один Account-level API Key на workspace; для разделения tenant-scope используем разные `integration_instances` |

> **Не путать:** Account Public API key (то, что мы используем) ≠ App OAuth token (для зарегистрированного Manychat App, deferred Phase 2). Все термины «page token» из старых черновиков — **invalidated**.

---

## Существующие теги (snapshot)

```
006, программа, рыбак, разборы, ФСЗН, цб2025, цб2024, цб2024, мини курс,
Предприниматель, бухгалтер
```

> Теги по продуктам уже реальные → мапим `manychat_tag → access_rule` напрямую (`цб2025` → `cb20`).

---

## Существующие Flows (snapshot)

11 user flows + 3 системных:
```
программа, 006, "Хочу ссылку; Канал", рыбак, разборы, ФСЗН,
ЦБ миникурс, ЦБ 2025, ЗГ, ЦБ 2024, Дробление
```
Папка `Инстаграм` (`folder_id: 33096285`). Идентификация flow идёт по `ns` (например `content20260412051807_750141` — это «ЦБ 2025») — это `target_ref` для `integration_event_mappings`.

---

## Custom Fields / Bot Fields

Оба пустые (`data: []`). **Факт.**

> **Следствие для PATCH 1:** при создании первого ManyChat instance автосоздать стандартный набор Custom Fields (`platform_contact_id`, `platform_workspace_id`, `last_order_id`, `last_order_status`, `subscription_expires_at`) через `POST /fb/page/createCustomField`.

---

## Endpoint-aware throttling (NFR для PATCH 2)

ManyChat docs **не публикуют** единую RPS-цифру для всего API. Лимиты различаются по endpoint-группам. Поэтому в throttler PATCH 2 — **per-group token bucket**, а **не** одно общее значение.

| Endpoint group | Endpoints | Документированная оценка (валидируется live) | Priority в очереди |
|---|---|---|---|
| `send` | `sendContent`, `sendFlow`, `sendContentByUserRef` | ~25 RPS (требует live-замер) | high (user-facing latency) |
| `read_meta` | `getFlows`, `getTags`, `getCustomFields`, `getBotFields`, `getGrowthTools`, `getInfo` | ~10 RPS (требует live-замер) | low (cron-driven) |
| `subscriber_ops` | `getSubscriberInfo`, `findByName`, `findByCustomField`, `addTag`, `removeTag`, `setCustomField` | ~100 RPS (требует live-замер) | medium |

**Backoff strategy** (PATCH 2):
- Token bucket per `(integration_instance_id, endpoint_group)` — **per group**, не глобально
- Base delay: **1000 ms**
- Max retries: **3** на 429/5xx
- Jitter: **±200 ms**
- Idempotency-key обязателен для `sendContent`
- Точные RPS-цифры замеряются в PATCH 0.3 / PATCH 2 и фиксируются обратно сюда

---

## Push delivery contract (External Request, не webhook)

> **КРИТИЧНО:** в нашем контуре (workspace без зарегистрированного App) глобальная подписка на webhook events **документально не подтверждена**. Раздела `Settings → API → Webhooks` в текущем UI нет. Public API не содержит `/webhook` или `/subscribe` endpoints.
>
> Единственный нативный путь push v1 — **External Request action внутри конкретного Flow** (Pro-feature, у нас `is_pro=true`). См. [external-request-setup.md](./external-request-setup.md).

| Параметр | Значение |
|---|---|
| Глобальная подписка на события | ❌ отсутствует в нашем контуре (документально не подтверждена) |
| Нативный путь push | ✅ External Request action в Flow (Pro-only) |
| Криптографическая подпись payload | ❌ ManyChat не подписывает External Request |
| Глобальный `event_id` | ❌ не передаётся → dedup на нашей стороне с приоритетным ключом |
| Auto-retry на 5xx | ❌ нет, 1 попытка |
| Hard timeout | 10 секунд (как у Dynamic Block) |
| HTTPS обязателен | ✅ да (NFR Dev Tools) |
| Headers, контролируемые оператором | ✅ да (`Content-Type`, `X-Workspace-Token` и т.д.) |
| Body schema | ✅ полностью **наша** — собирается из `{{system}}`+`{{custom}}` плейсхолдеров |

Финальный список Flows с External Request фиксируется в `diagnose-payloads.md` после PATCH 0.1 live capture.

---

## Dynamic Block / External Request

| Параметр | Значение |
|---|---|
| Доступен в текущем плане | ✅ доступен (Pro подтверждён) |
| Точное имя feature в UI ManyChat | `External Request` (ранее — `Dynamic Block`) |
| Timeout на стороне ManyChat | **10 секунд** (hard-limit) |
| Поддерживаемая response schema version | v2 (messages/actions/quick_replies) |
| Лимит размера response body | ~2 MB |
| Поддержка дополнительных headers в request | ✅ да |
| Поддержка quick_replies / actions / messages в response | ✅ да |
| HTTPS обязателен | ✅ |

---

## Pause Automation contract

**Не probed напрямую** (нужен тестовый subscriber_id). Контракт по docs:

| Параметр | Значение |
|---|---|
| Точное имя API action | `POST /fb/subscriber/setCustomField` (системное поле `__pause_automation__`) ИЛИ action в Flow «Pause all automations» |
| Параметры | `subscriber_id`, optional duration |
| Можно ли передать TTL pause | Через action в Flow — да; через прямой API — нет |
| Действует ли на activeFlow подписчика | Да |
| Возвращает ли конфирмацию | Да (`status: success`) |

> **Validate в PATCH 0.3** на тестовом подписчике перед PATCH 2.

---

## Inbox / handover

Probe Inbox seats отдельным endpoint не предусмотрен. Live Chat handover:
- Auto Human Agent при ручном ответе в native ManyChat Inbox — внутренняя гарантия ManyChat (мы её **не** наблюдаем)
- Через API из платформы — невозможно зеркалить, **deferred**

---

## Decision записи

✅ **Применённые контракты для PATCH 1+:**

- **Канал событий v1:** гибрид Pull (Public API, Account-level API Key) + Push (External Request action в выбранных Flows). Глобальные webhooks **не используем**.
- **Минимальный набор Flows с External Request:** `subscriber.created`, `message.received`, `subscriber.tagged` — финализируется по факту PATCH 0.1 capture.
- **События вне Flow** (ручные действия в Inbox, прямые правки полей через UI): покрываются **только** pull-diff cron'ом — **без** гарантий real-time.
- **Endpoint groups для throttler PATCH 2:** 3 группы (`send` / `read_meta` / `subscriber_ops`), **per-group** token bucket, proactive (rate headers ManyChat не возвращает).
- **Pause Automation API call для PATCH 2:** через action в Flow (прямой API без TTL); валидируется в PATCH 0.3.
- **Dynamic Block включаем в PATCH 4:** ✅ `is_pro=true` подтверждён, timeout 10s, schema v2.
- **Custom Fields bootstrap:** обязательно создать `platform_contact_id`, `platform_workspace_id`, `last_order_id`, `last_order_status`, `subscription_expires_at`.
- **Защита входящих External Request:** header-secret `X-Workspace-Token` (constant-time compare) **+** allowlist по `manychat_page_id` **+** dedup по приоритетному ключу (`client_event_id` → `provider_message_id` hash → time-bucket fallback). Path-secret = только legacy fallback с redaction. Криптографическая подпись недоступна — **не используем**.
