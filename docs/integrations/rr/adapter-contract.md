# Контракт backend-адаптера `RRPaymentProviderAdapter`

Дата: 2026-07-09. Основано на `docs/integrations/rr/discovery.md`.

Документ фиксирует контракт **до** написания кода. Никакие миграции, edge
functions и изменения UI по этому документу в текущем шаге не создаются.

## 1. Роль адаптера

- Изолирует специфику API РР от общего платёжного pipeline
  (`payments_v2`, `orders_v2`, `provider_events`, `domain_events`,
  `access_grant_ledger`, `entitlement flow`).
- Соответствует существующей архитектуре bePaid/Stripe-адаптеров: канонический
  event-driven flow, canonical entitlement grant после финального оплаченного
  статуса.
- Настройки берутся из существующей карточки интеграции
  `integration_instances(provider='rr')` — новую таблицу
  `payment_provider_settings` в этом шаге НЕ создаём.

## 2. Интерфейс

```ts
interface RRPaymentProviderAdapter {
  // Вызывается из edge function rr-create-checkout после валидации гейта.
  createCheckout(input: {
    orderIdInternal: string;         // orders_v2.id
    externalOrderId: string;         // = orderIdInternal (используем как order.id в РР, ≤ 80 chars)
    amountMinor: number;             // копейки
    currency: "RUB";                 // v1 — только RUB
    items: Array<{ name: string; quantity: number; priceMinor: number }>;
    clientInfo?: {                   // всё опционально
      firstName?: string; lastName?: string; middleName?: string;
      phone?: string; email?: string;
    };
    urls: { notification: string; complete: string; fail: string };
    correlationId: string;           // UUID v4 → X-Correlation-ID
  }): Promise<{ paymentUrl: string; providerStatus: "new" }>;

  // Вызывается из rr-webhook после валидации подписи и дедупа.
  handleWebhookEvent(evt: {
    externalOrderId: string;         // = order.id
    newStatus: RRStatus;
    salt: string;
    sign: string;                    // уже провалидирован до вызова
    instanceId: string;
  }): Promise<void>;

  // Всегда дергается после webhook перед финализацией
  // (рекомендация РР: «дополнительная верификация»).
  fetchStatus(externalOrderId: string, instanceId: string): Promise<{
    status: RRStatus;
    amountMinor: number;
    completedAmountMinor: number;
    commissionMinor: number;
    currency: string;
    payments: RRPaymentLine[];
  }>;

  // Маппинг статусов РР → внутренние. Чистая функция без I/O.
  mapStatus(rr: RRStatus): {
    payment: "pending" | "paid" | "failed" | "canceled" | "refunded";
    order: "pending" | "paid" | "failed" | "canceled" | "refunded";
    finalizeOrder: boolean;          // true только для paid-финалов
  };

  // Отмена / возврат: в v1 НЕ реализуем — публичный API не даёт endpoint.
  // Метод в интерфейсе не объявляется, чтобы не создавать иллюзии возможности.
}

type RRStatus =
  | "new" | "approved" | "accepted" | "wait_client" | "processing"
  | "approved_credit" | "authorized" | "authorized_all"
  | "authorized_partially" | "rejected" | "canceled"
  | "canceled_by_user" | "refunded";
```

## 3. Маппинг статусов РР → внутренние

| RR status              | payments_v2.status | orders_v2.status | finalizeOrder |
|------------------------|--------------------|------------------|---------------|
| `new`                  | pending            | pending          | нет           |
| `approved`             | pending            | pending          | нет           |
| `accepted`             | pending            | pending          | нет           |
| `wait_client`          | pending            | pending          | нет           |
| `processing`           | pending            | pending          | нет           |
| `approved_credit`      | pending            | pending          | нет (одобрено, но деньги ещё не пришли партнёру) |
| `authorized`           | **paid**           | **paid**         | **да**        |
| `authorized_all`       | **paid**           | **paid**         | **да**        |
| `authorized_partially` | pending            | pending          | нет (v1 частичную оплату не финализируем) |
| `rejected`             | failed             | failed           | нет           |
| `canceled`             | canceled           | canceled         | нет           |
| `canceled_by_user`     | canceled           | canceled         | нет           |
| `refunded`             | refunded           | refunded         | нет (возврат уже сделан на стороне РР) |

Финализация заказа (выдача доступов) — только для `finalizeOrder=true` и только
через существующий canonical entitlement flow. Webhook НИКОГДА не выдаёт доступы
напрямую.

## 4. Идемпотентность

**createOrder (исходящий):**
- `order.id = orders_v2.id` (UUID, укладывается в 80 chars).
- `X-Correlation-ID = orders_v2.id` при первом запросе; при retry той же попытки
  переиспользуем тот же correlationId.
- Повторный `createOrder` с существующим `order.id` — обрабатываем ответ РР
  (422/existing link) в `rr-create-checkout` без ошибки для пользователя, если
  РР возвращает существующий `link`; иначе — ошибка «заказ уже создан».
  **Точное поведение уточняется у РР** (см. discovery §4 вопрос 4).

**Webhook (входящий):**
- Ключ дедупа в `provider_events.external_id`:
  `rr:{order.id}:{sign}` — `sign` уникален для комбинации `(newStatus, salt,
  secretKey)`, полное совпадение = полный дубль нотификации.
- `provider_events.provider = 'rr'`, `provider_events.event_type = type`
  (`order_changed` / `status_changed`).
- Insert с `ON CONFLICT (provider, external_id) DO NOTHING` — второй раз ту же
  нотификацию не проводим.
- После insert — `getOrderStatus` (обязательно) → `mapStatus` → апдейт
  `payments_v2` / `orders_v2` в одной транзакции → если `finalizeOrder=true`,
  публикуем `domain_event: order.paid` → canonical entitlement flow.

## 5. Комиссия

- Забираем из `getOrderStatus.commission` (double, валюта заказа) →
  `commissionMinor = Math.round(commission * 100)`.
- Сохраняем в `payments_v2.provider_fee_minor` (поле уже существует —
  подтвердить при подготовке миграции; если нет — add-only миграция добавит).
- Записывается при финализации (`authorized`/`authorized_all`).

## 6. Валидация webhook

```
computed = md5(newStatus + "_" + secretKey + "_" + salt)
if (computed !== sign) → 200 OK, но payload игнорируется, лог warn.
```

`secretKey` берётся из `integration_instances.config_secrets.secret_key`
для `provider='rr'`. Никаких других источников (env vars, hardcode) не
допускается. Секрет из БД читается только service-role клиентом внутри
edge function; в лог/ответ/UI не попадает.

## 7. Изменения схемы (add-only, для следующего шага)

Все — минимальные, без удаления и без rename:

1. `payments_v2.provider` — расширить допустимые значения `'rr'` (если это enum
   / CHECK — миграция ADD VALUE или пересборка CHECK).
2. `payments_v2.provider_fee_minor` — подтвердить наличие; если нет —
   `ADD COLUMN provider_fee_minor bigint NULL`.
3. `orders_v2.provider` — если поле существует и ограничено enum/CHECK —
   расширить `'rr'`.
4. `provider_events` — новых колонок не требуется; используем существующие
   `provider`, `event_type`, `external_id`, `payload`.
5. Настройки provider `rr` — **переиспользуем** карточку
   `integration_instances(provider='rr')`. `payment_provider_settings` как
   отдельную таблицу НЕ создаём, если discovery следующей итерации не докажет
   необходимость отдельной payment-domain settings.
6. Флаги `allow_rr` и `rr_min_amount_minor=990000` — хранить в существующей
   `acquiring_connections` / оффер-уровне (`tariff_offers` / `payment_links`),
   выбор точного места — в отдельной подзадаче перед миграцией.

## 8. Edge functions следующего шага (в этом шаге НЕ создаются)

- `rr-create-checkout` — POST от authenticated клиента c orderId; проверяет
  гейт, вызывает adapter.createCheckout, возвращает `paymentUrl`.
- `rr-webhook` — публичная (verify_jwt=false), валидирует подпись, insert
  в `provider_events`, дергает fetchStatus, апдейтит платёж/заказ, публикует
  domain event.
- (опционально) `rr-sync-status` — cron, догоняет заказы в промежуточных
  статусах старше N минут через `getOrderStatus`.

## 9. Гейт `PublicPayPage` (для следующего шага)

Кнопка «Оплатить в рассрочку через Ресурс Развития» показывается только когда
одновременно:

```
currency === "RUB"
&& amountMinor >= 990000
&& (offer|product|payment_link).allow_rr === true
&& существует integration_instances(provider='rr') с credentials_status='configured'
&& этот instance не в disabled/error-состоянии
```

Иначе — кнопка скрыта, публичному пользователю не показывается.

## 10. Что НЕ поддерживаем в v1

- Подписки / recurring — API РР не даёт recurring в публичной v2.0.
- Валюты кроме RUB (BYN/KZT/KGS/UZS — только после отдельного discovery).
- Ручной расчёт комиссии — только из `getOrderStatus.commission`.
- Отмена/возврат из нашей админки через API — endpoint отсутствует.
- Выдача доступов из webhook — только через canonical entitlement flow после
  `finalizeOrder=true`.
- Чеки (ФР) — v1 полагаемся на интеграцию РР↔касса на их стороне; свой
  fiscal flow не подключаем.
- Частичная авторизация (`authorized_partially`) как paid.

## 11. Пред-условия для следующего шага (backend implementation)

1. Ответ РР на открытый вопрос №1 discovery (test-режим): host / активация.
2. Ответ РР на вопрос №4 (поведение createOrder при повторе `order.id`).
3. Уточнение места хранения `allow_rr` / `rr_min_amount_minor` (offer vs
   payment_link vs acquiring_connection) — отдельный design-decision.

До закрытия п.1–2 backend adapter можно начинать разрабатывать за
абстракцией (интерфейс из §2), но реальный e2e-тест возможен только после
подтверждения test-режима.
