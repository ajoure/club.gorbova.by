План:

## 1. Рекуррентный платёж по кнопке «Рассрочка (внутренняя, 2 платежа)»

### Diagnose
`public-create-installment-link/index.ts:176` создаёт `payment_links` с `payment_type: 'one_time'`. При переходе гостя на `/pay/:token` вызывается `public-checkout/index.ts:343`, который проксирует `link.payment_type` в `createPaymentCheckout`. Из-за `'one_time'` shared-helper входит в ветку разового платежа и НЕ создаёт `subscriptions_v2` / `provider_subscriptions` / bePaid finite subscription.

Меж тем `meta.installment.as_finite_subscription=true` и `billing_cycles` уже пробрасываются (`public-checkout/index.ts:319-333`), и вся finite-подписочная логика в `_shared/create-payment-checkout.ts:860-1115` полностью готова (флаг `isInstallmentSubscription` активируется по `meta_extra.installment_count`). Не срабатывает только точка входа.

### Fix
- `supabase/functions/public-create-installment-link/index.ts`: заменить `payment_type: 'one_time'` → `payment_type: 'subscription'`. Ссылка становится finite-subscription-ссылкой; `billing_cycles = installment_count`, `interval_days` берутся из оффера.
- Проверить, что `payment_links.payment_type` допускает `subscription` (уже используется для обычных подписок).
- Никаких изменений в `public-checkout` и `_shared/create-payment-checkout.ts` не требуется — subscription-ветка уже распознаёт installment по `installment_count >= 2` и ставит `model: 'bepaid_finite_subscription'`.
- Все существующие «сломанные» installment-`payment_links` со старым `payment_type='one_time'`: одноразовый data-fix — пересоздать НЕ обязательно (это ссылки на 24ч, устареют сами), но пометить в audit `payment_link.installment_legacy_one_time_marked`.

### Verify
1. `tsgo` — типы.
2. Deploy `public-create-installment-link` и (для чистоты `_shared` bundle) `public-checkout`.
3. Тест из UI: «Оплата в 2 платежа» → `/pay/:token` → bePaid checkout → confirm test card → в БД:
   - `orders_v2.meta.installment_count = 2`, `model = bepaid_finite_subscription`;
   - `subscriptions_v2` создана, `meta.billing_cycles = 2`, `interval_days = 30`;
   - `provider_subscriptions` создана;
   - при webhook — материализуются `installment_payments` на 2 платежа.
4. bePaid Dashboard: подписка с `number_of_cycles = 2`, `interval = 30`.

---

## 2. RETURN-фиксы CRM routing (add-only)

### 2A. Пробросить `primary_reason` в snapshot и audit

`supabase/functions/_shared/crm-routing.ts`:

- `ResolvedRouting`: добавить опциональное поле `primary_reason?: string`.
- `NegativeRoutingSnapshot`: добавить `primary_reason?: string | null`.
- `buildNegativeSnapshot(args)`: принять `primary_reason?: string | null` и записать в возвращаемый объект.
- `auditNegativeSnapshot(args)`: принять `primary_reason` и добавить в audit meta.
- `resolveOrderRouting`:
  - при переходе к product-binding fallback запомнить `primaryReason = primary.reason`;
  - если fallback вернул positive snapshot — вложить `primary_reason` в `snapshot.primary_reason` и в `resolved.primary_reason`;
  - если fallback тоже не помог — вернуть `{ ...primary, primary_reason: primaryReason }`.
- Все вызывающие места (`create-payment-checkout.ts`, `create-stripe-checkout.ts`, `public-rr-installment-initiate/index.ts`, `bepaid-create-token/index.ts`, `stripe-create-checkout/index.ts`, `public-charge-saved-card/index.ts`) при формировании negative snapshot и `auditNegativeSnapshot` — прокидывают `primary_reason: routing.primary_reason ?? null`.
- Positive snapshot тоже пишет `primary_reason`, если он был.

Строго add-only: старые поля остаются, миграции БД не нужны (это JSONB `meta.crm_routing_snapshot`).

### 2B. Долить unified resolver в оставшиеся edge-функции

Переключить прямые вызовы `resolveOfferRoutingWithFallback` на `resolveOrderRouting`:

1. `supabase/functions/bepaid-create-token/index.ts`:
   - импорт: заменить `resolveOfferRoutingWithFallback` → `resolveOrderRouting`.
   - строки ~485 (no-card trial) и ~889 (admin-test): передавать `{ offer_id, tariff_id, product_id }` (product_id вытянуть из tariff/order — уже доступно в контексте, иначе `null`).
2. `supabase/functions/stripe-create-checkout/index.ts:174`: то же — `resolveOrderRouting({ offer_id, tariff_id, product_id })`.
3. `supabase/functions/public-charge-saved-card/index.ts:262`: то же (MIT-рекуррент от сохранённой карты — тот же контракт).
4. При формировании `crmRoutingContext` для этих функций — пробросить `primary_reason` (см. 2A).

Deploy:
- `bepaid-create-token`
- `stripe-create-checkout`
- `public-charge-saved-card`
- `create-payment-checkout` / `create-stripe-checkout` вшиты в bundle вызывающих функций, поэтому также передеплоить: `public-checkout`, `admin-create-public-link`, `payment-dialog-create-bridge-link`, `public-create-installment-link` (после 1-го патча), `subscription-renewal-reminders`, `subscription-charge`.

### Verify
- `tsgo` — зелёный.
- Unit-cases в `crm-routing.test.ts`: добавить проверку, что `primary_reason` присутствует в positive-fallback и negative snapshot.
- Живой RR-прогон не нужен (per user).
- Smoke: `bepaid-create-token` no-card trial — negative snapshot содержит `primary_reason`.

### DoD

```text
INSTALLMENT SUBSCRIPTION      : PASS (live 2-payment order)
INVALID EXPLICIT CONFIG GUARD : PASS
FALLBACK SNAPSHOT OFFER_ID    : PASS
NEGATIVE OBSERVABILITY        : PASS (primary_reason recorded)
BEPAYD SHARED ROLLOUT         : PASS (resolveOrderRouting + deploy)
STRIPE SHARED ROLLOUT         : PASS
CHARGE-SAVED-CARD ROLLOUT     : PASS
DIRECT-CHARGE                 : N/A
SPRINT STATUS                 : GREEN
```
