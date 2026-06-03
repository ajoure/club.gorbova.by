# D2. Stripe Subscriptions — Object Mapping (v1)

Расширяет `stripe_object_mapping_v1.md` подписочными объектами. Add-only через `meta`, никаких новых колонок.

## Маппинг

| Наша сущность | Stripe-объект | Связь |
|---|---|---|
| `subscriptions_v2` (1 строка) | `Subscription` (1:1) | `provider_subscriptions.provider_subscription_id = sub_*` |
| `subscriptions_v2` finite/installment | `Subscription Schedule` + дочерний `Subscription` | `meta.stripe.schedule_id = sub_sched_*`, `meta.stripe.subscription_id = sub_*` |
| `provider_subscriptions` | `Subscription` | поле `provider_subscription_id`, `provider='stripe'`, `meta.account_code` |
| `orders_v2` (цикл списания) | `Invoice` + первичный `PaymentIntent` + `Charge` | `meta.stripe.invoice_id`, `meta.stripe.payment_intent_id`, `meta.stripe.charge_id` |
| `payments_v2` | `Charge` (или `PaymentIntent.latest_charge`) | `provider_payment_id = ch_*` (как в Phase 2) |
| refund-row через `record_refund_atomic_multi` | `Refund` | `refund_uid = re_*` |
| `contacts.meta.stripe.customer_id_by_account` | `Customer` per account | `{ "<account_code>": "cus_*" }` |
| `contacts.meta.stripe.payment_methods_by_account` (опц., snapshot) | `PaymentMethod` | НЕ SOT; только последний `default_payment_method` для UI-подсказки |

## meta-схема `subscriptions_v2.meta.stripe`
```
{
  "account_code": "stripe_poland",
  "subscription_id": "sub_...",
  "schedule_id": "sub_sched_..." | null,
  "customer_id": "cus_...",
  "price_id": "price_...",
  "product_id": "prod_...",
  "default_payment_method": "pm_..." | null,
  "cancel_at_period_end": false,
  "current_period_start": 1762000000,
  "current_period_end": 1764678400,
  "collection_method": "charge_automatically"
}
```

## meta-схема для installment (Schedule)
```
"installment": {
  "cycles_total": 6,
  "cycles_done": 2,
  "schedule_status": "active"
}
```

## tracking_id для расчёта/идемпотентности
- Subscription cycle: `stripe_sub:{sub_id}:order:{order_id}`
- Schedule cycle: `stripe_sched:{sched_id}:sub:{sub_id}:order:{order_id}`
- Parity с bePaid (`subv2:{...}:order:{...}`).

## Таблица переходов статусов
| Stripe | Наш `subscriptions_v2.status` | Комментарий |
|---|---|---|
| `incomplete` | `pending` | до первой успешной оплаты |
| `trialing` | `active` (с пометкой trial — не MVP) | не используем в MVP |
| `active` | `active` | основной |
| `past_due` | `past_due` | grace, access не отзывается |
| `unpaid` | `past_due` | после Smart Retries fail |
| `canceled` | `canceled` | по self-cancel/admin |
| `incomplete_expired` | `canceled` | первый PI не оплачен в окне |
| `paused` | future (`paused`) | не MVP |

## SOT
- Статус подписки/расписания, periods, default_payment_method — **Stripe**.
- Доступ пользователя (`entitlements`, `access_grant_ledger`) — **наша БД**.

## Что хранится локально
- Все ссылки выше через `meta.*`; никаких новых колонок в `subscriptions_v2`/`provider_subscriptions`.

## Что хранится в Stripe
- Customer, Subscription(+Schedule), Invoice, PaymentIntent, Charge, Refund, PaymentMethod, SetupIntent — полные объекты.

## Recovery
- `subscriptions-reconcile` (Stripe-ветка): по `customer_id_by_account[<account_code>]` → `subscriptions.list` → сверка `meta.stripe.subscription_id`, `cancel_at_period_end`, `current_period_*`, `default_payment_method`.
- Для Schedule — `subscription_schedules.retrieve(schedule_id)`.

## Multi-account
- `provider_subscriptions.meta.account_code` обязателен.
- `contacts.meta.stripe.customer_id_by_account` — словарь, один контакт может иметь разные `cus_*` в разных аккаунтах.
- Запрет на чтение `customer_id` без `account_code` в коде.
