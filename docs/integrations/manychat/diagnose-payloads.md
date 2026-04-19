# 0.1. Live Capture Payloads & Headers

**Статус:** ⏳ awaiting live capture
**Owner:** integration engineer
**Pre-req:** временный публичный URL (ngrok / temp edge) подписан на webhooks тестового ManyChat workspace

---

## Цели

Зафиксировать **реальные** payload и headers от ManyChat. До завершения этого файла:
- имя сигнатурного заголовка считается **неподтверждённым**
- схема HMAC, encoding, timestamp — **неизвестны**
- наличие `event_id` / `message_id` в payload — **неизвестно**
- retry-поведение после 5xx — **неизвестно**

Любые архитектурные решения, опирающиеся на эти контракты, до заполнения этого файла **запрещены**.

---

## Capture procedure

1. Поднять временный edge-endpoint, который логирует:
   - все request headers (без фильтрации)
   - raw body
   - HTTP method
   - source IP
   - timestamp получения
2. В ManyChat `Settings → API → Webhooks` подписаться на события: `subscriber:created`, `subscriber:updated`, `subscriber:tagged`, `subscriber:untagged`, `message:received`, `message:delivered`, `message:read`, `field:updated`, `flow:completed`.
3. Спровоцировать каждое из 3 целевых событий вручную в тестовом workspace.
4. Сохранить ответы ниже **дословно** (без редактирования).

---

## Sample 1 — `subscriber:created`

**Headers (raw):**
```
<PASTE FULL HEADERS HERE>
```

**Body (raw JSON):**
```json
<PASTE RAW BODY HERE>
```

**Наблюдения:**
- Имя сигнатурного заголовка: `<TBD>`
- Формат подписи (HMAC algo / encoding): `<TBD>`
- Timestamp в headers / body: `<TBD>`
- Уникальный event_id в payload: `<TBD>`
- Source IP / диапазон: `<TBD>`

---

## Sample 2 — `message:received`

**Headers (raw):**
```
<PASTE FULL HEADERS HERE>
```

**Body (raw JSON):**
```json
<PASTE RAW BODY HERE>
```

**Наблюдения:**
- `subscriber.id` поле: `<TBD>`
- `channel` поле (instagram / messenger / etc): `<TBD>`
- `message.id` для idempotency: `<TBD>`
- Вложения (attachments structure): `<TBD>`
- Quick reply / referral payload: `<TBD>`

---

## Sample 3 — `subscriber:tagged`

**Headers (raw):**
```
<PASTE FULL HEADERS HERE>
```

**Body (raw JSON):**
```json
<PASTE RAW BODY HERE>
```

**Наблюдения:**
- Имя/ID тега в payload: `<TBD>`
- Передаётся ли причина тегирования: `<TBD>`
- Полный snapshot подписчика или только diff: `<TBD>`

---

## Retry behaviour

Тест: вернуть 500 на первый webhook → наблюдать.

| Параметр | Значение |
|---|---|
| Делает ли ManyChat retry после 5xx | `<TBD>` |
| Через сколько секунд первый retry | `<TBD>` |
| Сколько всего попыток | `<TBD>` |
| Backoff schedule | `<TBD>` |
| Retry с тем же `event_id` или новым | `<TBD>` |
| Поведение при 4xx | `<TBD>` |
| Поведение при timeout (>10s ответ) | `<TBD>` |

---

## Idempotency contract

| Параметр | Значение |
|---|---|
| Уникальный ID события в payload | `<TBD: имя поля>` |
| Гарантирован ли он стабильным при retry | `<TBD>` |
| Можно ли строить `idempotency_hash = sha256(event_id + body)` | `<TBD>` |
| Альтернативный ключ если event_id отсутствует | `<TBD>` |

---

## Decision записи (заполняется после capture)

После заполнения секций выше — выписать сюда финальные контракты, которые пойдут в код PATCH 2:

- **Сигнатурный заголовок:** `<NAME>`
- **Алгоритм подписи:** `<HMAC-SHA256 / etc>`
- **Encoding подписи:** `<hex / base64>`
- **Timestamp anti-replay:** `<заголовок + tolerance window в секундах>`
- **Idempotency key formula:** `<formula>`
- **Retry policy on our side:** `<idempotent upsert by hash>`
