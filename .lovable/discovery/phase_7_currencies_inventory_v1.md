# Phase 7 — Currencies Discovery: Inventory

Дата: 2026-06-07. Discovery/spec-only. Никаких runtime/UI/БД изменений.

## 1. Бизнес-whitelist
EUR, PLN, USD, BYN, RUB.

## 2. Распределение по таблицам (SQL, актуально на 2026-06-07)

| Таблица | Валюта | Количество строк |
|---|---|---|
| orders_v2 | BYN | 3697 |
| orders_v2 | RUB | 20 |
| orders_v2 | USD | 11 |
| orders_v2 | EUR | 7 |
| orders_v2 | PLN | 2 |
| payment_links | BYN | 117 |
| payment_links | EUR | 5 |
| payments_v2 | BYN | 5978 |
| payments_v2 | USD | 9 |
| payments_v2 | EUR | 4 |
| payments_v2 | PLN | 3 |
| payments_v2 | RUB | 2 |

Примечание: `tariff_offers` хранит валюту в `meta.acquiring.<provider>.currency` (нет отдельной column). `subscriptions_v2` тоже не имеет column `currency` — валюта определяется через offer.

## 3. Карта полей "currency"
| Источник | Поле | Тип хранения |
|---|---|---|
| `payment_links` | `currency` (column) | text |
| `orders_v2` | `currency` (column) | text |
| `payments_v2` | `currency` (column) | text |
| `tariff_offers` | `meta.acquiring.bepaid.currency`, `meta.acquiring.stripe.currency` | jsonb |
| `subscriptions_v2` | `meta.currency` (derived) | jsonb |

## 4. Hardcoded валютные литералы (file:line)

### Frontend (admin)
- `src/components/admin/AdminPaymentLinkDialog.tsx:198` — `useState<string>("EUR")` (default Stripe currency).
- `src/components/admin/AdminPaymentLinkDialog.tsx:248` — `STRIPE_CURRENCY_OPTIONS = ["BYN","EUR","USD","PLN"]` (4 валюты, без RUB).
- `src/components/admin/AdminPaymentLinkDialog.tsx:268` — `previewCurrency = provider === "stripe" ? stripeCurrency : "BYN"` (bePaid → BYN hardcode).

### Edge functions
- `supabase/functions/public-checkout/index.ts:344` — `link.currency ?? (effectiveProvider === 'stripe' ? 'EUR' : 'BYN')` (fallback).
- `supabase/functions/bepaid-webhook/index.ts` — массовый fallback `|| 'BYN'` (~30 мест: 1109, 1362, 1515, 1530, 1753, 1815, 2081, 2227, 2332, 2477, 2727, 2783, 3137, 3535, 3572, 3880, 3951, 4106, 4252, 4277). Это последний fallback для bePaid-only платежей — менять только в рамках EXEC-фазы.
- `supabase/functions/_shared/admin-notify-message.ts:112` — `${num.toFixed(2)} ${currency || 'BYN'}` (форматирование).
- `supabase/functions/bepaid-webhook/rebill_deps_adapter.ts:134` — `payment.currency || 'BYN'`.

### Поиск шире (для EXEC-фазы)
Расширить grep на:
`'PLN'`, `'USD'`, `'RUB'`, `currency fallback`, `defaultCurrency`, `default_currency`, `amount_currency`, `provider_currency`.

## 5. Текущая логика выбора валюты в UI
- **Offer create/edit (`OfferAcquiringSettings.tsx`)** — отдельного селектора валюты НЕТ; валюта задаётся через `meta.acquiring.<provider>.currency` без UI-control.
- **Admin payment link (`AdminPaymentLinkDialog.tsx`)** — `STRIPE_CURRENCY_OPTIONS` хардкод (4 валюты), bePaid всегда BYN.
- **Public checkout (`/pay/:token`)** — берёт `link.currency` без выбора пользователем.

## 6. Что НЕ покрыто (open questions для Phase 7-EXEC)
1. `tariff_offers` не имеет column `currency` — нужно или решить на уровне `meta`, или ввести column в EXEC-фазе.
2. Кросс-валютные кейсы внутри одного оффера (bePaid BYN + Stripe EUR/PLN/USD) — текущий контракт `acquiring.<provider>.currency` это поддерживает, но UI создания валюты-per-provider отсутствует.
3. `subscriptions_v2` — наследование валюты от offer/order, или собственное хранение?
4. RUB в Stripe Poland — capability discovery (см. §Phase 7 spec).
5. Adaptive Pricing Stripe — обсудить отдельно.

## 7. Файлы изменений (для EXEC, NOT в этом спринте)
- `src/components/admin/products/OfferAcquiringSettings.tsx` — селектор валюты per-provider с disabled+tooltip.
- `src/components/admin/AdminPaymentLinkDialog.tsx` — STRIPE_CURRENCY_OPTIONS через резолвер; авто-переключение provider при выборе валюты.
- `src/components/payments/PaymentDialog.tsx` (public) — корректный набор провайдеров под `link.currency`.
- `supabase/functions/_shared/acquiring/` — модуль `currency-provider-resolver.ts` (новый).
- `supabase/functions/bepaid-webhook/` — НЕ трогать в EXEC до отдельного решения (массив fallback'ов).

## DoD Phase 7 Discovery
- [x] SQL inventory по 5 таблицам.
- [x] Карта полей `currency`.
- [x] Hardcoded литералы с file:line.
- [x] UI логика описана.
- [x] Open questions сформулированы.
- [ ] Stripe Poland capabilities (см. `stripe_currency_support_v1.md` §2 — заполняется отдельным шагом или в Phase 7-EXEC).
- [x] Никаких миграций / UI / runtime изменений.
