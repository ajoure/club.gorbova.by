---
name: duplicate-subscription-prevention-guard
description: Product-level provider-aware guard для blocking duplicate bePaid subscriptions
type: feature
---
# Duplicate Subscription Prevention Guard v3 (PATCH PAYMENT-CONFLICT v3)

## Бизнес-правило (SoT)
Конфликт = `same user_id + same product_id + status in ('active','trial','past_due') + provider-managed nature подтверждена`.

Provider-managed nature = существует строка в `provider_subscriptions` для `subscription_v2_id` со state in ('active','pending'). В `subscriptions_v2` НЕТ полей `provider_subscription_id`/`bepaid_subscription_id` — единственный SOT для provider-связи это таблица `provider_subscriptions`.

## Что игнорируется
- `tariff_id`, `amount`, `price`, `offer.amount` — НЕ участвуют в conflict detection.
- Локальные active-записи без provider linkage — это data anomalies (zombie rows), НЕ блокеры.

## Replacement
- Разрешён между разными тарифами одного продукта (tariff_id mismatch допустим).
- Старая подписка должна быть в `('canceled','superseded','expired','expired_reentry')`.
- Два режима в `src/lib/subscriptionReplacement.ts`:
  - `provider_managed` — ОБЯЗАТЕЛЬНО `bepaid-cancel-subscriptions`, при failure STOP.
  - `local_only_no_provider_subscription` — без provider cancel, runtime-проверка через `provider_subscriptions`.
- Режим виден в `audit_logs.meta.replacement_mode`.

## Files (SOT)
- `supabase/functions/_shared/subscription-conflict.ts` — единый guard helper.
- `supabase/functions/_shared/create-payment-checkout.ts` — caller.
- `supabase/functions/bepaid-create-subscription-checkout/index.ts` — caller.
- `supabase/functions/public-checkout/index.ts` — проксирует в createPaymentCheckout, своей conflict-логики нет.
- `src/lib/subscriptionReplacement.ts` — клиентский replacement-helper.
- UI: `AdminPaymentLinkDialog.tsx`, `PaymentDialog.tsx`, `PublicPayPage.tsx` — `isCurrentConflict` сравнивает только `product_id`.

## Enum subscription_status (живой)
`active, trial, past_due, canceled, expired, superseded, expired_reentry`
- Conflict statuses: `active, trial, past_due`
- Replacement (terminal) statuses: `canceled, superseded, expired, expired_reentry`
