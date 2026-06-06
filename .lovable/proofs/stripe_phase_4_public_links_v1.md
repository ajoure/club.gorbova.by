# Proof: Phase 4 — Public Payment Links (Stripe)

Дата: 2026-06-06
Связанный discovery: `.lovable/discovery/stripe_public_links_inventory_v1.md`
Изменений кода в этой фазе: **0** (read-only audit).

## Результат

**Public Payment Links: FAIL**

Единственная точка отказа: `admin-create-public-link` + `public-checkout` + `_shared/create-payment-checkout.ts` **не поддерживают Stripe для public links**. Все 113 строк `payment_links` имеют `provider='bepaid'`; ни одного Stripe-сценария через `/pay/:token` физически невозможно запустить без изменения кода (см. PATCH ниже).

## Stripe Readiness (A0) — PASS

| Признак | Доказательство |
|---|---|
| `acquiring_connections` | `stripe_poland`, test_mode=true, status=active, last_verified_at=2026-06-03 13:33 UTC |
| Stripe-события | `provider_events`: `checkout.session.completed×21`, `payment_intent.succeeded×19`, `customer.subscription.created×10`, `invoice.paid×8` |
| Stripe-orders | `orders_v2 meta.provider='stripe'`: 5 (валюты EUR / PLN / BYN / RUB / USD), статусы paid+refunded |
| Stripe-subscriptions | `subscriptions_v2 meta.stripe IS NOT NULL`: 5 (active/canceled/pending) |

⇒ Сценарий `PENDING-BY-STRIPE-KEYS` исключён. Stripe-инфраструктура боевая; отсутствует только мост `payment_links → Stripe`.

## Runtime Gates

| Gate | Условие PASS | Статус | Доказательство |
|---|---|---|---|
| G51 | One-Time Stripe public link создаётся | **FAIL** | `admin-create-public-link/index.ts` не принимает `provider`; `payment_links.provider` defaults `'bepaid'`. SELECT по `payment_links WHERE provider='stripe'` → 0 строк. |
| G52 | Subscription Stripe public link создаётся | **FAIL** | то же, плюс `_shared/create-payment-checkout.ts` имеет 0 упоминаний `stripe` (только bePaid branches). |
| G53 | `/pay/:token` открывает Stripe Checkout | **FAIL (заблокирован G51/G52)** | Невозможно — нет Stripe public link для теста. |
| G54 | Provider routing выбирает корректный provider | **FAIL** | Нет ветки выбора: `public-checkout` напрямую делегирует bePaid-helper'у. |
| G55 | `orders_v2` материализуется для Stripe public link | **FAIL (заблокирован)** | Нет таких заказов: `orders_v2 WHERE meta.provider='stripe' AND meta.payment_link_id IS NOT NULL` → 0. |
| G56 | `subscriptions_v2` материализуется для Stripe public link | **FAIL (заблокирован)** | Аналогично — 0. |
| G57 | Customer Portal работает для Stripe-подписок | **PASS (исторический)** | `stripe-create-customer-portal-session` развёрнут; Phase 3.4 Runtime Audit = PASS; 5 активных stripe-subs в БД. |
| G58 | bePaid isolation | **PASS** | См. denylist + counters ниже. |

## Cross-Provider Safety (G58 evidence)

**Denylist verifier (Phase 2-style grep):**
```bash
rg -l "acquiring/index|stripe-adapter|stripe-client|stripe-signature|stripe-metadata|acquiring/vault" \
   supabase/functions/bepaid-webhook \
   supabase/functions/_shared/create-payment-checkout.ts \
   supabase/functions/admin-create-public-link
# exit=1 (no matches) ✓
```

**Counters (snapshot 2026-06-06):**

| Таблица / разрез | bePaid | Stripe |
|---|---|---|
| `payment_links` (total) | 113 | 0 |
| `payment_links` (last 24h) | 3 | 0 |
| `provider_subscriptions` | 718 | 13 |
| `orders_v2` (meta.provider) | n/a (bePaid дефолт) | 5 (все `payment_link_id IS NULL`) |

⇒ Stripe-операции и bePaid-операции не пересекаются ни по `payment_links`, ни по edge-функциям, ни по downstream-цепочке.

## Data Integrity (Этап C)

Для Stripe public links — N/A (0 строк).
Для существующих 5 Stripe direct orders цепочка уже подтверждена в Phase 3.4 Runtime Audit (proof: `.lovable/proofs/stripe_phase_3_4_runtime_audit_v1.md` область purview Phase 3).

## Admin UX gaps (Этап E)

Сегодня в `CreatePublicLinkDialog` отсутствуют:
- селектор `provider` (bePaid / Stripe);
- селектор `account_code` (Stripe accounts);
- индикатор `test_mode`/`live_mode` ссылки;
- индикатор `business_stream` / `profile_code`.

Список зафиксирован; реализация — отдельная фаза (UX-спринт), не часть Phase 4.

## Что НЕ затронуто (исполнение жёстких границ)

- `bepaid-webhook`, `subscription-charge`, `direct-charge`, `payment-methods-webhook`, `grant-access-for-order`, `subscriptions-reconcile`, telegram-access lifecycle — изменений нет (read-only audit).
- Миграций нет.
- Новых providers / write-paths нет.
- Phase 3.5-B Runtime остаётся `PENDING-BY-STRIPE-TIME`.

## Stripe Public Links Readiness

| Узел | Статус |
|---|---|
| Checkout Links (public) | NOT READY (нет writer-параметра) |
| Subscription Links (public) | NOT READY (нет writer-параметра и downstream-ветки) |
| Portal | READY (для direct Stripe subs) |
| Routing | NOT READY (точка выбора отсутствует) |
| Orders | NOT READY (зависит от writer) |
| Subscriptions | NOT READY (зависит от writer) |
| Access | READY (downstream `grant-access-for-order` универсален) |
| CRM | READY (универсальный путь) |
| bePaid Isolation | READY |

### **NOT READY FOR LIVE** для канала «Public Payment Links via Stripe».
### READY FOR LIVE для канала «Stripe direct admin checkout» (исторически подтверждено).

## Минимальный PATCH для следующей фазы (Phase 4.1 Implementation)

Объём строго ограничен (additive, без изменения bePaid-веток):

1. **`admin-create-public-link/index.ts`**
   - Принять `provider?: 'bepaid'|'stripe'` (default = `'bepaid'`, обратно совместимо).
   - Принять `account_code?: string` (для Stripe — обязателен; валидировать через `acquiring_connections WHERE status='active'`).
   - При `provider='stripe'` блокировать `installment_offer=true` (Stripe finite-sub пока вне scope).
   - Писать `provider/account_code` в `payment_links`.
   - Аудит `payment_link.created` обогатить полями `provider`, `account_code`, `account_test_mode`.

2. **`public-checkout/index.ts` + `_shared/create-payment-checkout.ts`**
   - Добавить ветку `if (link.provider === 'stripe')` → делегировать в существующие `stripe-create-checkout` (one-time) / `stripe-create-subscription-checkout` (subscription) с пробросом `account_code`, `payment_link_id`, `user_id`.
   - Stripe-ветка не должна трогать bePaid helper'ы (defence in depth).
   - Webhook путь не меняется: уже работающий `stripe-webhook` материализует `orders_v2 + subscriptions_v2` и зовёт `grant-access-for-order` (canonical).

3. **UI `CreatePublicLinkDialog`**
   - Селектор «Провайдер» (bePaid по умолчанию).
   - При выборе Stripe — селектор активного `account_code` + бейдж `Test/Live`.
   - Запрет installment при Stripe (тултип).

4. **Tests (runtime, после правок):**
   - G51: создать Stripe one-time link → POST `/public-checkout` → проверить `redirect_url` начинается с `checkout.stripe.com`.
   - G52: то же для recurring tariff → `mode=subscription`, pre-created `subscriptions_v2 pending`.
   - G55/G56: после успешной test-оплаты `checkout.session.completed` через `stripe-webhook` → `orders_v2 paid` + `subscriptions_v2 active` + `entitlements`.
   - Cross-provider counters до/после: bePaid totals не меняются.

Никаких миграций не требуется — все нужные колонки (`provider`, `account_code`, `profile_code`, `business_stream`) в `payment_links` уже существуют, и CHECK уже допускает `'stripe'`.

## DoD статус Phase 4

| Пункт | Статус |
|---|---|
| Полная карта Public Links построена | ✅ (`stripe_public_links_inventory_v1.md`) |
| Stripe Public Links проверены runtime | ❌ невозможно без PATCH (G51/G52 FAIL) |
| Routing подтверждён | ✅ (вывод: точки нет; задокументировано) |
| One-time + Subscription подтверждены | ❌ для public links; ✅ для direct Stripe |
| Portal подтверждён | ✅ (исторически) |
| bePaid не затронут | ✅ (denylist + counters) |
| Discovery артефакт | ✅ |
| Proof артефакт | ✅ (этот файл) |
| Однозначный итог | ✅ **FAIL** с единственной точкой отказа |
