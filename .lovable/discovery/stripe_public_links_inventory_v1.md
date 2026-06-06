# Discovery: Stripe Public Payment Links Inventory v1

Дата: 2026-06-06
Фаза: Phase 4 — Public Payment Links
Тип: read-only inventory (без правок кода / миграций / runtime записи)

## A0. Stripe Readiness Check

| Признак | Источник | Результат |
|---|---|---|
| acquiring_connections для Stripe | `SELECT … FROM acquiring_connections` | `stripe_poland`, test_mode=true, status=active, last_verified_at=2026-06-03 13:33 UTC |
| Stripe checkout создавался | `provider_events` | `checkout.session.completed` ×21, `payment_intent.succeeded` ×19 |
| Stripe subscription создавалась | `provider_events` | `customer.subscription.created` ×10, `invoice.paid` ×8 |
| Stripe portal создавался | edge function `stripe-create-customer-portal-session` присутствует, runtime в Phase 3.4 = PASS | — |
| Stripe orders в БД | `orders_v2 WHERE meta->>'provider'='stripe'` | 5 заказов (EUR/PLN/BYN/RUB/USD), все paid/refunded |
| Stripe subscriptions в БД | `subscriptions_v2 WHERE meta->'stripe' IS NOT NULL` | 5 шт. (active/canceled/pending) |

Вывод: Stripe test-mode боевой; ключи введены; сценарий `PENDING-BY-STRIPE-KEYS` исключён.

## A1. Карта создания публичных ссылок

```text
[Admin UI: AdminPaymentsHub → «Ссылки» / CreatePublicLinkDialog]
        ↓ POST
[edge: admin-create-public-link]   ← canonical writer
        ↓ INSERT
[payment_links]  (provider, account_code, currency, payment_type, meta.installment)
        ↓ клиент открывает public_url
[Page: /pay/:token]
        ↓ GET (info) / POST (start checkout)
[edge: public-checkout]
        ↓ delegate
[_shared/create-payment-checkout.ts]   ← provider branch happens here
        ↓
   ┌──────────────┬──────────────┐
   ↓              ↓              ↓
[bePaid path]  [Stripe path]  [installment → bePaid finite sub]
```

Подтверждено: writer один (`admin-create-public-link`), таблица одна (`payment_links`), read одна (`payment_links_enriched_v`).

## A2. Матрица типов ссылок (фактическая реализация)

| Тип | bePaid | Stripe | Writer | Downstream |
|---|---|---|---|---|
| Public one-time (product+tariff) | ✅ | ❌ **gap** | `admin-create-public-link` | `public-checkout` → `_shared/create-payment-checkout` → bePaid |
| Public subscription (recurring) | ✅ | ❌ **gap** | `admin-create-public-link` | то же |
| Public installment (finite sub) | ✅ | ❌ | `admin-create-public-link` (`installment_offer=true`) | bePaid `/subscriptions` `billing_cycles=N` |
| Trial | ✅ | ❌ | через subscription offer | bePaid |
| Admin direct one-time | ✅ | n/a | `admin-create-payment-link` | bePaid |
| Admin sandbox Stripe checkout | n/a | ✅ | `stripe-admin-sandbox-checkout` (НЕ через payment_links) | `stripe-create-checkout` / `stripe-create-subscription-checkout` |
| Site CTA / pricing block one-time | ✅ | ⚠️ через `stripe-create-checkout` (не payment_links) | `_shared/create-payment-checkout.ts` | bePaid; Stripe direct call мимо payment_links |

Все 113 строк `payment_links` имеют `provider='bepaid'`. Ни одна Stripe-операция не прошла через `payment_links`.

## A3. Provider Routing — единственная точка решения

**SOT расширения column `payment_links.provider`** — `'bepaid' | 'stripe' | 'admin' | 'admin_test' | 'admin_test_direct'` (CHECK constraint).

**Фактический выбор провайдера сегодня:**
1. `admin-create-public-link` НЕ принимает параметр `provider`/`account_code` → всегда дефолт колонки = `'bepaid'`.
2. `public-checkout` НЕ читает `payment_links.provider` → передаёт всё в `_shared/create-payment-checkout.ts`.
3. `_shared/create-payment-checkout.ts` — 54 упоминания `bepaid`, **0 упоминаний `stripe`**.

Вывод: **единственной точки routing для public links нет; де-факто всё уходит в bePaid.** Колонки `provider/account_code/profile_code/business_stream` в `payment_links` существуют, но writer и resolver их не использует.

## A4. Checkout URL Contract

- **bePaid:** `redirect_url` из bePaid Checkout (текущий путь, без изменений).
- **Stripe (direct, не через public link):** `https://checkout.stripe.com/...` (`Session.url`), подтверждено `provider_events.checkout.session.completed ×21`.
- **Public link host:** `payment_links.public_url` = `https://<product.primary_domain | club.gorbova.by>/pay/:token`. DB CHECK блокирует preview-домены.

## Cross-Provider Counters (baseline)

| Метрика | Значение |
|---|---|
| `payment_links` всего | 113 |
| `payment_links.provider='bepaid'` | 113 (100%) |
| `payment_links.provider='stripe'` | 0 |
| `provider_subscriptions.provider='stripe'` | 13 |
| `provider_subscriptions.provider='bepaid'` | 718 |
| `orders_v2 meta.provider='stripe'` | 5 (все sandbox direct, `payment_link_id=NULL`) |
| `acquiring_connections stripe active` | 1 (test_mode) |

## E. Admin UX Inventory (gaps)

В `CreatePublicLinkDialog` и таблице «Ссылки» сегодня НЕ видно оператору:
- селектор `provider` (bePaid / Stripe) — поля просто нет;
- `account_code` (`stripe_poland`) — не выбирается;
- `test_mode` / `live_mode` badge на ссылке — отсутствует;
- `business_stream` / `profile_code` — не отображается.

Видно: продукт/тариф, валюта (фиксированная), тип ссылки (one-time/subscription/installment), статус, использование.

Backlog для будущей реализации (не сейчас): `.lovable/backlog/stripe_public_links_admin_ux_v1.md` (создан отдельно при старте Phase 5).

## Зафиксированные находки (для proof)

1. **Public payment links через Stripe сегодня НЕ создаются** — отсутствует и writer-параметр, и provider-ветка в downstream.
2. Stripe полностью функционален в admin sandbox path и через прямые вызовы `stripe-create-*`.
3. bePaid public links не подвержены влиянию Stripe (denylist verifier чист, см. proof).
4. Customer Portal сторонне работает для Stripe-подписок, созданных прямым checkout'ом (Phase 3.4 PASS).
