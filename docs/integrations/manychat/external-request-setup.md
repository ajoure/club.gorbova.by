# External Request setup — точная инструкция для оператора ManyChat

**Назначение:** этот файл — пошаговая инструкция, как настроить отправку события из Flow в нашу платформу через нативный механизм ManyChat **External Request**, и точный security/dedup контракт.

> Это **единственный** нативный путь push v1: глобальная подписка на webhooks в нашем контуре документально не подтверждена, мы её **не имитируем** и **не обещаем**.

---

## NFR / границы Dev Tools (обязательно к прочтению)

| Параметр | Значение |
|---|---|
| Тип action в UI | `Action → External Request` (ранее назывался Dynamic Block) |
| Где живёт | **Только внутри automation/Flow.** Глобального ingress «на всё подряд» нет. |
| Доступность | **Pro-only feature** (у нас `is_pro=true` подтверждён) |
| Method | задаётся вручную (используем `POST`) |
| URL | задаётся вручную; **HTTPS обязателен** |
| Headers | задаются вручную (`Content-Type`, `X-Workspace-Token` и т.д.) |
| Body | Custom JSON (поддержка `{{...}}` плейсхолдеров) |
| Hard timeout | 10 секунд |
| Auto-retry на 5xx | **нет** (1 попытка) |
| Подпись payload | **отсутствует** (ManyChat не подписывает) |

**Следствие:** push-канал **существует только там, куда мы вручную врезали External Request action**. Никакого «магического» глобального ingress в v1 нет.

---

## Pre-requisites

| # | Требование | Где взять |
|---|---|---|
| 1 | План ManyChat — **Pro** (или выше) | подтверждено probe `is_pro=true` |
| 2 | API Key workspace (Account-level) | `Settings → API → API Key` (только для Pull-канала) |
| 3 | `X-Workspace-Token` (наш header-secret) | выдаётся в нашей админке после создания integration_instance в PATCH 1 (для PATCH 0 capture — выдаётся вручную инженером) |
| 4 | URL endpoint | для PATCH 0 capture: `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/manychat-diagnose-capture/` <br> для PATCH 2 production: `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/manychat-event-ingest/` |

---

## Security contract (обязательно)

### Уровень 1 — Authn: header-secret (основной канал)

**Основной канал секрета — HTTP header, НЕ URL path.**

| Параметр | Значение |
|---|---|
| Имя header | `X-Workspace-Token` |
| Формат | random 32-byte URL-safe (`base64url(randomBytes(32))`), per workspace |
| Хранение у нас | `integration_instances.config_secrets` (Vault-encrypted) |
| Хранение у ManyChat | поле Header в карточке External Request (visible только редакторам Flow) |
| Проверка на ingress | constant-time compare с stored token |
| Rotation | ручной reissue в нашей админке → старый `revoked_at = now()` → операторская задача обновить header во всех Flows |

**Почему НЕ URL path:**
- URL path попадает в access logs gateway/CDN/прокси с большей вероятностью, чем header;
- header можно тривиально скрыть в логах с regex по имени;
- ManyChat External Request официально поддерживает кастомные headers — нет причин ослаблять security.

**Path-secret = только legacy fallback:**
- допускается, если уже завязаны маршруты (например, capture endpoint в PATCH 0);
- в этом случае **обязателен redaction**: secret в path заменяется на `sha256(token)[:8]` в `manychat_diagnose_log.raw_url`;
- в PATCH 2 production endpoint — **только header-secret**, path-secret deprecated.

### Уровень 2 — Authz: allowlist

| Параметр | Значение |
|---|---|
| Что проверяется | `payload.workspace.manychat_page_id` ∈ allowlist для данного `integration_instance_id` |
| Где хранится allowlist | `integration_instances.config.allowed_page_ids` (jsonb массив) + дублирование в `instagram_accounts.instagram_page_id WHERE provider_kind='manychat'` |
| Дополнительно | если в payload есть `manychat_business_id` — также проверяется против `config.allowed_business_ids` |
| Несовпадение | `403 page_not_in_allowlist` + лог в `audit_logs` |

### Уровень 3 — Integrity: dedup по приоритетному ключу

> **Не используем** floor(time/1000) как **единственный** discriminator — два разных сообщения в одну секунду могли бы схлопнуться. Вместо этого — **приоритет ключей**.

| Приоритет | Ключ | Когда применяется |
|---|---|---|
| **1 (primary)** | `correlation.client_event_id` из payload | основной путь — Flow генерирует `{{user_id}}-{{ts_ms}}-<flow_ns>` |
| **2 (fallback)** | `sha256(workspace_id \| page_id \| subscriber_id \| event_type \| message.provider_message_id \| content_sha256)` | если provider_message_id присутствует |
| **3 (last resort)** | `sha256(workspace_id \| page_id \| subscriber_id \| event_type \| floor(occurred_at_ms/1000) \| content_sha256)` | оба верхних отсутствуют; известный риск false-dedup |

| Параметр | Значение |
|---|---|
| Хранилище | `integration_inbound_events.idempotency_hash UNIQUE` |
| Окно валидности | 24h |
| Ответ при коллизии | `200 OK { "status": "duplicate" }` без записи в downstream |

### Сводка: компенсация отсутствия нативной подписи

ManyChat **не предоставляет** HMAC / RSA подпись External Request. Защита = **header-secret + allowlist + dedup по приоритету**. Это явный известный компромисс v1; полноценная подпись доступна только в Manychat App (deferred Phase 2).

---

## Canonical JSON template (copy-paste для оператора)

Вставляется в External Request → Body → Custom JSON. Меняется только `event_type` и `flow.flow_ns` / `flow.flow_name`.

```json
{
  "event_type": "message.received",
  "workspace": {
    "manychat_page_id": "{{page_id}}",
    "manychat_business_id": ""
  },
  "flow": {
    "flow_ns": "<заполнить ns Flow вручную>",
    "flow_name": "<человекочитаемое имя Flow>",
    "step_id": ""
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

**Допустимые `event_type`:** `message.received` | `subscriber.created` | `subscriber.tagged` | `subscriber.untagged` | `subscriber.field_updated` | `flow.completed`.

Для `subscriber.tagged` — добавить блок:
```json
"tag": { "name": "цб2025", "all_tags": "{{user_tags}}" }
```

---

## Шаги в UI ManyChat

### Шаг 1. Открыть нужный Flow
1. Левое меню → **Automation** → **Flows**.
2. Открыть Flow, на котором должно сработать событие.
3. Если Flow ещё нет — создать через **+ New Flow** и привязать к нужному триггеру.

### Шаг 2. Добавить блок External Request
1. На канвасе Flow найти место **перед** или **после** ключевого шага.
2. Нажать `+` между блоками → **Action** → **External Request**.
   - Если пункта `External Request` нет в списке — план workspace **ниже Pro**, путь невозможен.

### Шаг 3. Настроить External Request

| Поле | Значение |
|---|---|
| **Method** | `POST` |
| **URL** | `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/manychat-diagnose-capture` (PATCH 0) или `.../manychat-event-ingest` (PATCH 2). **HTTPS обязателен.** |
| **Headers** | `Content-Type: application/json` (обяз.); **`X-Workspace-Token: <ваш токен>`** (обяз.); `X-Event-Source: manychat-external-request/v1` (рекоменд.) |
| **Body type** | `Custom JSON` |
| **Body** | canonical template выше (с подстановкой `event_type` и `flow.flow_ns`) |
| **Response Mapping** | в PATCH 0 — **не настраивать**. В PATCH 4 (Dynamic Block для inline-ответов) — настраивается отдельно. |

### Шаг 4. Сохранить и опубликовать
1. **Save** на карточке External Request.
2. **Publish** Flow (без publish draft не выполняется).

### Шаг 5. Проверить через Preview
1. Flow → **Preview** → выполнить как тестовый подписчик.
2. Открыть **Flow History** (правый сайдбар).
3. Найти запись External Request → проверить:
   - **Response code** = 200
   - **Response body** = `{"status":"accepted",...}` или `{"status":"duplicate",...}`
   - 401 → неверный `X-Workspace-Token`
   - 403 → `manychat_page_id` не в allowlist
   - 400 → не хватает обязательных полей в body

---

## Доступные переменные ManyChat (для подстановки в Body)

| Группа | Переменная | Что содержит |
|---|---|---|
| **System** | `{{user_id}}` | ManyChat subscriber ID (основной для нас) |
| | `{{page_id}}` | ManyChat page ID |
| | `{{first_name}}`, `{{last_name}}` | имя/фамилия |
| | `{{ig_username}}` | Instagram username |
| | `{{ig_id}}` | Instagram User ID (graph-id) |
| | `{{subscribed}}` | timestamp подписки |
| | `{{last_interaction}}` | timestamp последнего сообщения от подписчика |
| | `{{user_tags}}` | список тегов (формат фиксируется в diagnose-payloads.md по факту) |
| | `{{ts_ms}}` | текущий timestamp в мс (если ManyChat поддерживает — иначе пропускаем) |
| **Last input** | `{{last_input_text}}` | текст последнего сообщения |
| | `{{ig_thread_id}}` | Instagram thread ID (если доступен) |
| **Custom Fields** | `{{cuf_<имя>}}` | значения custom fields workspace |

> Точный список доступных полей **проверяется** в PATCH 0.1 capture — фиксируется в `diagnose-payloads.md` секции «Validation observations».

---

## Что **НЕ** настраивается через External Request (известные ограничения)

| Хочется | Почему невозможно | Альтернатива |
|---|---|---|
| Глобальная подписка «на любой тег» | External Request живёт **внутри Flow**, не глобально | для каждого критичного тега — отдельный Flow с триггером Tag Applied |
| Событие при ручном ответе оператора в native ManyChat Inbox | Inbox-действия не запускают Flows | pull-diff по `last_interaction` (PATCH 2 cron) |
| Гарантия retry на 5xx | External Request делает 1 попытку, без retry | наш endpoint всегда 2xx + внутренняя очередь через `integration_inbound_events → domain_events` |
| Криптографическая подпись payload | ManyChat не подписывает | `X-Workspace-Token` + allowlist по `page_id` + dedup |
| Глобальный event_id для idempotency | ManyChat не передаёт уникальный ID события | приоритетный ключ: `client_event_id` → `provider_message_id` hash → time-bucket fallback |

---

## Чек-лист перед сдачей PATCH 0.1

- [ ] План workspace = Pro (External Request доступен)
- [ ] `X-Workspace-Token` получен и **никому** кроме редактора Flow не передан
- [ ] 3 тестовых Flow / 3 ветки с External Request action созданы
- [ ] Каждый body содержит canonical envelope (`workspace`, `subscriber`, `event_type`, `occurred_at_ms`, `correlation.client_event_id`)
- [ ] Header `X-Workspace-Token` задан в каждом External Request
- [ ] URL — HTTPS
- [ ] Все 3 Flow опубликованы (Publish, не Draft)
- [ ] Триггер каждого Flow вручную выполнен через тестового подписчика
- [ ] В Flow History видны Response 200 от capture endpoint
- [ ] В нашей таблице `manychat_diagnose_log` лежат 3 записи (проверяет инженер)
- [ ] Сообщить инженеру: «PATCH 0.1 capture готов»
