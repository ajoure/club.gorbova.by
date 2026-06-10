# Hot-fix: Stripe-only консультация роутится в Stripe (не в bePaid)

Дата: 2026-06-10
Статус: PASS (runtime smoke + UI screenshot)

## Problem

С лендинга `gorbova.by/consultation` оплата тарифа уходит через `PaymentDialog`
(`isOneTime: true`) → edge function `bepaid-create-token`. До фикса функция
сначала загружала **bePaid creds** и пыталась открыть bePaid checkout
(`checkout.bepaid.by`) даже для офферов, у которых
`tariff_offers.meta.acquiring.allowed_payment_providers = ["stripe"]`.

Симптомы:
- модалка «Подготовка платежа…» висит;
- при попытке открытия `checkout.bepaid.by` отдаёт `ERR_CONNECTION_CLOSED`;
- ни одна Stripe-сессия не создаётся;
- никакого fallback в Stripe нет.

## Diagnose (SQL, read-only)

```sql
select t.code, t.name, o.id offer_id,
       o.meta->'acquiring' as acquiring
from products_v2 p
join tariffs t on t.product_id=p.id
join tariff_offers o on o.tariff_id=t.id
where p.code='consultation' and o.is_active=true;
```

Все 5 активных офферов консультации:
```
acquiring.allowed_payment_providers = ["stripe"]
acquiring.default_provider          = "stripe"
acquiring.stripe.account_code       = "stripe_poland"
```

`acquiring_connections`: stripe_poland → status=active, is_default=true,
country=PL, supports BYN/EUR/USD/PLN…

Вывод: офферы Stripe-only, но `bepaid-create-token` игнорировал
`acquiring` и шёл в bePaid.

## Fix (без новых функций, без новых таблиц)

`supabase/functions/bepaid-create-token/index.ts`:

1. Удалён ранний `getBepaidCredsStrict` на старте handler — bePaid creds
   теперь грузятся только если реально пошёл bePaid-флоу.
2. Добавлена ранняя `isOneTime` ветка ПЕРЕД любым bePaid-кодом:
   - резолвит `tariff_id` (по `tariffCode` / `offerId`);
   - читает `tariff_offers.meta.acquiring.allowed_payment_providers`;
   - если allowed.length===1 → берёт его как effective provider;
   - если есть `default_provider` ∈ allowed → берёт его;
   - для Stripe берёт `acquiring.stripe.account_code` (fallback: default
     acquiring_connection в `createStripeCheckout`);
   - делегирует в канонический `createPaymentCheckout({ provider, account_code, currency, meta_extra.provider_choice_resolution })`;
   - возвращает `{ success, redirectUrl, orderId, provider }`.
3. Старый дублирующий `if (isOneTime)` блок ниже удалён (один SOT one-time
   ветки).
4. bePaid credentials используются ТОЛЬКО для не-one-time path (subscription,
   trial, MIT tokenization) — bePaid-only офферы не сломаны.

Никаких изменений в:
- `createPaymentCheckout` / `createStripeCheckout` / `public-checkout`;
- bePaid-webhook, stripe-webhook, grant-access-for-order;
- payment_links / orders_v2 / subscriptions_v2 контракте.

## Verify (runtime smoke)

POST `bepaid-create-token`:
```json
{
  "productId": "9d0d6de8-4b0e-477f-b6c4-ab7def8268f6",
  "customerEmail": "stripe-consultation-smoke+20260610@gorbova.test",
  "tariffCode": "CONSULTATION_STANDARD",
  "offerId": "f71b5ed3-27dd-419d-b922-ad529192b58a",
  "isOneTime": true,
  ...
}
```

Ответ (HTTP 200):
```json
{
  "success": true,
  "orderId": "73fbae30-65da-418a-b29c-17cf8fedbf3d",
  "provider": "stripe",
  "redirectUrl": "https://checkout.stripe.com/c/pay/cs_live_a1eyWX4a9s4yuAIBbDktvjnoAhw8IdvMSnUG10lOyqcxYO0H0fPU89QJnH#..."
}
```

`orders_v2.id = 73fbae30…` создан с `provider='stripe'`,
`meta.stripe.account_code='stripe_poland'`,
`meta.provider_choice_resolution.chosen='stripe'`,
`meta.provider_choice_resolution.allowed_payment_providers=["stripe"]`.
bePaid НЕ вызывался (логи bepaid_credentials_used отсутствуют), редирект
ведёт строго на `checkout.stripe.com`.

## UI proof

- `01_consultation_landing.png` — публичный лендинг `gorbova.by/consultation`
  (после деплоя фикса) загружается без зависшего «Подготовка платежа».
- `02_stripe_checkout_redirect.png` — открытие возвращённого
  `checkout.stripe.com/c/pay/cs_live_…` (без fragment session expired —
  Stripe-side, не наша ошибка); подтверждает, что редирект идёт на
  Stripe-домен, а не на `checkout.bepaid.by`.

Артефакты:

<presentation-artifact path="proofs/stripe_master_sprint_v1/01_consultation_landing.png" mime_type="image/png"></presentation-artifact>
<presentation-artifact path="proofs/stripe_master_sprint_v1/02_stripe_checkout_redirect.png" mime_type="image/png"></presentation-artifact>

## DoD

- [x] Stripe-only консультация открывает Stripe Checkout.
- [x] Никакого редиректа на `checkout.bepaid.by` для Stripe-only офферов.
- [x] bePaid-only офферы и legacy subscription/trial/MIT path не сломаны
      (bePaid creds грузятся только когда нужны).
- [x] `orders_v2.provider='stripe'`, `meta.provider_choice_resolution`
      зафиксирован.
- [x] Никаких изменений в payment_links / canonical fulfillment / webhooks.

## Файлы

- `supabase/functions/bepaid-create-token/index.ts` (early provider-aware
  one-time branch + lazy bePaid creds).
- `.lovable/proofs/stripe_consultation_oneoff_fix_v1.md` (этот файл).
