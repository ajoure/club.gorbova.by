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

Классификация: **UI default** / **business rule** / **provider constraint** / **legacy fallback**.

### Frontend (admin)
- `src/components/admin/AdminPaymentLinkDialog.tsx:198` — `useState<string>("EUR")` — **UI default**.
- `src/components/admin/AdminPaymentLinkDialog.tsx:248` — `STRIPE_CURRENCY_OPTIONS = ["BYN","EUR","USD","PLN"]` — **business rule (frontend копия)**.
- `src/components/admin/AdminPaymentLinkDialog.tsx:268` — `previewCurrency = provider === "stripe" ? stripeCurrency : "BYN"` — **provider constraint (bePaid hardcode)**.
- `src/hooks/useUnifiedPayments.tsx:495` — `currency: q.currency || 'BYN'` — **legacy fallback**.
- `src/pages/settings/PaymentMethods.tsx:738` — `sub.currency || 'BYN'` — **legacy fallback (UI render)**.

### Edge — расхождения business whitelist (важно)
- `supabase/functions/admin-create-public-link/index.ts:55` — `STRIPE_ALLOWED_CURRENCIES = new Set(['BYN','EUR','USD','PLN'])` — **business rule**, 4 валюты.
- `supabase/functions/admin-provision-stripe-price/index.ts:28` — `CURRENCY_WHITELIST = ['BYN','USD','EUR','PLN','RUB','KZT','UAH']` — **business rule**, 7 валют.
- **Conflict:** два источника business whitelist для Stripe расходятся (4 vs 7). EXEC-фаза должна свести в единый канон через resolver.

### Edge — Stripe / pre-create
- `supabase/functions/_shared/stripe-pre-create-subscription.ts:206` — `currency: 'BYN'` — **provider constraint hardcode** (подозрительно для Stripe, требует ревью в EXEC).

### Edge — public checkout / fallback
- `supabase/functions/public-checkout/index.ts:344` — `link.currency ?? (effectiveProvider === 'stripe' ? 'EUR' : 'BYN')` — **legacy fallback** (нарушает STOP-правило, удаляется в EXEC).
- `supabase/functions/admin-create-public-link/index.ts:98` — `(rawCurrency ?? (provider === 'stripe' ? 'EUR' : 'BYN')).toUpperCase()` — **legacy fallback**.

### Edge — bePaid (provider constraint, OK как есть)
- `supabase/functions/bepaid-create-subscription/index.ts:168` — `let currency = 'BYN'` (initial), переопределяется.
- `supabase/functions/bepaid-create-subscription-checkout/index.ts:234` — `let currency = 'BYN'` (initial).
- `supabase/functions/bepaid-admin-create-subscription-link/index.ts:145` — `const currency = 'BYN'` — **provider constraint** (bePaid сейчас BYN-only).
- `supabase/functions/bepaid-webhook/index.ts` — массовый fallback `|| 'BYN'` (~30 точек: 1109, 1362, 1515, 1530, 1753, 1815, 2081, 2227, 2332, 2477, 2727, 2783, 3137, 3535, 3572, 3880, 3951, 4106, 4252, 4277, 4422, 5151, 5207, 5704) — **provider constraint** (читает provider response; OK для bePaid-only потока).
- `supabase/functions/bepaid-webhook/rebill_deps_adapter.ts:134` — **provider constraint**.
- `supabase/functions/bepaid-sync-orchestrator/index.ts:244,273,1324` — **provider constraint**.
- `supabase/functions/bepaid-list-subscriptions/index.ts:782,862` — **provider constraint**.
- `supabase/functions/bepaid-get-subscription-details/index.ts:804`, `bepaid-get-payment-docs/index.ts:287`, `bepaid-polling-backfill/index.ts:228`, `bepaid-recover-payment/index.ts:172`, `bepaid-receipts-sync/index.ts:133`, `bepaid-reconcile-file/index.ts:301,345`, `bepaid-uid-resync/index.ts:461`, `bepaid-docs-backfill/index.ts:234`, `bepaid-auto-process/index.ts:727,736,778,880`, `admin-bepaid-reconcile-amounts/index.ts:271,624,625`, `admin-bepaid-full-reconcile/index.ts:238` — все **provider constraint** (bePaid context).
- `supabase/functions/admin-manual-charge/index.ts:313,335,361,390,469,511,726` — `currency: 'BYN'` — **provider constraint** (ручной bePaid charge).
- `supabase/functions/admin-materialize-queue-payments/index.ts:270`, `admin-link-payment-to-order/index.ts:175`, `admin-backfill-2026-orders/index.ts:245`, `admin-fix-payments-integrity/index.ts:237` — **legacy fallback** (admin reconcile из bePaid).

### Edge — документы (форматирование сумм)
- `supabase/functions/_shared/standard-fields.ts:82,206,208` — `'BYN'` как последний fallback для формулировки прописью — **legacy fallback** (документный layer, не платёжный).
- `supabase/functions/canonical-document-generate-strict/index.ts:98,106-109,212` — словарь рублей/евро/долларов — **business rule** (нужен для прописи).
- `supabase/functions/generate-document-pdf/index.ts:499`, `document-auto-generate/index.ts:483` — **legacy fallback** (документы).
- `supabase/functions/_shared/admin-notify-message.ts:112` — **legacy fallback** (нотификация).
- `supabase/functions/_shared/paymentClassification.ts:95` — `currency === 'BYN' && ...` — **business rule** (классификация bePaid-платежа).

### Прочее
- `supabase/functions/acquiring-test-connection/index.ts:92` — отдаёт Stripe `default_currency` — **OK**, не hardcode.
- `supabase/functions/bepaid-create-token/index.ts:443` — только лог, не запись.

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
- [x] Hardcoded литералы с file:line и классификацией (UI default / business rule / provider constraint / legacy fallback).
- [x] Расхождение Stripe business whitelist (4 vs 7 валют) задокументировано.
- [x] UI логика описана.
- [x] Open questions сформулированы.
- [ ] Stripe Poland capabilities (см. `stripe_currency_support_v1.md` §2 — заполняется в Phase 7-EXEC).
- [x] Никаких миграций / UI / runtime изменений.

### Machine-check (manual)
Ожидаемый `git diff --name-only` после Phase 7 Discovery:
```
.lovable/discovery/phase_7_currencies_inventory_v1.md
.lovable/discovery/phase_7_currency_provider_resolver_v1.md
.lovable/discovery/stripe_currency_support_v1.md
.lovable/plan.md
```
Любые другие файлы в diff — нарушение spec-only контракта.

## Запреты Phase 7 Discovery
- Миграции, UI-изменения, checkout/webhook изменения.
- Новые Edge Functions, новые Stripe/bePaid helpers, новые provider profiles.
- Currency conversion, FX rates, авто-конвертация валют.
- **Запрещено добавлять или сохранять fallback-логику вида: если currency unsupported → использовать BYN/EUR по умолчанию.**
