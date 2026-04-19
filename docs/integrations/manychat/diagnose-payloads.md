# 0.1. External Request Payloads & Headers (live capture)

**Статус:** ⏳ awaiting External Request capture
**Owner:** integration engineer
**Pre-req:** в тестовом Flow добавлен action `External Request → POST` на live capture URL (см. [external-request-setup.md](./external-request-setup.md))

---

## ⚠️ Важно: чего здесь НЕТ и почему

В ManyChat **отсутствует** нативная глобальная подписка на webhook events. Раздела `Settings → API → Webhooks` **не существует**. Поэтому:

- мы **сами проектируем** payload, который отправляет External Request action из Flow;
- мы **сами управляем** headers (через UI ManyChat в настройках External Request);
- ManyChat **не подписывает** payload криптографически → защищаемся `shared_secret_token` + allowlist (см. [README.md](./README.md));
- ManyChat **не предоставляет** глобальный `event_id` → dedup делаем хэшем (см. [README.md](./README.md));
- ManyChat **не делает автоматический retry** на 5xx из External Request → ответственность за идемпотентность полностью на нас.

Ниже фиксируется **наша** payload-схема (то, что мы попросили оператора собрать в External Request body) + **что реально пришло** в headers/body после live триггера.

---

## Capture procedure

1. Live capture endpoint развёрнут: `POST .../manychat-diagnose-capture/{shared_secret_token}`. Логирует в `public.manychat_diagnose_log`:
   - все request headers (без фильтрации)
   - raw body
   - HTTP method
   - source IP
   - timestamp получения
2. Оператор **в трёх отдельных тестовых Flows** (или в одном с тремя ветками) добавляет `External Request → POST` по инструкции [external-request-setup.md](./external-request-setup.md), используя предложенные шаблоны payload для трёх событий.
3. Триггерим Flows вручную через тестового подписчика.
4. Сохраняем ответы ниже **дословно**.

---

## Sample 1 — `subscriber:created` (наш payload)

**Запрошенный body template (вставляется в External Request → Body → Custom JSON):**
```json
{
  "event_type": "subscriber.created",
  "manychat_page_id": "{{page_id}}",
  "manychat_subscriber_id": "{{user_id}}",
  "first_name": "{{first_name}}",
  "last_name": "{{last_name}}",
  "username": "{{ig_username}}",
  "ig_id": "{{ig_id}}",
  "subscribed_at": "{{subscribed}}",
  "last_interaction": "{{last_interaction}}",
  "tags": "{{user_tags}}",
  "occurred_at_ms": "{{ts_ms}}"
}
```

**Headers (raw, что фактически прислал ManyChat):**
```
<PASTE FULL HEADERS HERE>
```

**Body (raw JSON, фактический после подстановки полей ManyChat'ом):**
```json
<PASTE RAW BODY HERE>
```

**Наблюдения:**
- Какие из `{{...}}` плейсхолдеров **реально** подставились (а не остались как литералы): `<TBD>`
- Какие из них пришли пустыми / null: `<TBD>`
- Тип значения `{{user_tags}}` (строка через запятую / массив / JSON-строка): `<TBD>`
- User-Agent ManyChat: `<TBD>`
- Source IP / диапазон: `<TBD>`
- Content-Type, который ManyChat реально ставит: `<TBD>`

---

## Sample 2 — `message:received` (наш payload)

**Запрошенный body template:**
```json
{
  "event_type": "message.received",
  "manychat_page_id": "{{page_id}}",
  "manychat_subscriber_id": "{{user_id}}",
  "channel": "instagram",
  "text": "{{last_input_text}}",
  "ig_thread_id": "{{ig_thread_id}}",
  "occurred_at_ms": "{{ts_ms}}"
}
```

**Headers (raw):**
```
<PASTE FULL HEADERS HERE>
```

**Body (raw JSON):**
```json
<PASTE RAW BODY HERE>
```

**Наблюдения:**
- Доступно ли поле `{{ig_thread_id}}` или приходит пустым: `<TBD>`
- Доступно ли уникальное message_id (для idempotency): `<TBD>`
- Передаются ли вложения (URL картинок/видео): `<TBD>`
- Quick reply / referral payload: `<TBD>`

---

## Sample 3 — `subscriber:tagged` (наш payload)

**Запрошенный body template** (тег **должен быть указан явно**, потому что в External Request нет глобального события `tag:added`, action вешается **на конкретный Flow с условием по тегу**):
```json
{
  "event_type": "subscriber.tagged",
  "manychat_page_id": "{{page_id}}",
  "manychat_subscriber_id": "{{user_id}}",
  "tag_name": "цб2025",
  "all_tags": "{{user_tags}}",
  "occurred_at_ms": "{{ts_ms}}"
}
```

**Headers (raw):**
```
<PASTE FULL HEADERS HERE>
```

**Body (raw JSON):**
```json
<PASTE RAW BODY HERE>
```

**Наблюдения:**
- Точное значение `tag_name` пришло как литерал из шаблона (т.е. мы **сами** управляем именем): `<TBD: подтвердить>`
- `{{user_tags}}` показывает **все** теги после добавления: `<TBD>`
- Передаётся ли причина тегирования / источник: **нет** (контракт ManyChat ограничен полями подписчика)

---

## Retry & error behaviour (фактическая проверка)

**Тест:** на одном из 3 запросов вернуть 500 с capture endpoint, наблюдать в ManyChat Flow History.

| Параметр | Значение (ожидаемое по docs / факт после теста) |
|---|---|
| Делает ли ManyChat retry после 5xx | по docs External Request — **НЕТ автоматического retry** / факт: `<TBD>` |
| Через сколько секунд первый retry | n/a (нет retry) / факт: `<TBD>` |
| Сколько всего попыток | 1 / факт: `<TBD>` |
| Поведение при 4xx | Flow продолжается с пометкой ошибки в Flow History / факт: `<TBD>` |
| Поведение при timeout (>10s) | hard timeout 10s, Flow продолжается / факт: `<TBD>` |
| Логируется ли ошибка для оператора | в Flow History видно response code и body / факт: `<TBD>` |

> **Следствие:** так как ретраев нет, **наш endpoint обязан**: (а) отвечать 2xx даже на duplicate (чтобы Flow не падал); (б) внутренне ставить event в очередь и обрабатывать асинхронно; (в) иметь отдельный pull-fallback для критичных событий (см. PATCH 2).

---

## Idempotency contract (финальный)

| Параметр | Значение |
|---|---|
| Глобальный event_id от ManyChat | **отсутствует** (фундаментальное ограничение External Request) |
| Наша формула | `sha256(workspace_id + '|' + page_id + '|' + subscriber_id + '|' + event_type + '|' + floor(received_at_ms/1000) + '|' + sha256(payload))` |
| Окно dedup | 24h |
| Хранилище | `integration_inbound_events.idempotency_hash UNIQUE` |
| Поведение при коллизии | 200 OK `{status:"duplicate"}` без записи |
| Известное ограничение | если оператор триггернёт **тот же** Flow дважды в одну секунду с тем же payload — это **может** склеиться (false-dedup). Для message-событий это приемлемо, для биллинг-критичных событий нужен **дополнительный** ключ из payload (например, `order_id` если есть). |

---

## Decision записи (заполнятся после live capture)

После живого capture сюда выписываются финальные контракты, которые пойдут в код PATCH 2:

- **Минимальный обязательный набор полей в External Request body:** `<заполнится>`
- **Headers, которые ManyChat реально ставит (для anti-spoof проверок):** `<заполнится>`
- **Список Flows, в которых нужно врезать External Request (при онбординге workspace):** `<заполнится>`
- **Pull-fallback частота для событий вне Flow:** `<решится после 0.3>`
- **Retry policy на нашей стороне:** idempotent upsert by `idempotency_hash`, 200 OK на duplicate, асинхронная обработка через очередь.
