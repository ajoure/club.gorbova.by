# 0.1. External Request Payloads & Headers (live capture)

**Статус:** ⏳ awaiting External Request capture
**Owner:** integration engineer
**Pre-req:** в тестовом Flow добавлен action `External Request → POST` на live capture URL (см. [external-request-setup.md](./external-request-setup.md))

---

## ⚠️ Важно: чего здесь НЕТ и почему

В контуре, который мы используем (workspace без зарегистрированного Manychat App), **нет документально подтверждённой** глобальной подписки на webhook events. Раздела `Settings → API → Webhooks` в UI **не существует**. Поэтому:

- мы **сами проектируем** payload, который отправляет External Request action из Flow;
- мы **сами управляем** headers (через UI ManyChat в настройках External Request — `Content-Type`, `X-Workspace-Token` и т.д.);
- ManyChat **не подписывает** payload криптографически → защищаемся header-secret + allowlist (см. [external-request-setup.md](./external-request-setup.md));
- ManyChat **не предоставляет** глобальный `event_id` → dedup делаем по приоритетному ключу (см. ниже);
- ManyChat **не делает автоматический retry** на 5xx из External Request → ответственность за идемпотентность полностью на нас.

> **Mapping старых формулировок:** все ранее упомянутые «нативные webhook headers» (`x-manychat-signature`, `x-manychat-event-id`) — **invalidated assumption**. Их нет. Контролируем то, что задаём в UI External Request сами.

---

## Recommended canonical contract v1

> Это **рекомендуемый** контракт. Реальный набор переменных, которые ManyChat реально подставляет в `{{...}}` плейсхолдеры, **валидируется live capture** в 3 тестовых Flows. Официальный External Request гарантирует только: возможность задать `method`, `URL`, `headers`, `body type`, `body`. Состав конкретных полей внутри body — **наша ответственность** и фиксируется этим документом по факту capture.

### Canonical JSON envelope (copy-paste для оператора в External Request → Body → Custom JSON)

```json
{
  "event_type": "message.received",
  "workspace": {
    "manychat_page_id": "{{page_id}}",
    "manychat_business_id": ""
  },
  "flow": {
    "flow_ns": "<заполнить ns Flow вручную, напр. content20260412051807_750141>",
    "flow_name": "<человекочитаемое имя Flow>",
    "step_id": "<id шага в Flow, опционально>"
  },
  "subscriber": {
    "manychat_subscriber_id": "{{user_id}}",
    "ig_username": "{{ig_username}}",
    "ig_id": "{{ig_id}}"
  },
  "message": {
    "provider_message_id": "",
    "thread_key": "{{ig_thread_id}}",
    "text": "{{last_input_text}}",
    "attachments": []
  },
  "custom_fields": {},
  "system": {
    "last_input_text": "{{last_input_text}}",
    "last_interaction_ms": "{{last_interaction}}",
    "user_tags": "{{user_tags}}"
  },
  "occurred_at_ms": "{{ts_ms}}",
  "correlation": {
    "client_event_id": "{{user_id}}-{{ts_ms}}-<flow_ns>",
    "content_sha256": ""
  }
}
```

**Допустимые значения `event_type` для v1:**
`message.received` | `subscriber.created` | `subscriber.tagged` | `subscriber.untagged` | `subscriber.field_updated` | `flow.completed`

**Headers, которые мы требуем (задаются в UI External Request):**
- `Content-Type: application/json` — обязательно
- `X-Workspace-Token: <shared_secret>` — обязательно (основной канал секрета)
- `X-Event-Source: manychat-external-request/v1` — для трассировки

---

## Capture procedure

1. Live capture endpoint развёрнут: `POST .../manychat-diagnose-capture/{shared_secret_token}`. Логирует в `public.manychat_diagnose_log`:
   - все request headers (без фильтрации; secret-поля **redact**ятся в hash для безопасности логов)
   - raw body
   - HTTP method
   - source IP
   - timestamp получения
2. Оператор **в трёх отдельных тестовых Flows** (или в одном с тремя ветками) добавляет `External Request → POST` по инструкции [external-request-setup.md](./external-request-setup.md), используя canonical envelope выше с заменой `event_type` на нужный.
3. Триггерим Flows вручную через тестового подписчика.
4. Сохраняем ответы ниже **дословно** для валидации, какие из `{{...}}` плейсхолдеров реально подставляются.

---

## Sample 1 — `subscriber.created`

**event_type:** `subscriber.created`. Body — canonical envelope с подстановкой `event_type`.

**Headers (raw, что фактически прислал ManyChat):**
```
<PASTE FULL HEADERS HERE>
```

**Body (raw JSON, фактический после подстановки полей ManyChat'ом):**
```json
<PASTE RAW BODY HERE>
```

**Validation observations:**
- Какие из `{{...}}` плейсхолдеров **реально** подставились (а не остались как литералы): `<TBD>`
- Какие из них пришли пустыми / null: `<TBD>`
- Тип значения `{{user_tags}}` (строка через запятую / массив / JSON-строка): `<TBD>`
- Реально ли пришёл `{{ts_ms}}` или его не существует и нужно вычислять серверно: `<TBD>`
- User-Agent ManyChat: `<TBD>`
- Source IP / диапазон: `<TBD>`
- Content-Type, который ManyChat реально ставит: `<TBD>`
- Доходит ли наш header `X-Workspace-Token` без модификаций: `<TBD>`

---

## Sample 2 — `message.received`

**event_type:** `message.received`. Body — canonical envelope.

**Headers (raw):**
```
<PASTE FULL HEADERS HERE>
```

**Body (raw JSON):**
```json
<PASTE RAW BODY HERE>
```

**Validation observations:**
- Доступно ли поле `{{ig_thread_id}}` или приходит пустым: `<TBD>`
- Доступно ли уникальное `provider_message_id` (для idempotency): `<TBD: КРИТИЧНО, от этого зависит dedup priority>`
- Передаются ли вложения (URL картинок/видео) и в каком формате: `<TBD>`
- Quick reply / referral payload: `<TBD>`

---

## Sample 3 — `subscriber.tagged`

**event_type:** `subscriber.tagged`. Тег **должен быть указан явно** в `correlation.client_event_id` или в дополнительном поле, потому что External Request в v1 вешается **на конкретный Flow с условием по тегу** — глобального события `tag.added` нет.

**Расширение envelope для этого event_type** — добавить в body:
```json
{
  "tag": { "name": "цб2025", "all_tags": "{{user_tags}}" }
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

**Validation observations:**
- `tag.name` пришёл как литерал из шаблона (т.е. мы **сами** управляем именем): `<TBD: подтвердить>`
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

> **Следствие:** так как ретраев нет, **наш endpoint обязан**: (а) отвечать 2xx даже на duplicate (чтобы Flow не падал); (б) внутренне ставить event в очередь и обрабатывать асинхронно через `domain_events`; (в) иметь отдельный pull-fallback для критичных событий (см. PATCH 2).

---

## Idempotency contract (финальный) — приоритетный ключ

ManyChat **не передаёт** глобальный `event_id`. Поэтому dedup строится по **приоритету ключей** (а не по единственному hash с time-bucket — это было бы небезопасно: два разных сообщения в одну секунду могли бы схлопнуться).

| Приоритет | Ключ | Условие | Когда применяется |
|---|---|---|---|
| **1 (primary)** | `correlation.client_event_id` | передан в payload | основной путь — генерируется в Flow как `{{user_id}}-{{ts_ms}}-{{flow_ns}}` |
| **2 (fallback)** | `sha256(workspace_id \| page_id \| subscriber_id \| event_type \| message.provider_message_id \| content_sha256)` | `provider_message_id` присутствует | для message.* events когда client_event_id не задан |
| **3 (last resort)** | `sha256(workspace_id \| page_id \| subscriber_id \| event_type \| floor(occurred_at_ms/1000) \| content_sha256)` | оба верхних отсутствуют | аварийный fallback с time-bucket; **известный риск false-dedup** при двух одинаковых сообщениях в одну секунду — фиксируется в risk register |

| Параметр | Значение |
|---|---|
| Окно dedup | 24h |
| Хранилище | `integration_inbound_events.idempotency_hash UNIQUE` |
| Поведение при коллизии | 200 OK `{status:"duplicate"}` без записи в downstream |
| Известное ограничение priority 3 | если оператор триггернёт **тот же** Flow дважды в одну секунду с тем же payload — это **может** склеиться. Для message-событий это приемлемо (там обычно есть `provider_message_id`); для биллинг-критичных событий обязателен `client_event_id` (priority 1). |

---

## Decision записи (заполнятся после live capture)

После живого capture сюда выписываются финальные контракты, которые пойдут в код PATCH 2:

- **Минимальный обязательный набор полей в External Request body:** `<заполнится>`
- **Headers, которые ManyChat реально ставит (для anti-spoof проверок):** `<заполнится>`
- **Список Flows, в которых нужно врезать External Request (при онбординге workspace):** `<заполнится>`
- **Pull-fallback частота для событий вне Flow:** `<решится после 0.3>`
- **Retry policy на нашей стороне:** idempotent upsert by `idempotency_hash` (по приоритету выше), 200 OK на duplicate, асинхронная обработка через `integration_inbound_events → domain_events → handlers`.
