да, согласен, с учетом правок:

1. **Не выполнять полноценный рефактор** `stripe-create-subscription-checkout` **до runtime bePaid/Stripe smoke**

Вынос shared helper допустим, но это риск для уже работающего admin subscription checkout.

Порядок:

```text
1. Сначала добавить Stripe-ветку в public-link path.
2. Потом минимально вынести helper.
3. После этого обязательно проверить admin `stripe-create-subscription-checkout` smoke.
```

Не считать refactor безопасным без отдельного proof.

2. **One-time amount / minor units проверить отдельно**

Фраза:

```text
не BYN ⇒ умножение на 100 не используется
```

опасная.

Stripe почти всегда принимает amount в minor units. Нужно не угадывать.

Требую отдельный helper:

```text
toStripeMinorUnits(amount, currency)
```

с поддержкой:

- BYN
- EUR
- PLN
- USD
- RUB, если используется

И proof, что сумма 5 EUR превращается в 500, 100 BYN — в 10000 и т.д.

3. **Fallback при Stripe ошибке запрещён**

Если Stripe public checkout не создался:

```text
FAIL controlled error
```

Никакого bePaid fallback.

4. **Старый bePaid путь должен быть byte-for-byte safe**

В proof обязательно:

- existing bePaid public link до/после;
- новая bePaid public link без `provider`;
- `payment_links.provider='bepaid'`;
- redirect остаётся bePaid.

5. **Stripe subscription public link не должен создавать order, если существующий admin flow этого не делает**

Ты написал:

```text
Pre-create orders_v2 pending provider='stripe'
```

Но для subscription Stripe у нас ранее Stage 1 специально проверял:

```text
orders_v2/payments_v2/entitlements/access_rules = 0 до invoice.paid
```

Нельзя нарушать это правило.

Для subscription public link:

- можно pre-create `subscriptions_v2 pending`;
- можно pre-create `provider_subscriptions pending`;
- **orders_v2 до invoice.paid не создавать**.

`orders_v2` должен создаваться только по `invoice.paid`, как в Phase 3.1/3.2.

6. **payment_link_id для subscription**

Если order создаётся только на `invoice.paid`, то `payment_link_id` должен идти в Stripe metadata и потом попадать в order через webhook.

Если webhook сейчас это не делает — фиксировать как backlog, но не создавать pending order заранее ради linkage.

7. **UI: Stripe subscription link early validation**

Если `tariff_offers.meta.stripe.price_id` отсутствует:

- backend 400;
- UI показывает понятную ошибку;
- не создавать ссылку, которая потом не сможет оплатиться.

8. **Runtime proof обязательный минимум**

До PASS 4.1:

```text
- bePaid existing link PASS
- bePaid new link PASS
- Stripe one-time link creates checkout URL PASS
- Stripe subscription link creates checkout URL + pending sub PASS
- admin stripe subscription checkout still works PASS
```

Оплата Stripe public link может быть отдельным runtime gate, но создание ссылок и checkout URL должны быть PASS.

После этих правок можно выполнять.

&nbsp;

План:

# Phase 4.1 — Provider-aware Public Payment Links (Stripe), Variant A

Цель: публичная ссылка `/pay/:token` должна уметь создавать Stripe Checkout (one-time + subscription), повторяя архитектуру bePaid public link. `requireSuperAdmin`-функции (`stripe-create-checkout`, `stripe-create-subscription-checkout`) НЕ открываем наружу. Webhook, `grant-access-for-order`, bePaid-ветка — не трогаем.

## Diagnose (выполнено)

- `payment_links` уже имеет колонки `provider`, `provider_mode`, `account_code`, `profile_code`, `business_stream`, `currency` (миграция не нужна).
- Все 113 строк имеют `provider='bepaid'` (бэкфилл).
- `admin-create-public-link` не пишет `provider/account_code/currency` (всё по умолчанию).
- `public-checkout` передаёт всё в `_shared/create-payment-checkout.ts` без `provider`.
- `_shared/create-payment-checkout.ts` — bePaid-only.
- `stripe-create-subscription-checkout` содержит готовый блок pre-create (`subscriptions_v2 pending` + `provider_subscriptions pending:{uuid}` + Stripe Checkout `mode=subscription`) — выносим в shared helper без изменения поведения admin-функции.
- `_shared/acquiring/stripe-adapter.ts.createCheckout` уже умеет one-time Stripe Checkout с `payment_link_id` в `metadata`.
- `stripe-webhook` уже читает `Session.metadata` (включая `subscription_v2_id`, `provider_subscription_row_id`, `payment_link_id`) — не трогаем.

## Изменения файлов

### Backend

1. **NEW `supabase/functions/_shared/stripe-pre-create-subscription.ts**`
  - Экспортирует `stripePreCreateSubscription({ supabase, user_id, product_id, tariff_id, tariff_offer_id, account_code, business_stream, customer_email, payment_link_id?, order_id?, lifecycle_created_by })`.
  - Выполняет шаги 8–11 из `stripe-create-subscription-checkout` (sub insert → prov_sub insert → Stripe `checkout/sessions` `mode=subscription` → meta update). Без auth, без duplicate-guards (вызывающий уже их сделал).
  - Возвращает `{ ok, subscription_v2_id, provider_subscription_row_id, checkout_session_id, url }` или `{ ok:false, error, rollback_done }`.
  - При неудаче делает rollback pending-строк (как сейчас).
  - Если передан `payment_link_id` — кладёт его в `metadata[payment_link_id]` и `subscription_data[metadata][payment_link_id]`.
2. **REFAC `supabase/functions/stripe-create-subscription-checkout/index.ts**`
  - Шаги 8–11 заменить на вызов `stripePreCreateSubscription` (поведение, audit, ответ — идентичны). Контракт ответа не меняется.
3. **EDIT `supabase/functions/_shared/create-payment-checkout.ts**`
  - Расширить `CreateCheckoutParams`: `provider?: 'bepaid'|'stripe'` (default 'bepaid'), `account_code?: string`, `currency?: string`.
  - В начале: если `provider==='stripe'` → новая ветка:
    - **one_time:**
      - валидация: `currency` обязателен, не BYN ⇒ умножение на 100 не используется (Stripe minor units передаётся как есть = `amount`).
      - INSERT `orders_v2 pending provider='stripe'` (currency = link.currency; `base_price/final_price` хранить в той же валюте; meta — `payment_link_id`, `payment_flow`, `account_code`, `business_stream`).
      - `resolveDefaultStripeAccount(supabase, account_code)` + test_mode guard (как в admin).
      - `crm-routing` snapshot (как в bePaid one_time).
      - `resolveAdapter('stripe').createCheckout({ … metadata: { payment_link_id, product_id, tariff_id, offer_id, user_id }, context: { provider:'stripe', account_code, business_stream }, return_url, cancel_url })`.
      - При ok → UPDATE order meta `{ stripe: { checkout_session_id, account_code }, business_stream }`; return `redirect_url`.
      - При fail → order → `failed`, audit `stripe.checkout.declined`.
    - **subscription:**
      - Проверки: `offer_id` обязателен; читаем `tariff_offers` и проверяем `meta.stripe.price_id` (иначе `stripe_price_missing_in_offer_meta` → fallback error).
      - Те же duplicate guards, что уже есть в bePaid-ветке (`checkPendingCheckoutConflict`, `classifySameProductState`/`checkSubscriptionConflict`) — переиспользуем `_shared/subscription-conflict.ts` (provider-aware).
      - Pre-create `orders_v2 pending provider='stripe'` (как маркер заказа подписки; meta `payment_flow=admin_subscription/renewal_subscription`, `payment_link_id`).
      - Вызвать `stripePreCreateSubscription` с `payment_link_id=link.id`, `order_id=order.id` (пробросим в metadata, не более).
      - При ok → UPDATE order meta `{ stripe: { checkout_session_id, subscription_v2_id, provider_subscription_row_id, account_code }, business_stream }`; return `redirect_url`.
      - При fail → rollback order → `failed`, helper делает rollback своих pending-строк.
  - bePaid-ветка не трогается.
4. **EDIT `supabase/functions/admin-create-public-link/index.ts**`
  - Принимать `provider?: 'bepaid'|'stripe'` (default `bepaid`), `account_code?: string`, override `currency` (default `BYN` для bepaid).
  - Если `provider==='stripe'`:
    - блок installment → 400 `installment_not_supported_on_stripe`.
    - проверить `acquiring_connections` (provider='stripe', account_code, status='active'); test_mode → ok.
    - валидация `currency` ∈ supported (минимум `usd`,`eur`,`pln`,`byn`); по умолчанию использовать `acquiring_connections.default_currency` если есть, иначе требовать body.
    - проверить `tariff_offers.meta.stripe.price_id` если payment_type='subscription' (early-fail).
  - Записывать `provider`, `account_code`, `currency` в `payment_links`.
  - В audit добавить эти поля.
5. **EDIT `supabase/functions/public-checkout/index.ts**`
  - Передавать в `createPaymentCheckout`: `provider: link.provider ?? 'bepaid'`, `account_code: link.account_code ?? undefined`, `currency: link.currency ?? 'BYN'`.
  - GET-ответ: вернуть `provider` (UI-индикатор).

### Frontend

6. **EDIT `src/components/admin/AdminPaymentLinkDialog.tsx**`
  - Новый блок «Эквайер» (виден только при создании ссылки): селект `bePaid (BYN)` / `Stripe (карта)`.
  - При выборе Stripe:
    - селект `Stripe-подключение` — список `acquiring_connections WHERE provider='stripe' AND status='active'` (account_code → label).
    - селект валюты (USD/EUR/PLN/BYN), default из подключения.
    - installment-блок скрыт (с тултипом «Рассрочка доступна только для bePaid»).
    - предупреждение «Stripe требует у оффера `meta.stripe.price_id` для подписки».
  - Поля `provider`, `account_code`, `currency` уходят в body `admin-create-public-link`.
7. **EDIT `src/components/admin/payments/links/LinksTabContent.tsx**` (и `LinkDetailsDrawer`)
  - Колонка «Провайдер» с бейджем `bePaid` / `Stripe (account_code)`.
  - Фильтр по провайдеру (опционально, если уже есть фильтр-механика — добавить пункт; иначе пропустить).

## Dry run / гипотезы

- bePaid public links: тело запроса не меняется → `provider` по-прежнему default → существующие 113 ссылок и новые без `provider` идут в bepaid-ветку без regress.
- Stripe one-time: `Session.metadata.payment_link_id` уже включается через `buildStripeMetadata` → webhook найдёт link и сможет инкрементировать `current_uses` через `_shared/consume-payment-link.ts` (если уже подключено в stripe-webhook — проверю в Verify; если нет — это известный gap, фиксируется отдельным патчем, не блокирует приём оплаты).
- Stripe subscription: client_reference_id = subscription_v2_id; webhook lifecycle Stripe идентичен admin-flow.

## Verify (после Execute)

- `bun run build` (lovable harness).
- Edge logs: `admin-create-public-link` создаёт row с `provider`/`account_code`/`currency`.
- Smoke (через `supabase--curl_edge_functions`):
  - GET `/public-checkout?token=<existing bePaid token>` → `provider:'bepaid'`.
  - POST `/public-checkout` для bePaid link → `redirect_url` checkout.bepaid.by (non-regression).
  - Создать новый Stripe one-time link → POST `/public-checkout` → `redirect_url` checkout.stripe.com.
  - Создать новый Stripe subscription link (на оффере с `meta.stripe.price_id`) → POST → Stripe subscription URL; subscriptions_v2 + provider_subscriptions pending созданы.
- Proof: `.lovable/proofs/stripe_phase_4_1_provider_routing_v1.md` (счётчики до/после, payloads, edge function logs).

## Не в скоупе

- `stripe-webhook` — не трогаем (использует существующую metadata).
- `grant-access-for-order` — не трогаем.
- Новые публичные Stripe endpoint'ы — не создаём.
- BYOK Stripe / новые providers.
- Миграции БД (все колонки уже есть).

## Риски

- R1: Если `stripe-webhook` сейчас не использует `payment_link_id` для increment `current_uses` — счётчик не вырастет после оплаты Stripe link. Mitigation: вынесено как known-gap, фиксируем отдельным микропатчем после Verify.
- R2: Stripe one-time через `orders_v2 provider='stripe' status='pending'` — отличается от admin-флоу `stripe-create-checkout` (там order создаётся отдельно). У нас order создаётся внутри shared helper из payment_link → структурно ок, но нужно убедиться, что webhook ищет order по `client_reference_id`/`metadata.order_id` (он это делает).
- R3: Если у `tariff_offers.meta.stripe.price_id` нет — Stripe subscription link невозможен; админ получит 400 при создании ссылки, не при оплате.

## DoD

- bePaid public link (существующая) работает без изменений (proof curl).
- bePaid public link (новая, без provider в body) создаётся и оплачивается.
- Stripe one-time public link создаётся (writer) и возвращает checkout.stripe.com URL.
- Stripe subscription public link создаётся, возвращает Stripe subscription URL, pending sub+prov_sub видны в БД.
- `admin-create-public-link` пишет `provider/account_code/currency` в `payment_links`.
- UI селектор провайдера присутствует, installment+Stripe заблокирован.
- `stripe-create-subscription-checkout` (admin) — поведение не изменилось (вызывает тот же shared helper).
- Proof файл создан, plan.md обновлён.
---

## Phase 4.1 — статус по итогам исполнения (CODE PASS, RUNTIME PENDING)

- Backend (writer/dispatcher/Stripe-ветка/helper'ы) реализованы.
- UI селектор «Эквайер» добавлен в AdminPaymentLinkDialog с гардами.
- `stripe-create-subscription-checkout` (admin) НЕ рефакторился — отложено до runtime smoke.
- bePaid path не изменён ни на байт.
- Type-check фронта — OK.
- Proof: `.lovable/proofs/stripe_phase_4_1_provider_routing_v1.md`.

Runtime gates G4.1-A..E — PENDING-BY-STRIPE-TIME / RUNTIME.
