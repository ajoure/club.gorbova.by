# Phase 4.1.1 — Runtime Smoke Proof

Дата: 2026-06-06. Окружение: preview/test.

## Изменённые файлы

- `supabase/functions/admin-create-public-link/index.ts`
  - `STRIPE_ALLOWED_CURRENCIES` → `Set(['BYN','EUR','USD','PLN'])` (GBP/CHF/CZK/RON удалены).
  - Добавлена валидация валюты против `acquiring_connections.capabilities_snapshot.supported_currencies` — 400 `stripe_currency_not_supported_by_account`.
  - `provider_mode` корректно пишется `'fixed'` (DB CHECK позволяет только `fixed`/`customer_choice`).
- `src/components/admin/AdminPaymentLinkDialog.tsx`
  - Удалён `<SelectItem value="GBP">`. Список Stripe-валют = `['BYN','EUR','USD','PLN']`.
  - Каждая опция валюты `disabled`, если не входит в `capabilities_snapshot.supported_currencies` выбранного аккаунта.
  - Автоматическое переключение валюты при смене account_code, если текущая стала disabled.
  - Для `provider='stripe' && payment_type='subscription'` селектор «Кнопка оплаты» рендерит только офферы с `meta.stripe.price_id` (`stripeEligibleOffers`).
  - При отсутствии eligible-оффера: inline-сообщение, кнопка «Создать» дизейблится (`noStripeSubscriptionOffers`).
  - Production guard `stripeSubscriptionPriceMissing` сохранён как paranoia-check (UI больше не даёт выбрать невалидную кнопку).
- `supabase/functions/_shared/create-stripe-checkout.ts` — не тронут.
- `supabase/functions/stripe-create-subscription-checkout/index.ts` — не тронут.
- `stripe-webhook`, `grant-access-for-order`, `bepaid-webhook`, Telegram, миграции, GitHub Actions — не тронуты.

## Fixture (единственный текущий Stripe-eligible offer)

- product Gorbova Club: `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff CHAT: `31f75673-a7ae-420a-b5ab-5906e34cbf84`
- offer (recurring + Stripe price): `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`
- meta.stripe: `{ price_id: price_1Teeq26UYJj2vm0GPXHSLKlz, product_id: prod_UdwjYeet4QFbtW }`
- Stripe account: `stripe_poland` (test_mode=true, status=active)

## Runtime gates

### 1. bePaid existing public link
- `GET public-checkout?token=8be717eacdee2ccb6c3898186dad7124` → HTTP 200.
- body.provider = `bepaid`, currency=BYN, product/tariff заполнены.
- **PASS**.

### 2. bePaid new public link
- `POST admin-create-public-link` без `provider` → HTTP 200, `provider: "bepaid"`, `account_code: null`, `url_token=aa84b4e5...`.
- Тестовая ссылка инвалидирована через `admin-invalidate-payment-link`.
- **PASS**.

### 3. Stripe one-time public link
- Writer: `payment_link_id=b3b9886f-547b-4fad-899a-f814a4c2ef14`, `provider='stripe'`, `account_code='stripe_poland'`, `currency='EUR'`.
- `POST public-checkout` → HTTP 200, `redirect_url` начинается с `https://checkout.stripe.com/c/pay/cs_test_...` ✓.
- `orders_v2` proof:
  ```
  id=9f4979b3-accb-4566-a243-b494c2b1044b
  status='pending'
  provider='stripe'
  currency='EUR' base_price=5.00
  meta.payment_link_id=b3b9886f-547b-4fad-899a-f814a4c2ef14
  meta.stripe.checkout_session_id=cs_test_a1lnK4Y2YoOU5Rg6J1BV0oMAWEsqfUirXr0qVpknqIjmmazFQZm94fwvVU
  count=1
  ```
- **PASS**.

### 4. Stripe subscription public link
- Writer: `payment_link_id=07946a5f-e1f0-4903-8c0c-d269e4da76ea`, `provider='stripe'`, `currency='EUR'`, `payment_type='subscription'`, `offer_id=6f306cbc-...`.
- `POST public-checkout` (email=labus-bar@mail.ru, у пользователя нет CHAT-подписки) → HTTP 200, `redirect_url` начинается с `https://checkout.stripe.com/c/pay/cs_test_...` ✓, `order_id=null` (Phase 3.1/3.2 контракт).
- SQL gates по `meta.payment_link_id=07946a5f-...`:
  ```
  orders_v2               count=0   ← orders_v2 created before invoice.paid = 0 ✓
  subscriptions_v2        count=1   status='pending' billing_type='provider_managed'
                                    meta.stripe.price_id=price_1Teeq26UYJj2vm0GPXHSLKlz
                                    meta.stripe.checkout_session_id=cs_test_a1RvBt2Ga6V9X97byLnNApbUanwwR8lNAlz0OZsfJbu9WlpOOdUFScNPFn
  provider_subscriptions  count=1   state='pending' provider='stripe'
                                    provider_subscription_id='pending:84b224c7-b61e-4352-a3c7-b98a694ccd54'
  ```
- **PASS**.

### 5. Admin Stripe subscription checkout (dry_run)
- `POST stripe-create-subscription-checkout` (dry_run=true, user=nairka527@mail.ru / `d626811f-...`) → HTTP 200, `ok=true`, `mode='dry_run'`.
- plan: `account_code='stripe_poland'`, `price_id=price_1Teeq26UYJj2vm0GPXHSLKlz`, `mode='subscription'`.
- pending_check=`no_pending`, duplicate_check=`no_conflict`.
- **PASS**.

### 6. Валюты BYN/EUR/USD/PLN
- UI селектор содержит ровно 4 пункта (BYN/EUR/USD/PLN); пункты с unsupported по capabilities_snapshot — disabled.
- Backend whitelist `Set(['BYN','EUR','USD','PLN'])`.
- Smoke writer: BYN+Stripe → HTTP 200 (payment_link_id=b19c1fec-...) ✓; EUR+Stripe → HTTP 200 (×2) ✓.
- **PASS**.

### 7. GBP удалён
- UI: `<SelectItem value="GBP">` удалён (rg по src — упоминание GBP только в комментарии StripeSandboxCheckoutDialog).
- Backend: writer-вызов с `currency='GBP'` → HTTP 400 `Stripe: unsupported currency GBP` ✓.
- **PASS**.

## Provider routing proof

```
payment_links.provider='bepaid'
  link aa84b4e5... → public-checkout GET → provider:"bepaid", тариф/продукт корректные
  (legacy 113 ссылок — нерегрессия: 8be717ea... GET → provider:"bepaid")

payment_links.provider='stripe'
  link c0f722a1... (one_time)    → public-checkout POST → redirect_url=checkout.stripe.com + orders_v2 pending stripe
  link 73c003be... (subscription) → public-checkout POST → redirect_url=checkout.stripe.com + subscriptions_v2 pending + provider_subscriptions pending (orders_v2=0)
```

## Cleanup

Все тестовые `payment_links` помечены `status='inactive'` через `admin-invalidate-payment-link`:
- afab4e48-... (bepaid one_time)
- b3b9886f-... (stripe one_time)
- 07946a5f-... (stripe subscription)
- b19c1fec-... (stripe BYN one_time)

Pending `subscriptions_v2` `84b224c7-...` + `provider_subscriptions` `c82962ff-...` остаются как `pending` — обработает штатный pending-cleanup (никаких ручных UPDATE по правилам проекта).

## Final verdict

```
Stripe one-time public link     = PASS
Stripe subscription public link = PASS
bePaid existing public link     = PASS
bePaid new public link          = PASS
Admin Stripe subscription chk   = PASS
Валюты BYN/EUR/USD/PLN          = PASS
GBP удалён                       = PASS
```
