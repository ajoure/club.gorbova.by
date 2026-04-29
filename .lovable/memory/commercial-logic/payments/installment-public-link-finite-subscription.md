---
name: installment-public-link-finite-subscription
description: Публичная installment-ссылка = finite bePaid subscription (billing_cycles=N), не one-time
type: feature
---
# Installment Public Link = finite bePaid subscription

## Контракт
- `payment_links` с `meta.installment.selected_installment_months >= 2` создаётся как `payment_type='subscription'` (admin-create-public-link).
- `/pay/:token` → `public-checkout` пробрасывает в `_shared/create-payment-checkout.ts` через `meta_extra.installment_count`, `meta_extra.installment.{interval_days, billing_cycles, as_finite_subscription}`.
- `_shared/create-payment-checkout.ts` (subscription branch):
  - Pre-create `subscriptions_v2` ДО bePaid (`status='past_due'`, `billing_type='provider_managed'`, `auto_renew=false` для installment, `meta.installment_count`, `meta.billing_cycles`, `meta.model='bepaid_finite_subscription'`).
  - `tracking_id = subv2:{subscription_v2_id}:order:{order_id}`.
  - bePaid `/subscriptions` payload для installment: `plan.infinite=false`, `plan.billing_cycles=N`, `plan.number_payment_attempts=3`, `plan.amount=per_payment_kopecks`, `plan.interval=30`, `plan.interval_unit='day'`.
  - Rollback: при 4xx/5xx от bePaid pre-created `subscriptions_v2` → `canceled` с `meta.rollback_reason`.
  - `provider_subscriptions.upsert` ОБЯЗАТЕЛЬНО содержит `subscription_v2_id`, `meta.tracking_id`, `meta.order_id`, `meta.installment_count`, `meta.billing_cycles`, `meta.model='bepaid_finite_subscription'`.
- `bepaid-webhook` (provider-managed branch, `subv2:` tracking): распознаёт installment по `subV2.meta.installment_count >= 2`. Audit: `bepaid.subscription.installment_processed` с `model='bepaid_finite_subscription'`, `internal_installment_skipped=true`. Internal `installment_payments` + `installment-charge-cron` для finite installment НЕ материализуются (LINK-ORDER ветка не срабатывает — там tracking `link:order:`, не `subv2:`).

## Что НЕ меняется
- Обычные one-time ссылки.
- Обычные infinite subscriptions (`plan` без `billing_cycles`).
- ЕРИП на `/subscriptions` отсутствует автоматически (никаких ручных манипуляций).

## DoD-проба
- `SELECT count(*) FROM installment_payments WHERE order_id = :order_id;` → 0 для нового finite installment.
- `tracking_id` в `provider_subscriptions.meta` соответствует `^subv2:[0-9a-f-]{36}:order:[0-9a-f-]{36}$`.

## Старые данные
- 6 существующих installment payment_links с `payment_type='one_time'` имеют 0 paid orders → repair не требуется.
