# 0.2. Capability Matrix — текущий ManyChat workspace

**Статус:** ⏳ awaiting API probe
**Owner:** integration engineer
**Pre-req:** API Key из `Settings → API` тестового workspace

---

## Цели

Зафиксировать что **реально доступно** в подключённом аккаунте — не по публичной маркетинговой документации, а по факту. План PATCH 1+ опирается только на эту матрицу.

---

## Account / plan info

Probe: `GET /fb/page/getInfo`

| Параметр | Значение |
|---|---|
| Page ID | `<TBD>` |
| Channel | `<instagram / messenger / wa / tg>` |
| Plan tier (из ответа API или Settings UI) | `<TBD>` |
| Цена тарифа на момент подключения | `<TBD>` |
| Доступ к Public API | `<yes/no>` |
| Доступ к Webhooks API (ManyChat Pro feature) | `<yes/no>` |
| Доступ к DevTools / Dynamic Block | `<yes/no>` |
| Inbox seats доступны | `<yes/no/quantity>` |

---

## Доступные webhook events (по тарифу)

Зафиксировать какие из подписок реально доставляются:

| Event | Доступен в текущем плане | Подтверждено live capture |
|---|---|---|
| `subscriber:created` | `<TBD>` | `<TBD>` |
| `subscriber:updated` | `<TBD>` | `<TBD>` |
| `subscriber:tagged` | `<TBD>` | `<TBD>` |
| `subscriber:untagged` | `<TBD>` | `<TBD>` |
| `message:received` | `<TBD>` | `<TBD>` |
| `message:delivered` | `<TBD>` | `<TBD>` |
| `message:read` | `<TBD>` | `<TBD>` |
| `field:updated` | `<TBD>` | `<TBD>` |
| `flow:started` | `<TBD>` | `<TBD>` |
| `flow:completed` | `<TBD>` | `<TBD>` |
| Conversation handover | `<TBD>` | `<TBD>` |

---

## Send API limits (endpoint-aware)

Замер: серия запросов к каждой группе endpoints до получения 429.

| Endpoint group | Endpoints | Замеренный лимит | Header rate-limit response |
|---|---|---|---|
| `send` | `sendContent`, `sendFlow`, `sendContentByUserRef` | `<TBD RPS>` | `<TBD>` |
| `read_meta` | `getFlows`, `getTags`, `getCustomFields`, `getBotFields`, `getGrowthTools` | `<TBD RPS>` | `<TBD>` |
| `subscriber_ops` | `getInfo`, `findByName`, `findByCustomField`, `addTag`, `removeTag`, `setCustomField` | `<TBD RPS>` | `<TBD>` |
| `automation` | `Pause all automations` (точное имя action), unsubscribe, etc | `<TBD RPS>` | `<TBD>` |

**Backoff strategy решение** (заполняется после замера):
- Base delay: `<TBD ms>`
- Max retries: `<TBD>`
- Jitter: `<TBD>`

---

## Dynamic Block / External Request

| Параметр | Значение |
|---|---|
| Доступен в текущем плане | `<yes/no>` |
| Точное имя feature в UI ManyChat | `<TBD>` |
| Timeout на стороне ManyChat | `<TBD seconds, ожидаем 10>` |
| Поддерживаемая response schema version | `<TBD>` |
| Лимит размера response body | `<TBD>` |
| Поддержка дополнительных headers в request | `<TBD>` |
| Поддержка quick_replies / actions / messages в response | `<TBD>` |

---

## Pause Automation contract

| Параметр | Значение |
|---|---|
| Точное имя API action / endpoint | `<TBD>` |
| Параметры (subscriber_id, duration?) | `<TBD>` |
| Можно ли передать TTL pause | `<TBD>` |
| Действует ли на activeFlow подписчика | `<TBD>` |
| Возвращает ли конфирмацию | `<TBD>` |

---

## Inbox / handover

| Параметр | Значение |
|---|---|
| Live Chat seats в плане | `<TBD>` |
| Auto Human Agent при ручном ответе в Manychat Inbox | `<TBD: yes per docs>` |
| Можно ли через API перевести conversation в Live Chat mode | `<TBD>` |
| Можно ли через API получить список assigned conversations | `<TBD>` |

> **Напоминание hard-stop:** parity с ManyChat Inbox не обещаем. Эта секция — только для информации, что мы НЕ можем зеркалить.

---

## Decision записи (заполняется после probe)

- **Webhook events, на которые подписываемся в PATCH 1:** `<final list>`
- **Endpoint groups для throttler PATCH 2:** `<final RPS table>`
- **Pause Automation API call для PATCH 2:** `<exact endpoint + params>`
- **Dynamic Block включаем в PATCH 4:** `<yes/no + reason>`
