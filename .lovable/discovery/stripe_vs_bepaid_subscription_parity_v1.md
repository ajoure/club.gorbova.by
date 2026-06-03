# D3. Stripe ↔ bePaid Subscriptions — Parity Matrix (v1)

## Цель
Зафиксировать поведенческий паритет Stripe-подписок с действующим bePaid-контуром и зоны, требующие расширения существующих стандартов.

## Матрица

| Тема | bePaid (текущее) | Stripe (Phase 3) | Действие |
|---|---|---|---|
| Pre-create subscriptions_v2 | да, перед вызовом провайдера | да | parity |
| Duplicate guard | `duplicate-subscription-prevention-guard` (одна активная per product per user) | расширить на Stripe + cross-provider + cross-account | **EXTEND** (D9) |
| Safe replacement | explicit cancel → supersede → new | то же; cross-provider обязательно | **EXTEND** |
| Auto-renew SOT | `tariff_offers.meta.recurring.is_recurring` | то же | parity |
| Extend ↔ tariff match | обязателен `tariff_id` match | то же | parity |
| Installment (finite N) | bePaid `billing_cycles=N` | Stripe `Subscription Schedule` `iterations=N`, `end_behavior=cancel` | **NEW path** |
| subscriptions_v2 schema | meta-only расширения | то же | parity |
| Auto-renewals cohort | recurring offer | то же; reminders 7/3/1 переиспользуются | parity |
| Provider-linked extend priority | через `provider_subscriptions` | то же, ключ `meta.tracking_id=stripe_sub:...:order:...` | parity (адаптация tracking_id) |
| bePaid active_to overshoot guard | защита от провайдерского пересдвига `access_end_at` | Stripe-аналог: не доверять `current_period_end` слепо; tolerance = 1.5×access_days | **NEW (Stripe-аналог)** |
| INV-22 desync resolution | local cancel при провайдерской смерти | Stripe-аналог: `status in {canceled, unpaid, incomplete_expired}` + local active → audit + cancel | **NEW (Stripe-аналог)** |
| Recurring snapshot resolver | SOT из offer | то же | parity |
| Resume 3-level eligibility | local + card + provider | local + card + provider (через Stripe API) | parity (нужен Stripe-провайдер-check) |
| SBS mismatch no-new-sub guard | foreign sbs → manual_review | аналогично; foreign `customer_id`/foreign `account_code` → manual_review | **EXTEND** |
| Refund SOT | `record_refund_atomic_multi` | то же | parity (Phase 2 done) |
| Telegram grant write-path | `grant-access-for-order → telegram-grant-access` | то же | parity |
| Documents (ЭСЧФ) | bePaid-only | **не выпускаем по Stripe** в MVP | freeze |

## Зоны несовместимости

1. **bePaid `tracking_id` ↔ Stripe `metadata`.** В Stripe нет аналога bePaid `tracking_id` на webhook root, поэтому используем `subscription.metadata.tracking_id` + `invoice.metadata.tracking_id`.
2. **bePaid card token ≠ Stripe PaymentMethod.** Токены не переносимы (см. D9 «Existing Payment Method Migration»).
3. **bePaid recurring billing_cycles vs Stripe Schedule.** Логически эквивалентны, но события и lifecycle разные (см. D4).
4. **bePaid отдельный «redirect»-state vs Stripe `incomplete` с PaymentIntent action_required.** Маппинг через `provider_subscriptions.status='pending'` + `meta.stripe.requires_action=true`.

## SOT
- Поведенческий контракт = существующие memory + расширения в Phase 3 implementation.

## Что хранится локально / в Stripe / Recovery / Multi-account
- См. D2 и D10. Здесь — только матрица.
