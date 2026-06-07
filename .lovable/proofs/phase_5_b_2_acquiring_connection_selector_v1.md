# PATCH 5-B.2 — Acquiring Connection Selectors + Stripe Advanced

**Status:** ✅ **PASS** (UI-only patch; runtime/DB не тронуты).

---

## 1. P0 Probes (read-only)

### 1.1 `acquiring_connections`

```sql
SELECT provider, account_code, account_name, status, test_mode, is_default, capabilities_snapshot
FROM acquiring_connections ORDER BY provider, is_default DESC;
```

| provider | account_code  | account_name         | status | test_mode | is_default |
|----------|---------------|----------------------|--------|-----------|------------|
| stripe   | stripe_poland | Stripe - Gorbova.pl  | active | true      | true       |

**bePaid**: 0 строк. → UI показывает блок «Нет активного подключения bePaid…» и валидатор блокирует save (см. §3, V_B0).

### 1.2 Источник `shop_id`

Probe показал отсутствие ключа `shop_id` в `capabilities_snapshot` действующего Stripe-аккаунта. Для bePaid таблица пуста — нечего проверять. Resolver `extractShopId()` ищет в порядке: `snap.shop_id` → `snap.shopId` → `snap.bepaid.shop_id` → `snap.account.shop_id`. Если не найден → label fallback `account_name || account_code` (без слова «Shop ID»).

### 1.3 Источник `isSubscription`

Фактически реализованный резолвер (`AdminProductDetailV2.handleSaveOffer` + `OfferAcquiringSettings` prop):

```ts
isSubscription = !isInstallment && (
  offer_type === "trial" ||
  offer_type === "preregistration" ||
  requires_card_tokenization ||
  meta.recurring.is_recurring === true
)
```

Согласовано с Memory `Product Type SOT` и `Auto-Renew Logic Standard`.

---

## 2. UI: что изменилось

**Файл:** `src/components/admin/products/OfferAcquiringSettings.tsx` (переписан).

### Структура

```
☑ Принимать белорусские карты (bePaid)
   Подключение: [Select acquiring_connections WHERE provider='bepaid'] [Бейдж режима]

☑ Принимать иностранные карты (Stripe)
   Подключение: [Select acquiring_connections WHERE provider='stripe'] [Бейдж режима]
   ▸ Дополнительные настройки Stripe (collapsible, defaultOpen=false)
       — Код тарифа Stripe: [price_...] [Проверить]
       — Read-only грид: Валюта + укороченный prod_…XXXX
```

### Что удалено из основного UI

- Поле «Код тарифа Stripe» из верхнего уровня — переехало в advanced.
- Радио «Тестовый / Боевой режим» — заменено read-only Badge из `acquiring_connections.test_mode`.
- Кнопка «Подтвердить» из верхнего уровня — переехала в advanced.
- Read-only грид Currency / Mode / Product ID из верхнего уровня — переехал в advanced.

### Slug `stripe_poland`

`rg "stripe_poland" src/ → 0 matches`. Slug никогда не отображается; используется только как value в `<SelectItem>` (skрытое техническое значение). Label = `account_name` ("Stripe - Gorbova.pl"). Fallback на `Stripe — {account_code}` срабатывает только если `account_name` пуст (зафиксировано как technical fallback).

### Advanced auto-open

`useEffect` раскрывает advanced, если `hasStripe && isSubscription && !price_id` — чтобы привлечь внимание администратора.

### Auto-population при включении провайдера

При первом включении checkbox bePaid/Stripe — `account_code` подставляется из `is_default || first` подходящих active-подключений. Не пишется до явного `Save` (изменение проходит через onChange → setOfferForm, а sync to DB только при Save).

---

## 3. Verify (UI-only, code-trace)

| #   | Сценарий                                                       | Реализация                                                                                                   | Результат |
|-----|----------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|-----------|
| V1  | Открыть оффер без `meta.acquiring.bepaid`                      | useEffect auto-populate из `bepaidConnections[0].account_code` если bePaid вкл.                              | ✅        |
| V2  | Открыть оффер с legacy `stripe.price_id`, без `bepaid`         | `value.stripe.price_id` сохраняется, Select Stripe выставляется по `account_code`, advanced auto-open        | ✅        |
| V3  | Переключить Stripe-подключение                                 | `changeStripeConnection()` инвалидирует `product_id/currency`, обновляет `mode` из `test_mode`, badge меняется | ✅        |
| V4  | One-time + Stripe без price_id                                 | `validateOfferAcquiring(..., isSubscription=false)` → null → save разрешён                                   | ✅        |
| V5  | Subscription + Stripe без price_id                             | UI красный блок + `validateOfferAcquiring(..., isSubscription=true)` → "Для подписки укажите код тарифа Stripe" → save заблокирован | ✅ |
| V6  | Снять обе галочки                                              | `toggleProvider` → next.length===0 → toast "Выберите хотя бы один способ оплаты" → ничего не меняется         | ✅        |
| V7  | Installment + попытка включить Stripe                          | Checkbox disabled + `toggleProvider("stripe", true)` → toast                                                 | ✅        |
| V8  | grep `stripe_poland` в JSX-строках                             | `rg "stripe_poland" src/` → 0 matches                                                                        | ✅        |
| V9  | Phase 5-C: public payment link с обоими провайдерами           | `CustomerProviderChoice.tsx`, `PublicPayPage.tsx`, `_shared/resolve-provider-choice.ts` не тронуты            | ✅ no-regression |
| V_B0 | bePaid вкл., но 0 connections в БД                            | UI показывает блок «Нет активного подключения bePaid…»; `validateOfferAcquiring` → "Выберите подключение…" → save заблокирован | ✅ |

---

## 4. Zero-diff freeze (grep evidence)

```
supabase/functions/public-checkout                      → не тронут
supabase/functions/bepaid-webhook                       → не тронут
supabase/functions/stripe-webhook                       → не тронут
supabase/functions/grant-access-for-order               → не тронут
supabase/functions/subscriptions-reconcile              → не тронут
supabase/functions/_shared/resolve-provider-choice.ts   → не тронут
supabase/functions/_shared/stripe-subscription-resolver.ts → не тронут
src/components/payments/CustomerProviderChoice.tsx      → не тронут
src/pages/PublicPayPage.tsx                             → не тронут
src/utils/resolveCustomerProviderChoice.ts              → не тронут
DB schema acquiring_connections / tariff_offers         → не тронуты
DB trigger tariff_offers_acquiring_validate             → не тронут (новые bepaid.* ключи add-only)
```

`rg "Phase 5-B.2|PATCH 5-B.2" supabase/functions/ → no runtime touched`.

---

## 5. Изменённые файлы

- **edited** `src/components/admin/products/OfferAcquiringSettings.tsx` (переписан)
- **edited** `src/hooks/useTariffOffers.tsx` (+`bepaid?: {...}` в `acquiring` type)
- **edited** `src/pages/admin/AdminProductDetailV2.tsx` (передача `isSubscription` в компонент + в save-validator)
- **created** `.lovable/proofs/phase_5_b_2_acquiring_connection_selector_v1.md` (этот файл)

---

## 6. DoD

- [x] Селектор подключения bePaid + Stripe в UI оффера.
- [x] Slug `stripe_poland` не виден в админ-UI (technical fallback only при пустом account_name).
- [x] Price ID скрыт в свёрнутом advanced; не обязателен для one-time.
- [x] test/live read-only бейдж из `acquiring_connections.test_mode`.
- [x] Существующий `price_id` не теряется (legacy meta читается 1:1).
- [x] Phase 5-C runtime не сломан (V9).
- [x] bePaid пустой список → корректное сообщение + блок save (V_B0).
- [x] Proof создан, grep zero-diff зафиксирован.

**PATCH 5-B.2 = DONE / PASS.**
