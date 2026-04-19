# 0.3. Windowing & Status Proof

**Статус:** ⏳ awaiting live tests
**Owner:** integration engineer
**Pre-req:** capability-matrix.md заполнена (известны точные имена endpoints)

---

## Цели

Доказать **по живым тестам** реальное поведение Instagram через ManyChat:
- 24h окно Meta для автоматизированных сообщений
- 7-дневное окно для manual messages с тегом `HUMAN_AGENT`
- Доставка статусов `delivered` / `read` через webhook
- Реальная работа `Pause Automation` action

Без этих proofs нельзя обещать пользователю UX «менеджер пишет из платформы как в Manychat Inbox».

---

## Test 1 — 24h window for `sendContent` без тегов

**Setup:**
- Тестовый IG-подписчик `<TBD subscriber_id>`
- Последнее входящее от подписчика: `<TBD timestamp>`
- Подождать > 25 часов
- Вызвать `sendContent` без `message_tag`

| Параметр | Результат |
|---|---|
| HTTP status от ManyChat | `<TBD>` |
| Тело ошибки | `<TBD>` |
| Код ошибки Meta (если пробрасывается) | `<TBD>` |
| Сообщение доставлено | `<no — expected>` |

**Decision:** при таком ответе платформа ОБЯЗАНА:
- нормализовать через `normalizeEdgeFunctionError`
- показать оператору warning «вне 24h окна» в Inbox UI
- НЕ возвращать 5xx

---

## Test 2 — 7-day manual window with `HUMAN_AGENT` tag

**Setup:**
- Тот же подписчик, последнее входящее > 24h, < 7 дней
- Вызвать `sendContent` с `message_tag = HUMAN_AGENT`

| Параметр | Результат |
|---|---|
| HTTP status от ManyChat | `<TBD>` |
| Сообщение доставлено в IG | `<TBD>` |
| Lag между API call и доставкой | `<TBD>` |
| Webhook `message:delivered` пришёл | `<TBD>` |

**Decision:**
- Если `<yes>` — строим UX-флаг «можно ответить как Human Agent в окне 7 дней»
- Если `<no>` — отмечаем как deferred, оператору показываем «outside window» сразу

---

## Test 3 — Out-of-7-day attempt

**Setup:**
- Подписчик с последним входящим > 8 дней
- Вызвать `sendContent` с `HUMAN_AGENT`

| Параметр | Результат |
|---|---|
| HTTP status | `<TBD>` |
| Тело ошибки | `<TBD>` |
| UX-маппинг ошибки | `<TBD>` |

---

## Test 4 — Delivered / Read status delivery

**Setup:**
- Отправить `sendContent` в окне 24h
- Слушать webhook endpoint

| Параметр | Результат |
|---|---|
| `message:delivered` пришёл | `<TBD>` |
| Lag отправки → delivered | `<TBD>` |
| `message:read` пришёл (после открытия в IG) | `<TBD>` |
| Lag delivered → read | `<TBD>` |
| Поле в payload, связывающее статус с outbound message | `<TBD>` |

**Decision:** маппинг payload → `instagram_messages.status / delivered_at / read_at` в PATCH 2.

---

## Test 5 — Pause Automation

**Setup:**
- В тестовом workspace настроен Flow, триггерящийся по любому входящему
- Подписчик пишет → Flow стартует
- Параллельно вызвать API action `Pause all automations` для этого subscriber
- Подписчик пишет ещё раз

| Параметр | Результат |
|---|---|
| Flow реально приостанавливается | `<TBD>` |
| Длительность паузы по умолчанию | `<TBD>` |
| Можно ли управлять TTL через API | `<TBD>` |
| Снимается ли pause через `Resume automations` | `<TBD>` |
| Влияет ли на subscribers вне этого Flow | `<TBD>` |

**Decision:** `manychat-send` в PATCH 2 при первом outbound сообщении оператора:
1. Вызывает `<exact action from Test 5>` для подписчика.
2. Эмитит `domain_events: 'manychat.automation.suppressed'` с TTL = `<from Test 5>`.
3. Отдельный domain handler следит за TTL и при необходимости renews.

---

## Decision записи (заполняется после тестов)

- **24h-window UX policy:** `<final>`
- **7-day HUMAN_AGENT поддержка в v1:** `<yes/no>`
- **Status mapping table:** `<webhook event → instagram_messages поле>`
- **Pause Automation runtime contract:** `<final endpoint + flow>`
