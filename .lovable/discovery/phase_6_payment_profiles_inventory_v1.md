# Phase 6-A — Payment Profiles Inventory v1

Дата: 2026-06-07. Mode: read-only discovery.

## 1. Источники подключений (SOT)

### Stripe
- **Таблица:** `public.acquiring_connections`
- **Фильтр:** `provider='stripe' AND status='active'`
- **Поля:** `account_code`, `account_name`, `test_mode`, `is_default`, `capabilities_snapshot.supported_currencies`
- **Текущие записи (test+live):**

| account_code   | account_name        | status | test_mode | is_default |
|----------------|---------------------|--------|-----------|------------|
| stripe_poland  | Stripe - Gorbova.pl | active | true      | true       |

### bePaid
- **Таблица:** `public.integration_instances`
- **Фильтр:** `provider='bepaid' AND status IN ('active','connected')`
- **Display name:** `alias`
- **Shop ID / test_mode:** в `config jsonb` (`config.shop_id`, `config.test_mode`)
- **Текущие записи:**

| id (short) | alias                | status    | shop_id | test_mode | is_default |
|------------|----------------------|-----------|---------|-----------|------------|
| 884e30cb…  | bePaid  - ажур инкам | connected | 33524   | false     | true       |

> `acquiring_connections` для bePaid **не используется** — все bePaid-подключения только в `integration_instances`.

## 2. UI call-sites (которые трогаем)

| Файл | Что читает |
|---|---|
| `src/components/admin/products/OfferAcquiringSettings.tsx` | bePaid (integration_instances) + Stripe (acquiring_connections) — отдельные запросы, разная нормализация |
| `src/components/admin/AdminPaymentLinkDialog.tsx` | Только Stripe (acquiring_connections, `useQuery` ключ `acquiring-connections-stripe-active`); bePaid не выбирается, провайдер выбирается через `providerModeChoice`. Показывает технический бейдж `super_admin` рядом с карточкой |

## 3. UI call-sites (не трогаем в Phase 6)

| Файл | Причина |
|---|---|
| `src/components/payment/PaymentDialog.tsx` (customer) | Customer flow Phase 5-C — отдельная логика, runtime |
| `src/hooks/useBepaidData.tsx`, `useBepaidMappings.tsx`, `useBepaidFeeRules.ts` | bePaid-only админ-страницы (reconcile/mappings) |
| `src/components/integrations/*` | Страница интеграций — отдельная карточная сетка, не «выбор подключения для оффера» |

## 4. UI-места со slug'ами (требуют нормализации)

| Файл | Slug | Где видно |
|---|---|---|
| `AdminPaymentLinkDialog.tsx` line 1171-1177 | `account_code`, `test`, `default` суффиксы | Select «Stripe-подключение» |
| `AdminPaymentLinkDialog.tsx` line 1136 | `super_admin` (uppercase бейдж) | Карточка способа оплаты при bypass |
| `OfferAcquiringSettings.tsx` fallback (line 117-119) | `bepaid_${shopId}`, `bepaid_main` | Внутренний `account_code`, в UI не показывается напрямую, но без display name селект пуст |

## 5. Runtime files — FREEZE (не редактируются в Phase 6)

- `supabase/functions/bepaid-webhook/**`
- `supabase/functions/stripe-webhook/**`
- `supabase/functions/public-checkout/**`
- `supabase/functions/_shared/create-payment-checkout.ts`
- `supabase/functions/grant-access-for-order/**`
- `supabase/functions/subscriptions-reconcile/**`
- `supabase/functions/telegram-grant-access/**`
- `supabase/functions/admin-create-public-link/index.ts`
- `supabase/functions/_shared/acquiring/*`
- `supabase/functions/_shared/bepaid-credentials.ts`

## 6. Решение по migration

**Не нужна.** bePaid безопасно представлять через read-layer без миграции — `integration_instances` уже содержит все необходимые поля (`alias`, `config.shop_id`, `config.test_mode`, `is_default`, `status`). Stripe уже в правильной таблице.

→ Phase 6 идёт полным составом (B → C → D → E → F).

## 7. Контракт unified read-model

```ts
type AcquiringProfile = {
  provider: 'bepaid' | 'stripe';
  account_code: string;       // stable internal id
  display_name: string;       // human-readable, для UI
  technical_label?: string;   // fallback, если display_name пустой
  shop_id?: string;           // bePaid only
  test_mode: boolean;
  status: 'active' | 'inactive';
  supported_currencies?: string[]; // Stripe only
  is_default: boolean;
};
```

### Маппинг
- **Stripe:** `account_code` ← `acquiring_connections.account_code`; `display_name` ← `account_name` (fallback `Stripe — ${account_code}`); `supported_currencies` ← `capabilities_snapshot.supported_currencies`.
- **bePaid:** `account_code` ← `bepaid_${shop_id}` или `bepaid_${id}`; `display_name` ← `alias` (fallback `bePaid — Shop ID ${shop_id}`); `shop_id` ← `config.shop_id`; `test_mode` ← `config.test_mode`.

## DoD Phase 6-A — PASS
- ✅ Stripe источник зафиксирован
- ✅ bePaid источник зафиксирован
- ✅ UI call-sites перечислены (touch / no-touch)
- ✅ UI-места со slug'ами обозначены
- ✅ Runtime freeze-лист зафиксирован
- ✅ Решение по migration: не требуется
- ✅ Контракт unified read-model зафиксирован

---

## Phase 6-G discovery (2026-06-07)

### Источники warning «Интеграции → Stripe → Тарифы»
- `src/components/admin/products/OfferAcquiringSettings.tsx` — UI-блок (`subscriptionStripeNotConfigured`) + ветка в `validateOfferAcquiring`, блокировавшая save при `isSubscription && !acq.stripe.price_id`.
- `src/components/admin/AdminPaymentLinkDialog.tsx` — guard `stripeSubscriptionPriceMissing` (зеркало offer-валидатора), блокировал submit.

### Stripe subscription helpers (уже существуют)
- `admin-provision-stripe-price` (super_admin JWT, verify_jwt=true): идемпотентно создаёт Stripe Product+Price по SOT `tariff_prices` + `meta.recurring` (resolver `month/1` или `year/1`); пишет `tariff_offers.meta.stripe.{price_id, product_id, ...}` (schema_version=1). Контракт: `{ tariff_offer_id, account_code, business_stream, execute }`.
- `admin-stripe-price-lookup` — поиск существующего price по metadata.
- `_shared/create-stripe-checkout.ts` (используется public-checkout) — для `payment_type='subscription'` читает `tariff_offers.meta.stripe.price_id`; при отсутствии возвращает 422 `stripe_price_missing_in_offer_meta` (line 407–410). Это **реальный runtime-блокер**, а не ложный warning.
- `stripe-create-subscription-checkout` — admin-only sandbox writer (super_admin JWT), не используется в публичном checkout.

### `business_stream` для provisioning
SOT: `_shared/acquiring/business-stream-resolver.ts` — приоритет `offer.meta.business_stream` → `product.meta.business_stream` → explicit override.

### Решение: Вариант A (предпочтительно) или Вариант B
- **Вариант A (UI-driven save-time provision):** save-handler `AdminProductDetailV2.handleSaveOffer` после успешного `updateOffer/createOffer` дёргает `admin-provision-stripe-price` под текущим super_admin JWT (если subscription+stripe+account_code+business_stream). Никаких runtime-изменений в edge-functions. **Минимальный риск.**
- **Вариант B (lazy в checkout):** требует рефакторинга `admin-provision-stripe-price` в shared helper, вызываемого service-role'ом из `create-stripe-checkout.ts`. Больший runtime-diff.

### Baseline (snapshot 2026-06-07)
- Активных subscription-офферов с `hasStripe=true` и пустым `meta.stripe.price_id`: на момент discovery не замерялось отдельно (не блокирующее — provision будет вызываться лениво при следующем save оффера или в рамках 6-G.2).

### Phase 6-G.1 (применено в этом коммите)
- Удалён warning-блок и ветка `price_id` из `validateOfferAcquiring`.
- Под Stripe-блоком — нейтральный info: «Stripe-подписка использует выбранное подключение. Тариф Stripe будет создан и привязан автоматически — при сохранении кнопки или при первой оплате».
- Удалён `stripeSubscriptionPriceMissing` из AdminPaymentLinkDialog — submit не блокируется.
- Динамический hint «По настройке кнопки» на основе `offerAllowedProviders` (bePaid+Stripe → «Клиент сможет выбрать…», моно-provider → конкретная карта).
- G116 PASS: `rg "Интеграции.*Stripe.*Тарифы|снимите галочку|отключите подписку"` → 0 совпадений.

### Phase 6-G.2 (следующий коммит, после approve)
- Вариант A: в `handleSaveOffer` после успешного save оффера, при условии `subscription + stripe + account_code + business_stream`, вызвать `supabase.functions.invoke('admin-provision-stripe-price', { body: { tariff_offer_id, account_code, business_stream, execute: true } })`. Результат показать toast'ом (success / warning); сохранение оффера не откатывается при failure provisioning.
- Runtime-freeze edge-functions сохранён (никаких diff в checkout/webhook/grant-access).
