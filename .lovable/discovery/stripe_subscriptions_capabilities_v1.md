# D1. Stripe Subscriptions — Capabilities (v1)

## Назначение
Карта возможностей Stripe `Subscription` и `Subscription Schedule` в объёме MVP Phase 3. Тестовый режим, без live.

## Subscription (бесконечные)
- **Статусы:** `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused`.
- **billing_cycle_anchor** — управляет якорем периода; для нас — `now` (без proration).
- **collection_method** — `charge_automatically` (карта). `send_invoice` не используем в MVP.
- **payment_behavior=`default_incomplete`** — обязательный режим: сначала создаётся `incomplete` подписка + первый `Invoice` с `PaymentIntent`, активация — после успешной оплаты.
- **proration_behavior** — `none` в MVP.
- **trial_period_days** — не используется в MVP.
- **pause_collection** — будущая возможность; в MVP не подключаем.
- **cancel_at_period_end / cancel_at** — каноничный способ self-cancel.

## Subscription Schedule (рассрочки / finite N)
- `phases[0]`: один план, `iterations=N`, `end_behavior=cancel`.
- Schedule управляет дочерним `Subscription` — мы читаем `current_phase`, `iterations`, `end_behavior`.
- Каждая итерация = `Invoice` + `PaymentIntent` + `Charge` → отдельный `orders_v2`.
- Завершение N итераций → Stripe сам отменяет родительский Subscription.

## Webhook-события (MVP)
- `customer.subscription.created | updated | deleted | paused | resumed`
- `invoice.created | finalized | paid | payment_failed | payment_action_required | voided | marked_uncollectible`
- `subscription_schedule.created | updated | completed | canceled | released | expiring`
- `customer.updated`, `payment_method.attached | detached | updated`
- `billing_portal.session.created` (информационно; для аудита)
- `charge.refunded`, `charge.refund.updated` (уже покрыты Phase 2)

## Dunning / Smart Retries
- Управляется Stripe (Billing → Revenue Recovery). MVP — defaults.
- Наш `grace` (доступ продлевается до конца оплаченного периода + grace) считается на нашей стороне поверх `past_due`/`unpaid` событий.

## SOT
- Состояние подписки и расписания = **Stripe** (`subscription.status`, `schedule.status`).
- Локальные `subscriptions_v2.status` — кэш для UI/аналитики.

## Что хранится локально
- `subscriptions_v2` + `provider_subscriptions` (как в Phase 2) с расширением `meta.stripe.*`.
- Никаких новых колонок без отдельного approve.

## Что хранится в Stripe
- `Subscription`, `Subscription Schedule`, `Invoice`, `PaymentIntent`, `Charge`, `Refund`, `Customer`, `PaymentMethod`, `SetupIntent`.

## Recovery
- При потере webhook — `subscriptions-reconcile` дополняется ветками Stripe: `subscriptions.list({customer})`, `invoices.list`, `subscription_schedules.list`, `events.list` (catch-up).
- См. D5 «Lost Webhook Recovery».

## Multi-account
- Все вызовы Stripe API — через резолвер ключа по `account_code` (см. D10).
- Webhook endpoints — отдельный per account_code, секрет подписи привязан к account_code.
