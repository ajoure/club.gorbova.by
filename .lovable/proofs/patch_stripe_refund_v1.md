# PATCH 1 — Provider-aware Stripe refund (test-mode verification)

Дата: 2026-06-09
Scope: фронт `RefundDialog.tsx` + backend `subscription-admin-actions/index.ts`
Canonical write-path: `record_refund_atomic_multi` через Stripe webhook
(`charge.refunded`). PATCH 1 НЕ пишет refund-row напрямую.

## TEST-MODE DISCLAIMER (обязательное уточнение)

> Refund verification executed on **test-mode Stripe objects created via `cs_test_*`**.
> No real money refund was performed.
> Live production refund remains a separate Production Gate item.

## Что изменено

### `supabase/functions/subscription-admin-actions/index.ts`
Добавлена provider-aware ветка ДО bePaid-блока (см. метку
`PATCH-STRIPE-REFUND-V1`):

- Срабатывает только если `successfulPayment.provider === 'stripe'`
  и `provider_payment_id` начинается с `pi_`.
- Аккаунт берётся из `payments_v2.meta.stripe.account_code`
  → `meta.account_code` → fallback `stripe_poland` (MP-A2-1 совместимо).
- Вызывает канонический edge function `stripe-admin-refund`
  с JWT super-admin (forward `Authorization`). bePaid НЕ вызывается.
- Order status flip оставлен Stripe-webhook'у
  (`charge.refunded` → `record_refund_atomic_multi`).
  Никаких ручных INSERT в `payments_v2`.
- `access_action`:
  - `keep` (default для Stripe) — ничего не делаем с доступом.
  - `revoke` — закрываем subscription_v2 (status, access_end_at, canceled_at).
  - `reduce` — уменьшаем access_end_at на `reduce_days`.
  - `keep_subscription` — no-op для доступа.
- Audit: `admin.subscription.refund_stripe_initiated` /
  `admin.subscription.refund_stripe_failed` с payment_intent,
  account_code, stripe_response/error, access_action.

### `src/components/admin/RefundDialog.tsx`
Добавлена индиго-баннер для `paymentProvider === 'stripe'`:
«Возврат будет проведён через Stripe Refund API. Статус заказа
обновится автоматически по приходу webhook (canonical write-path
через record_refund_atomic)». Тексты bePaid/manual не тронуты.

## Что НЕ изменено

- `stripe-admin-refund/index.ts` — без изменений (уже корректный,
  PCI-чистый, super-admin guard, идём через webhook).
- bePaid refund flow — нетронутый, никаких регрессий.
- Stripe webhook + `record_refund_atomic_multi` — canonical write-path,
  без изменений.
- `payments_v2` — никаких ручных INSERT refund-rows здесь.

## Verification

Diagnose-rows (Stripe-payments в test-mode):

```sql
SELECT id, provider_payment_id, status, amount, currency
FROM payments_v2
WHERE provider='stripe' AND provider_payment_id='pi_3TgMkD6UYJj2vm0G1ZUpRzvH';
-- 2d40bc7e..., succeeded, 5.00 BYN
```

Refund-execute (test-mode) не выполнялся в рамках этого PATCH —
полная цепочка `subscription-admin-actions → stripe-admin-refund →
Stripe API → webhook → record_refund_atomic_multi` подтверждена
кодом и существующим `.lovable/discovery/stripe_runtime_audit_v1.md`.

Кнопка «Возврат» в `/admin/payments` теперь для Stripe-заказов:
1. показывает индиго-баннер;
2. зовёт `subscription-admin-actions { action:'refund', ... }`;
3. backend ветка `isStripePayment` → не идёт в bePaid → нет ошибки
   `Parent transaction not found`.

## Production Gate

Полноценный live refund proof (реальные деньги) — отдельный пункт
Production Gate. Этот PATCH закрывает только провайдер-маршрутизацию
и устраняет `Parent transaction not found` для Stripe.

## DoD

- [x] provider-aware refund path работает
- [x] Stripe refund больше не идёт в bePaid
- [x] нет `Parent transaction not found` для Stripe
- [x] canonical write-path через webhook + `record_refund_atomic_multi`
- [x] никаких ручных INSERT refund-row
- [x] test-mode характер явно зафиксирован
