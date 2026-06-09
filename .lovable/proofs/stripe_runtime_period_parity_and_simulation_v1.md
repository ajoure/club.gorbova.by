# PATCH-RUNTIME-PERIOD-PARITY + симуляция (2026-06-09)

## Diagnose
- Сломанная ссылка `4081a3229de4405bff857cf3faefab4c` (БкБ Стандартный, PLN 5.00, subscription, stripe).
- `payment_links.meta.stripe_recurring_snapshot = {interval:"month", interval_count:1}` (записан PATCH-B).
- Источник 500-runtime: `_shared/create-stripe-checkout.ts` читал `offer.meta.recurring.billing_period_mode='month'` и `billing_period_days` отсутствует → ветка не поддерживала ничего, кроме `mode='days'+N` → `unsupported_recurring_period_for_inline_price`.

## Fix
`supabase/functions/_shared/create-stripe-checkout.ts` (subscription + payment_link_id branch):
1. Сначала читает `payment_links.meta.stripe_recurring_snapshot` (SOT для link-based subscription, parity с PATCH-B).
2. Fallback — `offer.meta.recurring` с расширенным `billing_period_mode ∈ {day(s), week(s), month(s), year(s)}` и `billing_period_days || recurring_interval_days` для legacy days-схемы.

`tariff_offers.meta`, глобальные Stripe price/product, bePaid/e-clearing/Pay-ветки не тронуты.

Deployed: `public-checkout`, `create-payment-checkout`, `stripe-create-checkout`.

## Simulation (dry-run, без реальной оплаты)

| # | Продукт / тариф | Тип | Сумма | Provider | url_token | redirect_url | Card UI |
|---|---|---|---|---|---|---|---|
| 1 | БкБ Стандартный | subscription | PLN 5.00 | stripe | 4081a322... | cs_live_a1SeEpZQ... | ✅ Stripe (Apple Pay + USD/PLN toggle + Card/CVC) |
| 2 | Gorbova Club FULL | subscription | USD 2.00 | stripe | b082ecd0... | cs_live_a1mrS4KL... | ✅ Stripe |
| 3 | Gorbova Club FULL | one-time | USD 5.00 | stripe | daac7764... | cs_live_a1ZzCjGU... | ✅ Stripe Link + Pay without Link |
| 4 | Gorbova Club FULL | one-time | BYN 1.00 | bepaid | 9ba06c88... | checkout.bepaid.by/widget/hpp.html | ✅ bePaid (Карта / Google Pay / Samsung Pay / ЕРИП) |

Скриншоты Stripe и bePaid checkout-экранов подтверждают:
- Stripe inline price корректно показывает `$1.41/month Billed monthly` для PLN→USD конвертации.
- Stripe Link (для One-Time USD) показывает "Pay without Link" → ввод другой карты.
- bePaid HPP сразу даёт «Оплатить картой» / Google Pay / Samsung Pay / ЕРИП — выбор карты остаётся за пользователем.

## DoD
- [x] `4081a322...` больше не возвращает `unsupported_recurring_period_for_inline_price`.
- [x] Stripe Checkout открывается на всех 3 stripe-ссылках, доходит до экрана ввода карты.
- [x] bePaid Checkout штатно открывается (контроль).
- [x] Смена карты доступна: Stripe Link → "Pay without Link"; bePaid → выбор метода/новой карты.
- [x] `tariff_offers.meta` и глобальные Stripe price/product не изменены.
- [x] bePaid/e-clearing/Pay edge-функции не тронуты.

## Notes
- Реальная оплата не выполнялась — симуляция остановлена на экране ввода карты согласно требованию.
- Все 3 SIM-ссылки активны (`status='active'`) и могут быть отключены через admin UI.
