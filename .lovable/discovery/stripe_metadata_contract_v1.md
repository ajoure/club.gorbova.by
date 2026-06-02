# Discovery: контракт metadata для Stripe-объектов

Дата: 2026-06-02. Единый источник истины для всех metadata, проставляемых на Stripe Checkout Session / PaymentIntent / Subscription / Refund.

## 1. Поля контракта

| Поле | Тип | Обязательное | Immutable после создания | Используется downstream | Назначение |
|---|---|---|---|---|---|
| `order_id` | uuid | ✅ всегда | ✅ | ✅ webhook lookup, `grant-access-for-order` | основной ключ связи |
| `product_id` | uuid | ✅ | ✅ | ✅ аналитика, business_stream-резолвер fallback | — |
| `tariff_id` | uuid | ✅ | ✅ | ✅ `grant-access-for-order` extend-логика | — |
| `business_stream` | text | ✅ | ✅ | ✅ аналитика, отчёты | см. `business_stream_classification_v1.md` |
| `account_code` | text | ✅ | ✅ | ✅ резолвер adapter'а на webhook | например `stripe_poland` |
| `provider` | text | ✅ (= `stripe`) | ✅ | ✅ derivePaymentChannel | избыточно, но для надёжности |
| `payment_link_id` | uuid | опциональное | ✅ | ✅ `consume-payment-link`, аналитика ссылок | если оплата из public link |
| `contact_id` | uuid | опциональное | ✅ | ✅ привязка к контакту | если контакт известен на момент checkout |
| `offer_id` | uuid | опциональное | ✅ | ✅ document scenarios резолвер | snapshot оффера |
| `user_id` | uuid | опциональное | ✅ | ✅ запись в orders_v2.user_id | если авторизован |
| `tracking_id` | text | опциональное | ✅ | ✅ provider-linked extend (`subv2:{sub_id}:order:{order_id}`) | для recurring |
| `attempt` | int | опциональное | ❌ | ✅ idempotency | для retry-сценариев |

## 2. Правила

1. **Все обязательные поля проставляются ВСЕГДА** при создании Checkout Session. Отсутствие хотя бы одного — 400 на нашей стороне, не дойдёт до Stripe.
2. **Immutable** означает: после создания объекта в Stripe мы НЕ пытаемся переписать эти поля. Если значение поменялось у нас — создаётся новый Stripe-объект.
3. **Metadata дублируется** на всех связанных Stripe-объектах: Checkout Session → PaymentIntent → Charge → Refund наследуют те же `order_id`, `product_id`, `business_stream`, `account_code`. Subscription metadata дублируется на Invoice и далее на Charge.
4. **Длина**: Stripe metadata лимит — 50 ключей, ключ ≤40 символов, значение ≤500 символов. Наш контракт укладывается (≤12 ключей).
5. **Никаких секретов** в metadata (доступно через Dashboard всем сотрудникам Stripe-аккаунта).

## 3. Что НЕ кладём в metadata

- email пользователя (PII, используется Stripe Customer.email)
- сумму (есть в `amount`)
- валюту (есть в `currency`)
- любые внутренние токены/секреты
- snapshot tariff/product целиком (только id)

## 4. Webhook-ingest контракт

При обработке любого Stripe-вебхука:
1. Резолвим `account_code` через signing secret эндпоинта (не из metadata!).
2. Извлекаем `order_id` из metadata.
3. Если `order_id` отсутствует или не парсится в uuid → HTTP 200 + audit `stripe_webhook_no_order_id` + manual_review.
4. Cross-check: `metadata.account_code === resolved account_code from signing secret`. Mismatch → 200 + audit + manual_review (не блокируем поток).

## 5. Аудит-контракт

Любое отклонение от контракта пишется в `audit_logs` с action prefix `stripe.metadata.*`:
- `stripe.metadata.missing_required_field`
- `stripe.metadata.account_code_mismatch`
- `stripe.metadata.business_stream_unresolved`
- `stripe.metadata.contract_violation`

## 6. Backfill historical Stripe objects

Не делаем. Все исторические объекты — bePaid. Stripe начинается с Фазы 2, контракт применяется с первого объекта.

## 7. DoD
- ✅ Поля контракта зафиксированы с пометками обязательное/immutable/downstream.
- ✅ Правила длины и безопасности учтены (Stripe limits).
- ✅ Webhook-ingest и audit описаны.
