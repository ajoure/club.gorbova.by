# Hotfix admin_provider_override_v1 — Proof

## Контекст
`admin-create-public-link` блокировал fixed Stripe / customer_choice Stripe
для всех тарифов, у которых `offer.meta.acquiring.allowed_payment_providers`
не содержит `stripe` (в проде это 38/38 офферов). Это противоречит правилу:
**`offer.allowed_payment_providers` — настройка публичной кнопки, а admin link
из карточки контакта — override на уровне конкретной ссылки.**

## Изменения

Файл: `supabase/functions/admin-create-public-link/index.ts`

1. Блок «validation per provider_mode» (~строки 216–258):
   - Guard `provider ∈ offer.allowed_payment_providers` теперь применяется
     ТОЛЬКО при `providerMode='fixed' && providerChoiceSource='auto'`
     («По настройке кнопки»).
   - При `providerChoiceSource='explicit'` (admin явно выбрал bePaid/Stripe)
     guard НЕ применяется. Технические проверки (currency × provider × account
     × installment) остаются в Step 1 (bePaid) и Step 2 (Stripe) ниже.
   - `customer_choice` остаётся как было: проверяет `effectiveAllowedProviders`
     (override из body перезаписывает offer.allowed только в `payment_links.meta`,
     `tariff_offers.meta` не модифицируется).
2. `stripeValidationCurrency` (~строка 304):
   - Заменили хардкод `rawStripeCurrency || 'EUR'` на `rawStripeCurrency || currency`.
   - Это позволяет customer_choice ссылке с link.currency=BYN валидировать
     Stripe-ветку по явно переданному `stripe_currency` (BYN/USD/EUR/PLN)
     без silent fallback в EUR.

Не тронуто: `bepaid-webhook`, `grant-access-for-order`, `telegram-grant-access`,
`subscriptions-reconcile-*`, `public-checkout`, `AdminPaymentLinkDialog.tsx`,
миграций нет, `tariff_offers.meta.acquiring` не модифицируется.

## Runtime smoke (deployed: 2026-06-08 07:29 UTC)

Fixture offer: `c244bbd4-b820-4de3-ad9a-c026aed9f3dd`,
`tariff=f2e999a9-…`, `product=9d0d6de8-…`,
`meta.acquiring = { allowed_payment_providers: ["bepaid"], default_provider: "bepaid" }`.

Actor: обычный admin JWT из preview (не super_admin).

| # | Сценарий | Body (ключевое) | HTTP | Результат | Verdict |
|---|---|---|---|---|---|
| A | fixed Stripe explicit | `provider:stripe, mode:fixed, source:explicit, currency:BYN` | 200 | `payment_links.provider=stripe`, `account_code=stripe_poland`, link_id `4fbbfbcd-…` | PASS |
| B | customer_choice explicit | `mode:customer_choice, source:explicit, allowed:[bepaid,stripe], stripe_currency:EUR` | 200 | `provider_mode=customer_choice`, `meta.allowed_payment_providers=[bepaid,stripe]`, `meta.stripe_currency=EUR`, `meta.allowed_providers_override.source=admin_explicit`, link_id `488afa9a-…` | PASS |
| C | fixed Stripe **auto** (регрессия) | `provider:stripe, mode:fixed, source:auto` | 400 | `provider_not_allowed_by_offer:stripe` — поведение auto-режима сохранено | PASS |
| D | fixed bePaid explicit | `provider:bepaid, mode:fixed, source:explicit` | 200 | `payment_links.provider=bepaid`, link_id `551a45d7-…` | PASS |

### Offer immutability (after A+B+D)

```sql
SELECT id, meta->'acquiring' FROM tariff_offers WHERE id='c244bbd4-…';
-- → { allowed_payment_providers: ["bepaid"], default_provider: "bepaid", customer_choice_enabled: false }
```

`tariff_offers.meta.acquiring` не изменился ни в одном из трёх успешных
сценариев. Все override живут только в `payment_links.meta`.

## Gates

- AOV-1 Fixed Stripe admin link создаётся при offer allowed=`['bepaid']` — **PASS (A)**
- AOV-2 Customer_choice admin link создаётся при offer allowed=`['bepaid']` — **PASS (B)**
- AOV-3 «По настройке кнопки» (`auto`) сохраняет старое поведение — **PASS (C)**
- AOV-4 `tariff_offers.meta.acquiring` не меняется — **PASS (SQL above)**
- AOV-5 Stripe price provisioning остаётся внутри writer'а для subscription
  (не задействован в A — one_time; контракт не изменён) — **PASS (code review)**
- AOV-6 fixed bePaid без регрессии — **PASS (D)**
- AOV-7 freeze: webhook / grant / telegram / reconcile / migrations не тронуты — **PASS**
- AOV-8 Proof содержит scenarios + SQL + audit-эмиссию (admin.payment_provider.override
  и admin.payment_provider.customer_choice_override уже пишутся существующим
  кодом writer'а, контракт не изменился).

## Закрытие

Blocker `provider_not_allowed_by_offer:stripe` для admin-created Stripe link
закрыт. Следующий шаг — повторить runtime smoke Hotfix-1 (Stripe currency)
и Hotfix-2 (bePaid 404 replacement); затем Phase 8-A Discovery.
