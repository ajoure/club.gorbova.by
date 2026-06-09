# PATCH 4 — Stripe card data targeted fetch

Дата: 2026-06-09
Scope: новая edge function `stripe-card-data-fetch`.

## Цель

P0 ghost-profile sprint выявил, что для live Stripe-платежа
`pi_3TgMkD6UYJj2vm0G1ZUpRzvH` (5 BYN, Сергей) поля
`card_brand` / `card_last4` / `card_holder` в `payments_v2`
остались NULL — webhook PATCH-LIVE-CARD появился позже самой оплаты,
а Resend-кнопки в Stripe Dashboard нет.

PATCH 4 закрывает только этот конкретный платёж, **без mass backfill**.

## Что создано

### `supabase/functions/stripe-card-data-fetch/index.ts`

Жёсткие ограничения:
- super_admin only (`requireSuperAdmin`).
- One `payment_intent` per call. No batch mode.
- Сначала ищет локальную строку `payments_v2 WHERE provider='stripe'
  AND provider_payment_id=:pi`. Если не найдена — 404, ничего
  не создаёт.
- Читает Stripe-секрет через `readAcquiringSecret('stripe', account_code, 'secret_key')`.
  account_code = body || `meta.stripe.account_code` || `meta.account_code`
  || `stripe_poland`.
- GET `/v1/payment_intents/{id}?expand[]=latest_charge`, извлекает
  `payment_method_details.card.brand`, `.last4`, `billing_details.name`.
- UPDATE `payments_v2` только полей `card_brand`, `card_last4`,
  `card_holder`, `updated_at`, `meta.card_data_fetched_at`,
  `meta.card_data_source='stripe_targeted_fetch_v1'`.
- НЕ трогает: `status`, `amount`, `refunded_amount`, lifecycle,
  refunds, access, entitlements, subscriptions.
- Никаких DELETE.
- Audit: `admin.stripe.card_data_fetch_ok` (before/after)
  или `admin.stripe.card_data_fetch_empty`.

## Verification

```
POST /stripe-card-data-fetch
body: { "payment_intent": "pi_3TgMkD6UYJj2vm0G1ZUpRzvH" }
→ 200 { ok: true, updated: true,
        card_brand: "visa", card_last4: "3587",
        card_holder: "Fedorchuk Sergey" }
```

DB-проверка после вызова:

```sql
SELECT id, card_brand, card_last4, card_holder,
       meta->>'card_data_source' AS src,
       meta->>'card_data_fetched_at' AS fetched
FROM payments_v2
WHERE provider_payment_id='pi_3TgMkD6UYJj2vm0G1ZUpRzvH';
```

Результат:
```
id:          2d40bc7e-e69f-4633-88d5-102561e49a54
card_brand:  visa
card_last4:  3587
card_holder: Fedorchuk Sergey
src:         stripe_targeted_fetch_v1
fetched:     2026-06-09T13:11:34.149Z
```

UI `/admin/payments` теперь покажет карту в строке этого платежа
после reload.

## Что НЕ сделано

- Никакого mass backfill — это отдельный PATCH (F7 в backlog).
- Никаких lifecycle/access/refund/status изменений.
- Никаких новых платежей не создавалось.

## DoD

- [x] `pi_3TgMkD6…` получил `card_brand=visa`,
      `card_last4=3587`, `card_holder=Fedorchuk Sergey`
- [x] UI покажет карту
- [x] audit `admin.stripe.card_data_fetch_ok` записан
- [x] mass backfill не делался
- [x] никаких lifecycle/access/refund изменений
