# да, согласен    

Сверка внесения замечаний:

**Внесено:**

- добавлен обязательный **PATCH 0 / DIAGNOSE** до кодовых работ;
- исправлен контракт по токену: теперь это **API Key**, а не “Page API Token на страницу”;
- убрана жёсткая цена, заменено на **paid plan / tier валидируется в PATCH 0**;
- исправлен rate limit на **endpoint-aware throttling**;
- scope сужен до **Instagram-only v1**;
- убрано обещание **full parity с ManyChat Inbox**;
- `createSubscriber` больше не используется как универсальный IG-сценарий;
- сигнатура webhook переведена в статус **неподтверждённого контракта до live capture**;
- разделён режим **ManyChat Inbox vs наш кастомный inbox через API**;
- `Pause Automation` оформлен как **явный runtime-контракт**;
- webhook переведён на **domain-events path**, без прямой записи в CRM;
- identity переведён на **provider-id-first** вместо email/phone-first;
- DDL усилен: `workspace_id`, composite uniqueness, `raw_payload`, `idempotency_hash`, отдельная таблица `manychat_subscribers`;
- добавлены **NFR/ограничения** для Dynamic Block;
- DoD усилен до **machine-check proof**;
- deferred пополнен теми хвостами, которые не должны блокировать v1.

**Что особенно хорошо в новой редакции:**

- план теперь соответствует вашему правилу **Diagnose → Plan → Dry run → Execute → Verify**;
- соблюдён **add-only** и compatibility-подход;
- сохранён reuse существующего inbox без создания лишнего параллельного UI;
- архитектурно план стал совместим с принципами **domain isolation / id-driven architecture / auditability**.  

Критических невнесённых замечаний не осталось.

&nbsp;

План: ManyChat ↔ платформа (финальная редакция, Instagram-only v1)

## Engineering flow: Diagnose → Plan → Dry run → Execute → Verify

---

## PATCH 0 — DIAGNOSE (обязательный pre-execution gate)

Без выполнения PATCH 0 кодовые PATCH 1+ заблокированы. Артефакты PATCH 0 — единственный источник истины для всех контрактов ниже.

### 0.1. Live capture реальной телеметрии

- Подключить тестовый ManyChat workspace через временный ngrok-endpoint (или временный edge без бизнес-логики).
- Снять **3 живых webhook payload**: `subscriber:created`, `message:received`, `subscriber:tagged`.
- Зафиксировать **ВСЕ headers** входящего запроса (имя сигнатурного заголовка, формат HMAC, encoding, timestamp-схема).
- Зафиксировать поведение **retry**: после 5xx — есть ли повтор, через сколько, с тем же payload или новым `event_id`.
- Зафиксировать **idempotency**: есть ли в payload уникальный `event_id`/`message_id`, на который можно навесить idempotency hash.

### 0.2. Capability matrix конкретного аккаунта

- Получить через API список **доступных в текущем тарифе webhook events** (не все события доступны на всех планах).
- Получить лимиты Send API на текущем плане.
- Зафиксировать наличие **Dynamic Block / External Request** в плане (feature gated).
- Зафиксировать наличие **Inbox seats** и handover protocol в плане.

### 0.3. Live тесты windowing и статусов

- Тест **24h окна Instagram**: `sendContent` через 25 часов после последнего входящего → зафиксировать точный код ошибки и message от ManyChat.
- Тест **7-дневного manual окна**: попытка `sendContent` с тегом `HUMAN_AGENT` через 3 дня → доставлено или нет.
- Тест **delivered/read статусов**: приходят ли через webhook реально, с каким lag, для какого канала.
- Тест **Pause Automation**: ручной trigger action из API → реально ли блокирует Flow.

### 0.4. Compatibility check существующих сущностей

- `instagram_accounts.provider_kind` — есть ли enum, требует ли расширения, есть ли уже значения, конфликтующие с `'manychat'`.
- `instagram_messages` — какие поля переиспользуем 1:1, какие требуют расширения (`provider_message_id`, `thread_key`, `direction`, `status`, `sent_at`, `delivered_at`, `read_at`, `raw_payload`).
- ApiX-Drive flow — какие константы/enums нельзя ломать.

**DoD PATCH 0:**

- 3 живых webhook payload + headers сохранены в `docs/integrations/manychat/diagnose-payloads.md`
- Capability matrix аккаунта зафиксирована в `docs/integrations/manychat/capability-matrix.md`
- Журнал live-тестов окон/статусов в `docs/integrations/manychat/windowing-proof.md`
- Compatibility report по `instagram_*` таблицам с явным diff требуемых полей

---

## Корректировки фактов (применены ко всему плану)


| Было                                 | Стало                                                                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page API Token на одну страницу      | **API Key** в Settings → API (Account Public API / workspace-level), исторически endpoints `/fb/*`                                                                                        |
| ManyChat Pro $15/мес                 | **Paid plan с доступом к API / DevTools / Inbox seats**; конкретный tier и цена валидируются в PATCH 0 на момент подключения                                                              |
| 10 req/sec на токен                  | **Endpoint-aware throttler**: `sendContent`/`sendFlow` ~25 RPS, `getFlows` ~10 RPS, page/subscriber методы до ~100 RPS — точные значения фиксируются в PATCH 0                            |
| Каналы IG/FB/WA/TG в v1              | **Instagram-only в v1**. Reuse `instagram_*` — допустимый compatibility layer только для IG. Multi-channel — отдельный generic communications model в Phase 2 (deferred)                  |
| Full parity с ManyChat Inbox         | **Compatibility layer над webhook + Send API**. Не зеркалим seats/assignment/analytics/handover Inbox — это deferred                                                                      |
| `createSubscriber` универсально      | Для IG v1 контакт появляется **только через входящее сообщение / opt-in / automation в ManyChat**. `createSubscriber` proactive не используется (это WhatsApp-сценарий per ManyChat docs) |
| HMAC `X-Manychat-Signature` как факт | **Имя заголовка, схема подписи и secret-contract фиксируются по live capture в PATCH 0**. До этого считаются неподтверждёнными                                                            |


---

## Архитектурные правила (по platform bible)

### Domain isolation (обязательно)

`manychat-webhook` НЕ пишет напрямую в CRM/Deals/contacts. Контракт:

```
manychat-webhook
  → normalize (provider payload → internal canonical event)
  → DomainEventService.emitEvent('manychat.message.received' | 'manychat.subscriber.tagged' | ...)
  → downstream domain handlers (CRM, contacts, inbox) — каждый в своём домене
  → DomainExecution + audit_logs
```

Никаких прямых INSERT в `crm_deals` из webhook. Это правило зафиксировано в `mem://architecture/backend/domain-event-infrastructure`.

### Identity / matching (id-first contract)

- **Primary key для identity** = `(workspace_id, integration_instance_id, manychat_subscriber_id)`
- email/phone/name — **никогда не primary**, только secondary merge-candidate через отдельный deterministic merge flow или manual review queue
- На webhook-уровне создаём/обновляем provider-bound identity; merge с platform `contacts` — отдельный пайплайн с явным confidence score

### Two-window model (явно разделить)

1. **Что гарантированно работает в ManyChat Inbox** (24h base + 7d manual + auto Human Agent + auto 30-min pause) — **не наша зона ответственности**, не обещаем.
2. **Что доказано работает из платформы через API** — фиксируется в PATCH 0 live-proof. До PATCH 0 ничего не обещаем.

### Pause Automation как явный runtime-контракт

При первом ответе оператора из платформы `manychat-send` ОБЯЗАН:

1. Вызвать ManyChat action `Pause all automations` для подписчика (или эквивалент из PATCH 0 capability matrix).
2. Записать `domain_events: 'manychat.automation.suppressed'` с TTL.
3. Auto-pause встроенного Inbox (30 мин) НЕ применяется к нашему flow — мы не можем на это рассчитывать.

---

## DDL / Data contract (усиленный)

Все новые таблицы и расширения обязаны включать:

- `workspace_id` (multi-tenant обязательно)
- `id`, `public_id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `metadata jsonb`
- `raw_payload jsonb` (для inbound webhook)
- composite uniqueness — не глобальный unique на `manychat_subscriber_id`
- `idempotency_hash` на inbound webhook events

### Минимальные изменения схемы

`**instagram_messages` — расширить:**

- `provider_kind text` (default `'apixdrive'` для legacy совместимости)
- `provider_message_id text`
- `thread_key text` (детерминированный ключ треда)
- `direction text` (`inbound`/`outbound`)
- `status text` (`queued`/`sent`/`delivered`/`read`/`failed`)
- `sent_at`, `delivered_at`, `read_at timestamptz`
- `raw_payload jsonb`
- `idempotency_hash text`
- composite unique: `(workspace_id, integration_instance_id, provider_message_id)`

`**instagram_accounts` — расширить:**

- `provider_kind` enum: добавить `'manychat'`

**Новая таблица `manychat_subscribers`:**

- стандартные служебные поля (см. выше)
- `manychat_subscriber_id text not null`
- `integration_instance_id uuid not null`
- `contact_id uuid null` (link to platform contacts, nullable до merge)
- `merge_confidence numeric null`
- `raw_subscriber jsonb`
- composite unique `(workspace_id, integration_instance_id, manychat_subscriber_id)`

**Новая таблица `integration_event_mappings`:**

- стандартные поля
- `instance_id uuid`
- `platform_event text` (например `order.paid`)
- `manychat_action text` (`trigger_flow` / `add_tag` / `set_field`)
- `target_ref text` (flow_ns / tag_name / field_name)
- `mapping jsonb`

---

## NFR / технические ограничения (явно)

### Dynamic Block / External Request

- Доступен только на определённых paid plans (валидируется в PATCH 0)
- HTTPS only
- **Timeout 10 секунд** на стороне ManyChat
- Response mapping — JSON по фиксированной схеме ManyChat (messages/actions/quick_replies)
- Format/version limits — фиксируются в PATCH 0

### Throttling

- Endpoint-aware token bucket per `(integration_instance_id, endpoint_group)`
- Группы: `send` (25 RPS), `read_meta` (10 RPS), `subscriber_ops` (~100 RPS) — точные значения из PATCH 0
- Backoff: exponential с jitter, max 3 retry для 429/5xx
- Idempotency-key обязателен для `sendContent`

### Security

- API Key хранится в `integration_instances.config.api_key` (encrypted)
- Webhook secret генерируется при создании instance, показывается один раз
- Подпись webhook — контракт фиксируется по PATCH 0 capture
- Verify JWT для всех админских вызовов из UI

---

## Hard-stops

- НЕ трогаем ApiX-Drive (legacy остаётся параллельно)
- НЕ создаём новый Inbox UI (compatibility layer через `instagram_messages`)
- НЕ дублируем категорию «Соцсети»
- НЕ обещаем full parity с ManyChat Inbox
- НЕ используем email/phone как primary identity
- НЕ пишем напрямую в CRM из webhook
- v1 — **только Instagram**

---

## Roadmap (PATCH 0 → 5, add-only)


| PATCH                                    | Содержание                                                                                                                                                                                    | Gate                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **0. DIAGNOSE**                          | Live capture payloads/headers, capability matrix, windowing/status proofs, compatibility report                                                                                               | 4 артефакта в `docs/integrations/manychat/`                                              |
| **1. Provider + UI**                     | `manychat` в `PROVIDERS`, карточка в `SocialIntegrationsTab`, диалоги Add/Edit, генерация webhook_secret, DDL расширения                                                                      | Карточка видна, instance создаётся, healthcheck реализован по probes из PATCH 0          |
| **2. Webhook + Inbox bridge**            | `manychat-webhook` (нормализация → `domain_events`), `manychat-send` (endpoint-aware throttle, idempotency, Pause Automation на первом ответе), bridge через `provider_kind='manychat'`       | Machine-check DoD ниже                                                                   |
| **3. CRM-синхронизация (через события)** | Domain handlers для `manychat.subscriber.created/tagged/untagged/field_updated`, `manychat-sync-subscribers`, `integration_field_mappings`, identity = `(workspace, instance, subscriber_id)` | Контакт upsert по provider id, теги → правила сделок через события                       |
| **4. Triggers + Dynamic Block**          | `manychat-trigger-flow` подписан на доменные события платформы (`order.paid`, etc.), `manychat-dynamic-block` с фиксированным response schema                                                 | Тестовая оплата → Flow стартует. External Request возвращает валидный JSON в timeout 10s |
| **5. Proof-пакет**                       | Browser + DB + log proof для всех machine-checks DoD                                                                                                                                          | Все 8 проверок ниже зелёные                                                              |


---

## DoD (machine-check proof для каждого PATCH)

Универсальные проверки, которые должны быть автоматически верифицируемы:

1. **Idempotency**: повторная доставка одного и того же webhook (same `idempotency_hash`) → 1 запись в `instagram_messages`, 0 дубликатов в `domain_events`
2. **Domain events**: каждый inbound webhook создаёт `domain_events` + `domain_executions`
3. **Audit**: ручные действия операторов из inbox пишутся в `audit_logs`
4. **Thread integrity**: inbound message связан с одним `thread_key` и одним `manychat_subscribers.id` детерминированно
5. **24h/7d violation UX**: ошибка из ManyChat при out-of-window send нормализована через `normalizeEdgeFunctionError` и показана в UI без 5xx
6. **Manual reply contract**: первый outbound ответ оператора → `manychat.automation.suppressed` событие создано + Pause Automation API вызван
7. **Healthcheck granularity**: возвращает не только `success:true`, а массив probes (api_key valid, webhook reachable, send permitted, dynamic_block enabled) с per-probe статусом
8. **Identity SoT**: merge `manychat_subscribers` ↔ `contacts` происходит только через явный merge flow, primary key всегда provider id

---

## Deferred (вне scope v1)

1. Multi-channel (FB Messenger / WhatsApp / Telegram / SMS / Email) поверх generic communications model
2. Parity с ManyChat Inbox: seats, assignment, conversation handover, native analytics
3. Доказуемый out-of-window reply из кастомного inbox без ManyChat Inbox
4. Голосовые / Stories Reply (требует Meta Graph API напрямую)
5. WhatsApp Business templates (отдельная модерация Meta)

---

## Что нужно от пользователя ДО старта PATCH 0

1. Тестовый ManyChat workspace + paid plan с включёнными API/DevTools (точный tier валидируется в PATCH 0)
2. API Key из `Settings → API`
3. Возможность дать временный публичный URL (ngrok или временный edge) для live capture

После approve — стартую с **PATCH 0 (DIAGNOSE)**, без выполнения которого PATCH 1+ не запускаются.