да, согласен, с учетом правок:

1. В [README.md](http://README.md) замени формулировку **«глобальной webhook-подписки в UI ManyChat нет»** на более точную: **«в v1 не используем глобальный webhook-механизм, потому что в официальных пользовательских docs подтверждён External Request внутри automation, а публичный API описывает pull/send endpoints; глобальный end-user webhook в используемом нами контуре документально не подтверждён»**. Так формулировка будет осторожной и не создаст ложный “абсолютный факт”.
2. В том же [README.md](http://README.md) зафиксируй **жёсткую границу v1: Instagram-only**. Пока вы переиспользуете instagram_accounts и instagram_messages, это допустимо только как compatibility-layer для Instagram. Для Facebook/WhatsApp/Telegram later нужен уже generic communications layer, иначе будет конфликт по смыслу сущностей. Это прямо соответствует вашему правилу не плодить хаос и не смешивать домены/модели.
3. В [diagnose-payloads.md](http://diagnose-payloads.md) оставь ваш JSON-контракт как **recommended canonical contract v1**, но добавь явную пометку: **реальный набор переменных и полей валидируется live capture в 3 тестовых Flows**. Официально External Request позволяет задавать method, URL, headers и body, но docs не гарантируют именно ваш состав payload — его вы определяете и подтверждаете тестом.
4. В блоке security лучше сделать **основным секрет в custom header**, а не в URL path. External Request официально позволяет задавать headers, поэтому X-Workspace-Token/X-Manychat-Token безопаснее, чем секрет в path, который чаще попадает в access logs. Path-secret можно оставить только как fallback, если уже завязаны маршруты, но тогда с обязательным redaction в логах.
5. Dedup strategy нужно усилить: не делай floor(occurred_at_ms/1000) частью единственного ключа как основной discriminator. Два разных сообщения с одинаковым текстом в одну секунду могут схлопнуться. Правильнее: **primary key = client_event_id если он передан**, fallback = hash от workspace_id | page_id | subscriber_id | event_type | provider_message_id | content_sha256, и только если provider_message_id отсутствует — тогда time bucket как аварийный fallback. Это соответствует вашему требованию к детерминированным связям и id-driven модели.
6. В [compatibility-report.md](http://compatibility-report.md) добавь отдельный раздел **“Source of truth for observability”**:  

  - real-time observability = только External Request из конкретных Flow/Actions;
  - off-flow observability = только pull/diff через Public API;
  - native Inbox actions не считаются наблюдаемыми в v1.  
  Это хороший и правильный вывод, но его нужно явно записать как контракт, чтобы подрядчик не обещал Inbox parity. Публичный API действительно показывает send/page/subscriber endpoints, а Manychat Inbox описывается как отдельный UI-продукт с manual messaging внутри окна.
7. В [capability-matrix.md](http://capability-matrix.md) исправь API-часть с токеном и лимитами: писать нужно **API Key из Settings → API для Account Public API**, а не page token; rate limit тоже нельзя описывать одной цифрой на всё — по docs лимиты зависят от endpoint-группы, поэтому в матрице и в NFR нужен **endpoint-aware throttling**.
8. В итоговом PATCH 0 добавь правило обработки через события: ingress не должен сразу становиться cross-domain бизнес-логикой. Правильный путь для v1: **ingress → normalize → integration_inbound_events → domain_events → downstream handlers/services**. Это обязательно, потому что по вашему platform bible домены не должны напрямую менять друг друга, а интеграции должны идти через adapters и event-driven core.
9. В DoD PATCH 0 добавь ещё 2 обязательных proof-пункта:
  - **duplicate replay proof**: один и тот же External Request повторно приходит и не создаёт дубль;
  - **off-flow diff proof**: хотя бы одно изменение вне Flow фиксируется только pull/diff-механизмом и не обещается как real-time.  
  Это нужно по вашему правилу deep review и proof-first, чтобы не осталось “серой зоны” между push и pull.
10. Пункт Windowing proof: 24h/7d/Pause Automation оставь, но раздели на два независимых proof-сценария:

&nbsp;

- **Manychat-native behavior**: Inbox/manual window 24h + 7-day manual behavior;
- **our custom path**: что реально происходит при send из вашего ingress/adapter.  
По официальным docs 7-дневное окно для Instagram/Messenger относится к manual messages via Inbox, а automations после первых 24 часов уже не доставляются; Pause all automations тоже существует как отдельное action в automation builder. Поэтому нельзя смешивать нативное поведение Inbox и ваш внешний send-path в один недоказанный тезис.

11. В [external-request-setup.md](http://external-request-setup.md) добавь NFR-ограничения Dev Tools: **HTTPS обязателен**, request настраивается как method + URL + headers + body внутри automation, а сам Push существует только там, куда вы вручную вставили action. Это укрепит ваш single-path и снимет ожидание “магического” глобального ingress.
12. В final text PATCH 0 добавь одну фразу про add-only/no-loss: **старые упоминания webhook-гипотезы не удаляются бесследно, а переводятся в deprecated/invalidated assumption с явным mapping old → new**. Это нужно по вашему правилу add-only и запрету на потерю содержания при ревизии плана.

В остальном направление верное: single-path Hybrid для v1, отказ от обещаний parity с native Inbox, push только через External Request, всё остальное через pull/diff — это согласуется и с текущими официальными docs Manychat, и с вашими архитектурными правилами.

&nbsp;

# План: Финализация PATCH 0 — единый путь Hybrid (Pull API + Push External Request)

## Что делаю

Полный cleanup всех артефактов PATCH 0 от старой гипотезы про `Settings → API → Webhooks` и фиксация единственного утверждённого пути для v1. Без альтернатив A/B/C.

## Файлы к обновлению (5 шт.)

### 1. `docs/integrations/manychat/README.md` — переписать целиком

- Удалить любые упоминания `Settings → API → Webhooks`.
- Зафиксировать как факт: глобальной webhook-подписки в UI ManyChat нет.
- Единственный утверждённый ingress v1: **External Request action внутри Flows**.
- Всё, что вне Flow → только pull/diff через Public API.
- Обновить roadmap: PATCH 0 → 5 с пометкой «hybrid Pull+Push approved».
- Hard-stops: убрать упоминания webhook subscription; добавить «не обещаем parity с native ManyChat Inbox».

### 2. `docs/integrations/manychat/diagnose-payloads.md` — переписать

- Убрать формулировки про headers глобального webhook.
- Зафиксировать, что headers контролируем мы сами (через UI External Request) — список Content-Type, наш `X-Workspace-Token` и т.д.
- Дать **точный рекомендуемый JSON-контракт v1** для External Request body:
  ```json
  {
    "event_type": "message.received | subscriber.created | subscriber.tagged | subscriber.field_updated | flow.completed",
    "workspace": { "manychat_page_id": "...", "manychat_business_id": "..." },
    "flow": { "flow_ns": "...", "flow_name": "...", "step_id": "..." },
    "subscriber": { "manychat_subscriber_id": "...", "ig_username": "...", "ig_id": "..." },
    "message": { "provider_message_id": "...", "thread_key": "...", "text": "...", "attachments": [] },
    "custom_fields": { "...": "..." },
    "system": { "last_input_text": "...", "last_interaction_ms": 0, "user_tags": [] },
    "occurred_at_ms": 0,
    "correlation": { "client_event_id": "{{user_id}}-{{ts_ms}}-{{flow_ns}}", "content_sha256": "<computed>" }
  }
  ```
- Capture procedure через 3 тестовых Flow остаётся, но без упоминания «webhooks».

### 3. `docs/integrations/manychat/capability-matrix.md` — добавить новую секцию

Структурировать матрицу по 4 колонкам:

- **Покрывается Public API (Pull)** — getSubscriberInfo, getTags, getCustomFields, sendContent, addTag, setCustomField, getFlows.
- **Покрывается External Request (Push, real-time)** — message.received, subscriber.created, subscriber.tagged, flow.completed (и только то, куда мы вручную врежем action).
- **Не покрывается в v1** — ручные действия в native Inbox, Stories Reply, voice, status delivered/read вне Flow.
- **Deferred (Phase 2)** — full Manychat App (OAuth + moderation), Inbox parity, advanced event bridge, multi-channel.

### 4. `docs/integrations/manychat/compatibility-report.md` — обновить выводы

- Убрать любую зависимость от «нативных webhook events».
- Список event_type, реально получаемых через External Request: `message.received`, `subscriber.created`, `subscriber.tagged`, `subscriber.untagged`, `subscriber.field_updated`, `flow.completed`.
- Список событий **только pull/diff**: ручные ответы оператора в Inbox, изменение тегов вне Flow, изменение custom fields вне Flow, opt-out вне Flow.
- DDL-расширения для `instagram_messages` остаются как были.

### 5. `docs/integrations/manychat/external-request-setup.md` — обновить

- Уже создан, но дополнить:
  - **Security contract**: `shared_secret_token` в URL path обязателен; валидируется на ingress; нативной HMAC-signature от ManyChat нет — защита = shared secret + allowlist по `manychat_page_id` + dedup по `idempotency_hash`.
  - **Allowlist**: `manychat_page_id` (из payload) сверяется со списком в `integration_instances.config.allowed_page_ids`.
  - **Dedup strategy**: `idempotency_hash = sha256(workspace_id | page_id | subscriber_id | event_type | floor(occurred_at_ms/1000) | content_sha256)`. UNIQUE на `integration_inbound_events.idempotency_hash`. Дубликат → 200 OK без записи.
  - Точный JSON template (тот же, что в diagnose-payloads.md) — copy-paste для оператора.
  - Шаги в UI ManyChat: Flow → `+` → Action → External Request → Method POST → URL с `{shared_secret_token}` → Headers `Content-Type: application/json` → Body Custom JSON.

## Итоговый PATCH 0 (финальная редакция)

После обновления всех 5 артефактов — единый утверждённый PATCH 0:

```text
PATCH 0 / DIAGNOSE (final, single path)

Strategy: Hybrid
  - Pull  = ManyChat Public API (on-demand + cron)
  - Push  = External Request action внутри конкретных Flows
  - Global webhook subscription = НЕ существует в UI ManyChat (зафиксировано)

Границы v1:
  - real-time только из Flows с нашим External Request
  - вне Flow → только pull/diff
  - native Inbox actions = НЕ наблюдаемы
  - parity с Inbox = НЕ обещаем

Security ingress:
  - shared_secret_token в URL path (mandatory)
  - allowlist manychat_page_id
  - dedup idempotency_hash (24h window)
  - native signature = отсутствует (compensated by 3-layer guard)

DoD PATCH 0:
  1. README обновлён, упоминаний Settings→API→Webhooks нет
  2. diagnose-payloads.md содержит финальный JSON-контракт v1
  3. capability-matrix.md имеет 4-колоночную секцию (Pull / Push / Not v1 / Deferred)
  4. compatibility-report.md перечисляет push-events vs pull-only events
  5. external-request-setup.md содержит security contract + dedup + allowlist
  6. Live capture: 3 payload в manychat_diagnose_log из 3 тестовых Flows
  7. Windowing proof: 24h/7d/Pause Automation тесты проведены на тестовом IG
```

После approve — обновлю 5 файлов одной волной, без переименования endpoint.