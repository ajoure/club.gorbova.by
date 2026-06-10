# Proof — Stripe subscription checkout materialization (recovery + provider-clean UI)

## 1. Root cause

Stripe subscription Checkout Session завершилась `complete + paid`, реальное списание `$2 USD` прошло, но бизнес-данные (orders_v2, payments_v2, active subscriptions_v2) не материализовались. Канонический activation path для подписок — `invoice.paid`, а это событие либо не пришло, либо не обработано. `checkout.session.completed` в текущем webhook требовал `metadata.order_id`, которого нет для подписочного flow, и возвращал `no_order_id_in_metadata` без действий.

## 2. Stripe session snapshot

- `session_id = cs_live_a1Div6ZmYLt6VOpbmdE6VdDOKqXKP9aP3VOVF7HotCokKoQqGZTvjroZHV`
- `mode = subscription`
- `status = complete`
- `payment_status = paid`
- `subscription = sub_1TgWoO6UYJj2vm0Gjc9P0jxH`
- `invoice = in_1TgWoM6UYJj2vm0GFNtppUXO`
- `amount_total = 200`, `currency = usd`
- `account_code = stripe_poland`

## 3. Provider events

- `checkout.session.completed` (`evt_1TgWoQ6UYJj2vm0GIXMJpQ00`) — `processed`, без активации.
- `invoice.paid` — отсутствует на момент диагностики.

## 4. Dry-run preconditions (read-only)

- `subscriptions_v2 ac24c459-…` status=`pending`, `order_id=null`.
- `provider_subscriptions fa7ae2be-…` state=`pending`, `provider_subscription_id=pending:ac24c459-…`.
- `payment_links c5f28396-…` provider=`stripe`, payment_type=`subscription`, current_uses=0.
- Все idempotency-проверки (orders/payments по session/invoice/sub) = 0.

## 5. Helper logic

Новый shared helper `_shared/stripe-checkout-materialize.ts → activateStripeSubscriptionCheckout()`:

1. Strict guards: mode=subscription, status=complete, payment_status=paid, subscription`sub_…`, metadata содержит `subscription_v2_id` + `provider_subscription_row_id` + `payment_link_id`, account_code совпадает.
2. Fast-path idempotency: ищет existing order по `meta.stripe.invoice_id` и `meta.stripe.checkout_session_id`.
3. Тянет реальный invoice из Stripe API (`GET /v1/invoices/{invoice_id}`).
4. Синтезирует `invoice.paid` event и вызывает existing `onInvoicePaid()` (canonical) — никакого второго write-path. Полная reuse идемпотентности через `meta.stripe.invoice_id`.

Helper подключён в двух точках:
- `stripe-webhook` → `checkout.session.completed` когда `mode = subscription` (до проверки `order_id_meta`).
- `stripe-reconcile-session` → когда `session.mode = subscription`.

## 6. Recovery result for `$2`

Вызов через одноразовую `admin-stripe-subscription-checkout-recovery` (allowlist по session_id):

```
{
  "account_code": "stripe_poland",
  "ok": true,
  "result": {
    "note": "activated",
    "order_id": "849c68b7-7296-4660-8265-841bc57f7aa5",
    "payment_id": "00b39954-8180-44b7-8627-c84a0d63c9ef",
    "provider_subscription_id": "sub_1TgWoO6UYJj2vm0Gjc9P0jxH",
    "subscription_v2_id": "ac24c459-478a-40ed-8d2c-87e63d04cb13"
  }
}
```

## 7. SQL after

| Сущность | Значение |
|---|---|
| `orders_v2 849c68b7-…` | status=`paid`, paid_amount=`2.00`, currency=`USD`, meta.payment_link_id=`c5f28396-…`, meta.stripe.invoice_id=`in_1TgWoM…` |
| `payments_v2 00b39954-…` | status=`succeeded`, amount=`2.00`, provider_payment_id=`pi_3TgWoM6UYJj2vm0G1L9yYCCe` |
| `subscriptions_v2 ac24c459-…` | status=`active` |
| `provider_subscriptions fa7ae2be-…` | state=`active`, provider_subscription_id=`sub_1TgWoO…` |
| `payment_links c5f28396-…` | current_uses=`1` (++1) |
| `entitlements 44caec9c-…` | status=`active`, expires_at=`2026-07-10`, source=primary_order_fulfillment |

## 8. UI patches

- `PublicPayPage.tsx`: для Stripe subscription скрыт disabled-блок bePaid saved cards, добавлен Stripe-specific хинт «Для оформления подписки вы будете перенаправлены на защищённую страницу Stripe…».
- `AdminPaymentLinkDialog.tsx`: метки провайдеров — «Белорусская карта (bePaid)», «Иностранная карта / Apple Pay (Stripe)».
- `AdminPaymentsHub.tsx`: вкладка переименована «Подписки BePaid» → «Подписки» (route `/admin/payments/bepaid-subscriptions` сохранён как legacy).
- Новый `StripeSubscriptionsList.tsx` смонтирован сверху вкладки «Подписки» — read-only список Stripe-подписок с provider badge.

## 9. Re-run idempotency

Повторный вызов helper:

```
{ "note": "already_materialized_by_invoice", "order_id": "849c68b7-…" }
```

`select count(*) from orders_v2 where meta.stripe.invoice_id = 'in_1TgWoM6UYJj2vm0GFNtppUXO'` → `1`. Дубль не создан. `payment_links.current_uses` не изменился.

## 10. Untouched

- bePaid checkout / e-clearing / Pay не тронуты.
- `grant-access-for-order` вызывается, не модифицируется.
- Прямых записей в entitlements нет.
- `tariff_offers.meta` не менялся.
- Реальные новые списания не создавались.
- Legacy route сохранён.

## 11. DoD

- ✅ Stripe subscription checkout materializes from `checkout.session.completed` when `invoice.paid` missing
- ✅ `$2` оплата восстановлена (order/payment/subscription/access/payment_link counter)
- ✅ PublicPayPage чист от bePaid-confusion для Stripe subscription
- ✅ Вкладка переименована в «Подписки» + Stripe badge
- ✅ Повторный reconcile/webhook не создаёт дублей
- ✅ bePaid/e-clearing/Pay не сломаны
