# Proof: PATCH-SUB-PRICE-1 v2 — Payment Link Amount/Currency Override Parity для Stripe Subscriptions

Дата: 2026-06-09
Scope: Stripe subscription public payment links
Status: EXECUTE DONE — ready for live verify

## 1. Root cause

Ссылка `payment_link 2c02396f-9582-4e8e-b666-cb19a50f9d4b` (Gorbova Club CHAT, 1.00 EUR, subscription, provider=stripe, account=stripe_poland) падала с `price_retrieve_failed` потому что:

- `_shared/create-stripe-checkout.ts` subscription branch **полностью игнорировал** `payment_links.amount/currency` и тащил `tariff_offers.meta.stripe.price_id` (`price_1Teeq26UYJj2vm0GPXHSLKlz`);
- этот `price_id` — **test-mode BYN 100.00** (snapshot: `livemode:false, currency:byn, unit_amount:10000`);
- `acquiring_connections.stripe_poland` — **live mode** (`test_mode=false`);
- live Stripe секрет физически не может retrieve test-mode price → `prices/{id}` 404 → `price_retrieve_failed`.

Даже если бы retrieve прошёл — Stripe Checkout открылся бы на 100 BYN, а не на 1 EUR из ссылки.

## 2. Parity с bePaid/e-clearing/Pay (до патча)

| Слой | bePaid | Stripe one-time | Stripe subscription (BEFORE) | Stripe subscription (AFTER) |
|---|---|---|---|---|
| `public-checkout` → `createPaymentCheckout` | `link.amount`+`link.currency` | то же | то же | то же |
| Stripe adapter | n/a | `toStripeMinorUnits(amountMajor, currency)` ✅ | **price_id из offer.meta** 💥 | `inline_price` из `link.amount/currency` ✅ |

После патча Stripe subscription использует ту же логику, что одноразовый Stripe-checkout: сумма ссылки → minor units → Stripe Checkout. Recurring период берётся из канонического SOT `tariff_offers.meta.recurring`.

## 3. Resolver (после патча)

```text
IF subscription checkout & payment_link_id присутствует:
    → INLINE price_data:
        amount   = payment_links.amount   (через caller params.amount)
        currency = payment_links.currency (через caller params.currency)
        recurring.interval/interval_count ← tariff_offers.meta.recurring.{billing_period_mode,billing_period_days}
        product  ← reuse offer.meta.stripe.accounts[account_code].product_id || offer.meta.stripe.product_id
                    || price_data[product_data][name] = product.name (fallback)
    → НЕ читаем offer.meta.stripe.price_id
    → НЕ делаем prices.retrieve / drift-check

ELSE (site CTA / admin direct без payment_link):
    → existing path: offer.meta.stripe.price_id + drift-check (active/livemode/recurring)
```

Период (offer `6f306cbc`: `billing_period_mode=days, billing_period_days=30, is_recurring=true`)
→ `interval=month, interval_count=1`. 7 → week/1; 365–366 → year/1; иное в днях ≤365 → day/N; всё иное → `unsupported_recurring_period_for_inline_price`.

## 4. Изменённые файлы

- `supabase/functions/_shared/stripe-pre-create-subscription.ts`
  - `StripePreCreateSubscriptionParams` теперь дискриминированное объединение: либо `price_id`, либо `inline_price`. Контракт компилятор-enforce'd.
  - `inline_price` ветка: `line_items[0][price_data][...]`; drift-check скипается; в `subscriptions_v2.meta.stripe`/`provider_subscriptions.meta.stripe` пишется snapshot `inline_price`, `price_id=null`.
  - `provider_subscriptions.currency` = валюта ссылки (UPPER) для inline; legacy 'BYN' для price_id-пути.
  - Stripe 400 с `currency*` маппится в `currency_not_supported_by_stripe_account`.
  - `metadata[inline_price]=1`, `inline_amount_minor`, `inline_currency`, `inline_interval`, `inline_interval_count` дублируются в `metadata` и `subscription_data.metadata`.
- `supabase/functions/_shared/create-stripe-checkout.ts`
  - Subscription branch определяет `useInlinePrice = Boolean(payment_link_id)`.
  - Резолвит recurring из `offer.meta.recurring`. Ошибки: `offer_not_recurring_for_subscription_link`, `unsupported_recurring_period_for_inline_price`.
  - Резолвит Stripe product reuse приоритетом: `accounts[account_code].product_id` → `meta.stripe.product_id`.
  - Audit `*.payment_link.created` получает `price_source`, `inline_amount_major`, `inline_currency`.
- `src/utils/normalizeEdgeFunctionError.ts`
  - Добавлены русские строки для 4 новых кодов: `currency_not_supported_by_stripe_account`, `offer_not_recurring_for_subscription_link`, `unsupported_recurring_period_for_inline_price`, `inline_amount_invalid`.

## 5. Что НЕ изменено (snapshot guard)

- `tariff_offers.amount`, `tariff_offers.meta.stripe.price_id`, `price_snapshot`, `price_id_history` — НЕ трогаются. Snapshot до и после патча offer `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`:
  - `amount = 100.00`
  - `meta.stripe.price_id = price_1Teeq26UYJj2vm0GPXHSLKlz`
  - `meta.stripe.price_snapshot.unit_amount = 10000, currency = byn, livemode = false`
  - `meta.recurring.billing_period_days = 30, is_recurring = true`
- `_shared/create-payment-checkout.ts` bePaid branch — без изменений (diff: 0 строк).
- bePaid edge functions, e-clearing, Pay — без изменений (Stripe-only патч).
- `admin-create-public-link`, `public-checkout/index.ts` — без изменений (передача `link.amount/currency` уже была корректной).
- `stripe-webhook/index.ts` — без изменений: lookup идёт через `metadata.subscription_v2_id` / `metadata.tariff_offer_id`, не зависит от `price_id`.

## 6. Webhook compatibility

Webhook на `checkout.session.completed` / `customer.subscription.created` / `invoice.paid` использует:
- `Session.metadata.subscription_v2_id` для привязки pending subscription;
- `Session.metadata.tariff_offer_id` + `product_id` + `tariff_id` для downstream.

Inline price снимает только `metadata[price_id]` (становится пустой строкой) и добавляет `metadata[inline_*]`. Lookup-логика не затронута. `subscriptions_v2.meta.stripe.inline_price` остаётся как audit/snapshot.

## 7. Dry-run по ссылке 2c02396f

Resolver выбирает:
```json
{
  "use_inline_price": true,
  "amount_major": 1,
  "currency": "EUR",
  "amount_minor": 100,
  "interval": "month",
  "interval_count": 1,
  "product": "prod_UdwjYeet4QFbtW",
  "account_code": "stripe_poland",
  "tariff_offer_id": "6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e",
  "product_id": "11c9f1b8-0355-4753-bd74-40b42aa53616",
  "tariff_id": "31f75673-a7ae-420a-b5ab-5906e34cbf84"
}
```

Stripe Checkout payload (релевантные ключи):
```
mode=subscription
line_items[0][quantity]=1
line_items[0][price_data][currency]=eur
line_items[0][price_data][unit_amount]=100
line_items[0][price_data][recurring][interval]=month
line_items[0][price_data][recurring][interval_count]=1
line_items[0][price_data][product]=prod_UdwjYeet4QFbtW
metadata[subscription_v2_id]=<uuid>
metadata[tariff_offer_id]=6f306cbc-…
metadata[product_id]=11c9f1b8-…
metadata[tariff_id]=31f75673-…
metadata[payment_link_id]=2c02396f-…
metadata[inline_price]=1
metadata[inline_amount_minor]=100
metadata[inline_currency]=EUR
metadata[inline_interval]=month
metadata[inline_interval_count]=1
subscription_data[metadata][…] (зеркало metadata)
```

Drift-check (`prices.retrieve`) НЕ выполняется → `price_retrieve_failed` физически невозможен на этом пути.

## 8. Verify (по факту, после деплоя)

1. Открыть `/pay/<token>` для `2c02396f` → редирект на Stripe Checkout без `price_retrieve_failed`.
2. Stripe Checkout показывает `1.00 EUR / month`, product = Gorbova Club CHAT.
3. После test-оплаты (или Cancel):
   - `subscriptions_v2.meta.stripe.inline_price` snapshot есть, `meta.stripe.price_id = null`.
   - `provider_subscriptions.currency = 'EUR'`.
   - `tariff_offers` идентичен снапшоту из §5.
4. Smoke bePaid link (один любой active bePaid one-time) — открывается как раньше.
5. `audit_logs` action `*.payment_link.created` содержит `price_source = 'inline_payment_link'`.

## 9. DoD

- [x] `_shared/stripe-pre-create-subscription.ts` поддерживает `inline_price`.
- [x] `_shared/create-stripe-checkout.ts` subscription branch использует inline для payment_link, classic price_id для других caller'ов.
- [x] Типобезопасный дискриминированный союз (без `as any` для price_id).
- [x] Recurring резолвится из канонического `offer.meta.recurring`.
- [x] Глобальная цена offer/`price_id`/`price_snapshot` не изменены.
- [x] bePaid/e-clearing/Pay не затронуты.
- [x] Новые ошибки в `normalizeEdgeFunctionError`.
- [x] Webhook lookup не сломан (по metadata.subscription_v2_id).
- [ ] Live verify через preview /pay/<token> — за owner после деплоя.

## 10. Follow-ups (не в этом патче)

- `canonical_live_price_for_offer_6f306cbc` — отдельный backlog: дополнительно provision LIVE BYN price для site-CTA path (текущий patch покрывает только payment_link flow).
- UX в `CreatePublicLinkDialog` для явного выбора Stripe provider/account/currency — отдельный sprint.
- Inline-price audit dashboard (фильтр по `price_source = 'inline_payment_link'`).
