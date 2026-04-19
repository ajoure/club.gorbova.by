## да, согласен, с учетом правок:

1. В `Diagnose` добавь ещё одну обязательную проверку: **создан ли вообще External Request в самом ManyChat Flow** и на какой URL/headers/body он сейчас настроен.  
Иначе можно долго искать баг в backend, а проблема окажется в том, что ManyChat вообще не шлёт запросы или шлёт не туда.  
Нужно зафиксировать:
  - exact URL;
  - exact headers;
  - exact JSON body template;
  - какой Flow/trigger это вызывает.
2. В п.2 `supabase--read_query` добавь проверку `integration_instances` **для ManyChat instance**:
  &nbsp;
  &nbsp;
  - есть ли `config`;
  - есть ли `config_secrets`;
  - есть ли `workspace_token` / `webhook_secret` / другой ingress-secret;
  - какой `status`.  
  Это важно, потому что входящий контур может рваться просто из-за отсутствия секрета или несогласованного имени ключа.
3. В логах и запросах не ищи только `manychat.external_request`.  
Ищи шире:
  - `manychat%`
  - `manychat.%`
  - `manychat_%`
  - `external_request`
  - `send_content`  
  Потому что фактический `event_type` мог быть назван иначе, и иначе diagnose даст ложный ноль.
4. В проверке `instagram_messages` уточни не только `provider_kind='manychat'`, но и последние записи по:
  - `provider_message_id`,
  - `raw_payload`,
  - `direction='inbound'`,
  - `created_at DESC`.  
  Нужно понять, не попадают ли сообщения в таблицу, но не видны в UI из-за фильтра/джойна.
5. В проверке `instagram_contacts` добавь поиск не только по `provider_kind='manychat'`, но и по:
  - тем же `peer_id/sender_id`, которые приходят из inbound payload;
  - `integration_instance_id` / `instagram_account_id`, если они участвуют в связке.  
  Иначе можно не увидеть, что контакт создаётся, но без `provider_kind` или в другой связке.
6. В ветках fix-плана добавь ещё одну ветку:  
**F. Inbound записывается в** `instagram_messages`**, но UI не поднимает диалог**  
Тогда проверять:
  - RPC/SQL, который строит список диалогов;
  - сортировку по latest message;
  - unread counter;
  - фильтр по `provider_kind`;
  - join на account/contact.  
  Это отдельный класс проблемы, не сводимый просто к “UI не видит”.
7. В DoD п.1 вместо `external_message_id` используй более общий критерий:
  - новая строка с корректным **provider-side message identifier** (`provider_message_id` или `external_message_id`, смотря что реально используется в коде).  
  Потому что после ваших последних правок primary ingress idempotency уже завязан на `provider_message_id`, и не надо жёстко прибивать DoD к старому имени поля.
8. В DoD добавь проверку по `integration_logs` **и** `domain_events` **без 500/failed cascade**:
  - ingress не должен создавать unhandled exception;
  - если дубликат — должен быть мягкий dedup, а не 500.  
  Это нужно явно закрепить.
9. В stop-condition уточни порядок:
  - сначала diagnose-отчёт;
  - потом **один** targeted fix-patch;
  - потом runtime-proof;
  - только потом возвращение к A8 или любым следующим задачам.  
  То есть A11 сейчас действительно должен стать приоритетом №1 до закрытия.

&nbsp;

В остальном план правильный: сначала установить фактическую точку разрыва, потом делать один адресный патч, а не стрелять вслепую.

&nbsp;

План: A11 — закрыть inbound-контур ManyChat → Contact Center

### Diagnose (что нужно проверить перед планом)

Прежде чем писать план, нужно установить факты:

1. Существует ли edge function `manychat-inbound` и `manychat-inbox-consumer` (ls + registry).
2. Если да — деплой/последние логи + есть ли вызовы из ManyChat External Request.
3. Есть ли записи в `integration_logs` с `event_type='manychat.external_request'` или похожим.
4. Создаются ли `domain_events` типа `manychat.message.inbound.v1` (или аналогичного).
5. Появляются ли строки в `instagram_messages` с `provider_kind='manychat'` за последний час.
6. Создаются ли `instagram_contacts` с `provider_kind='manychat'`.

Только после этого — конкретный fix-план для разорванного шага. Без этого писать план «вслепую» нельзя — может оказаться, что функции вообще нет, или есть, но не вызывается, или вызывается, но падает на парсинге, или доходит до consumer, но не пишет в `instagram_messages`.

### Что я сделаю в default mode (1 шаг — diagnose, без правок)

1. `code--list_dir supabase/functions` → проверить наличие `manychat-inbound`, `manychat-inbox-consumer`.
2. `supabase--read_query` →
  - последние 20 записей `integration_logs` где `event_type ILIKE 'manychat%'` за 2 часа;
  - последние 20 `domain_events` где `event_type ILIKE 'manychat%'`;
  - последние 20 `instagram_messages` где `provider_kind='manychat'`;
  - проверить `instagram_contacts` с `provider_kind='manychat'`.
3. `supabase--edge_function_logs` для `manychat-inbound` и `manychat-inbox-consumer` (если существуют) — последние ошибки.
4. Прочитать код `manychat-inbound/index.ts` и `manychat-inbox-consumer/index.ts` (если есть), чтобы понять текущий контракт ingestion.
5. Прочитать `instagram_messages` schema (CHECK на `direction`, `provider_kind` enum/values) чтобы знать ограничения вставки.

### Краткий отчёт после diagnose (формат)

```
A11 status:
- manychat-inbound: [exists?/deployed?/last invocation]
- manychat-inbox-consumer: [exists?/deployed?/last invocation]
- integration_logs (manychat.*): [count за 2h] / [последняя запись]
- domain_events (manychat.*): [count за 2h] / [последняя запись]
- instagram_messages (provider_kind='manychat'): [count] / [последняя]
- instagram_contacts (provider_kind='manychat'): [count]
- Точка разрыва: [ingress / parse / domain_event / consumer / DB write]
```

### Fix-план (составится ПОСЛЕ diagnose, с привязкой к точке разрыва)

Возможные ветки:

**A. `manychat-inbound` не существует** → создать функцию:

- POST endpoint, без verify_jwt (External Request от ManyChat не несёт наш JWT);
- shared secret в header `X-ManyChat-Token` (config_secrets.webhook_secret);
- payload normalize → `integration_logs` (event_type=`manychat.external_request`) + `DomainEventService.emitEvent('manychat.message.inbound.v1', ...)`;
- зарегистрировать в `supabase/functions.registry.txt`.

**B. `manychat-inbound` есть, но не вызывается** → дать пользователю готовый ingest URL + инструкцию настройки External Request в ManyChat (URL + headers + JSON body template).

**C. Вызывается, но падает (4xx/5xx)** → fix по конкретной ошибке из логов (auth, schema, parse).

**D. Долетает до `domain_events`, но consumer не отрабатывает** → проверить/починить `manychat-inbox-consumer` (или синхронный путь — записать сразу в `instagram_messages` без отдельного consumer на v1, как у Instagram apix-flow).

**E. Consumer пишет, но UI не видит** → проверить `provider_kind` фильтр в `get_inbox_dialogs_v1` / `instagram_messages` join, badge в `InstagramInboxView`.

### DoD (фиксированный, не зависит от ветки)

1. Тестовое сообщение в подключённый IG account через ManyChat → за ≤30 сек:
  - `integration_logs`: новая запись `event_type='manychat.external_request'`, status=ok;
  - `instagram_contacts`: запись с `provider_kind='manychat'` (created или updated);
  - `instagram_messages`: новая строка с `direction='inbound'`, `provider_kind='manychat'`, корректный `external_message_id`;
  - В UI `/admin/communication?tab=inbox` диалог поднимается наверх с непрочитанным счётчиком.
2. Повторная отправка того же сообщения (idempotency) → не создаёт дубль (`UNIQUE(account_id, external_message_id)` срабатывает мягко, без 500).
3. Невалидный shared secret → 401 + запись в `integration_logs` с status=`unauthorized`, без вставки в messages.
4. Existing apix_instagram_dm flow продолжает работать (regression).

### Stop-condition

После diagnose-отчёта — один targeted fix-патч под найденную точку разрыва, потом runtime-proof по DoD. Без новых параллельных задач до закрытия A11.