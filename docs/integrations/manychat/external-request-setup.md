# External Request setup — точная инструкция для оператора ManyChat

**Назначение:** этот файл — пошаговая инструкция, как настроить отправку события из Flow в нашу платформу через нативный механизм ManyChat **External Request**.

> Это **единственный** нативный способ доставить real-time событие из ManyChat в нашу систему: глобальной подписки на webhooks в UI ManyChat **нет**, и мы её не имитируем.

---

## Pre-requisites

| # | Требование | Где взять |
|---|---|---|
| 1 | План ManyChat — **Pro** (или выше) | подтверждено probe `is_pro=true` |
| 2 | API Key workspace | `Settings → API → API Key` (нужен только для Pull-канала, не для External Request) |
| 3 | `shared_secret_token` нашего workspace | выдаётся в нашей админке после создания integration_instance в PATCH 1 (для PATCH 0 capture — выдаётся вручную инженером) |
| 4 | URL endpoint | для PATCH 0 capture: `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/manychat-diagnose-capture/{shared_secret_token}` <br> для PATCH 2 production: `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/manychat-event-ingest/{shared_secret_token}` |

---

## Шаги в UI ManyChat

> Скриншоты не прикладываем — UI ManyChat меняется, описываем по навигационным меткам.

### Шаг 1. Открыть нужный Flow
1. Левое меню → **Automation** → **Flows**.
2. Открыть Flow, на котором должно сработать событие (например, Flow «ЦБ 2025», запускающийся при тегировании подписчика тегом `цб2025`).
3. Если такого Flow ещё нет — создать через **+ New Flow** и привязать к нужному триггеру (Trigger → Tag Applied / Default Reply / Keyword / etc).

### Шаг 2. Добавить блок External Request
1. На канвасе Flow найти место **перед** ключевым шагом (например, перед `Send Message`) или **после** (для post-event нотификации).
2. Нажать `+` между блоками → выбрать **Action** → **External Request**.
   - Если пункта `External Request` нет в списке — план workspace **ниже Pro**, путь невозможен.

### Шаг 3. Настроить External Request

**В открывшейся карточке External Request:**

| Поле | Значение |
|---|---|
| **Method** | `POST` |
| **URL** | полный capture/production URL **с встроенным `shared_secret_token` в path** (см. таблицу выше). Пример: `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/manychat-diagnose-capture/abcd1234...` |
| **Headers** | `Content-Type: application/json` (обязательно) |
| **Body type** | `Custom JSON` |
| **Body** | один из шаблонов из [diagnose-payloads.md](./diagnose-payloads.md) (Sample 1 / 2 / 3) — **с обязательным включением** полей `manychat_page_id`, `manychat_subscriber_id`, `event_type`, `occurred_at_ms` |
| **Response Mapping** | в PATCH 0 — **не настраивать** (нам не нужен ответ). В PATCH 4 при использовании Dynamic Block — настраивается отдельно для inline-ответов из платформы. |

### Шаг 4. Сохранить и опубликовать
1. Нажать **Save** на карточке External Request.
2. В правом верхнем углу Flow нажать **Publish** (если Flow ещё не опубликован — иначе draft не выполняется).

### Шаг 5. Проверить через Preview
1. В Flow → **Preview** → выполнить как тестовый подписчик.
2. После прохождения External Request action → открыть **Flow History** (правый сайдбар Flow → значок часов).
3. Найти запись External Request → проверить:
   - **Response code** = 200
   - **Response body** = `{"status":"accepted",...}` или `{"status":"duplicate",...}`
   - Если 401 → неверный `shared_secret_token` в URL.
   - Если 403 → `manychat_page_id` не добавлен в allowlist на нашей стороне.
   - Если 400 → не хватает обязательных полей в body.

---

## Какие переменные ManyChat доступны в Body (для шаблонов)

| Группа | Переменная | Что содержит |
|---|---|---|
| **System** | `{{user_id}}` | ManyChat subscriber ID (внутренний, основной для нас) |
| | `{{page_id}}` | ManyChat page ID (Instagram-страница) |
| | `{{first_name}}`, `{{last_name}}` | имя/фамилия подписчика |
| | `{{ig_username}}` | Instagram username |
| | `{{ig_id}}` | Instagram User ID (graph-id) |
| | `{{subscribed}}` | timestamp подписки |
| | `{{last_interaction}}` | timestamp последнего сообщения от подписчика |
| | `{{user_tags}}` | список тегов подписчика (формат фиксируется в diagnose-payloads.md по факту) |
| | `{{ts_ms}}` | текущий timestamp в мс (если ManyChat поддерживает — иначе пропускаем) |
| **Last input** | `{{last_input_text}}` | текст последнего сообщения подписчика |
| | `{{ig_thread_id}}` | Instagram thread ID (если доступен) |
| **Custom Fields** | `{{cuf_<имя>}}` | значения custom fields workspace |

> Точный список доступных полей **проверяется** в PATCH 0.1 capture — фиксируется в `diagnose-payloads.md` секции «Наблюдения».

---

## Что **НЕ** настраивается через External Request (известные ограничения)

| Хочется | Почему невозможно через External Request | Альтернатива |
|---|---|---|
| Глобальная подписка «на любой тег» | External Request живёт **внутри Flow**, не глобально | для каждого критичного тега — отдельный Flow с триггером Tag Applied |
| Событие при ручном ответе оператора в ManyChat Inbox | Inbox-действия не запускают Flows | pull-diff по `last_interaction` (PATCH 2 cron) |
| Гарантия retry на 5xx | External Request делает **1 попытку**, без retry | наш endpoint всегда 2xx + внутренняя очередь |
| Криптографическая подпись payload | ManyChat не подписывает External Request | `shared_secret_token` в URL + allowlist по `page_id` |
| Глобальный event_id для idempotency | ManyChat не передаёт уникальный ID события | dedup по `sha256` (см. README.md) |

---

## Чек-лист перед сдачей PATCH 0.1

- [ ] План workspace = Pro (External Request доступен)
- [ ] `shared_secret_token` получен и **никому** кроме редактора Flow не передан
- [ ] 3 тестовых Flow / 3 ветки с External Request действиями созданы
- [ ] Каждый body содержит `manychat_page_id`, `manychat_subscriber_id`, `event_type`, `occurred_at_ms`
- [ ] Все 3 Flow опубликованы (Publish, не Draft)
- [ ] Триггер каждого Flow вручную выполнен через тестового подписчика
- [ ] В Flow History видны Response 200 от capture endpoint
- [ ] В нашей таблице `manychat_diagnose_log` лежат 3 записи (проверяет инженер)
- [ ] Сообщить инженеру: «PATCH 0.1 capture готов»
