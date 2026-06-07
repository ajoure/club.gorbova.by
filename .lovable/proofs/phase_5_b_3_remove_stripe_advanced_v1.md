# PATCH 5-B.3 — Remove Stripe advanced + bePaid connection selector via integration_instances

**Status:** ✅ **PASS** (UI-only).

## 1. Что убрано из UI кнопки оплаты

- ❌ Блок «Дополнительные настройки Stripe» (Collapsible) — удалён.
- ❌ Поле «Код тарифа Stripe» (Input) — удалено.
- ❌ Кнопка «Проверить» (`admin-stripe-price-lookup`) — удалена из этого UI (edge function остаётся для будущего отдельного раздела).
- ❌ Read-only грид Currency / Mode / Product ID — удалён.
- ❌ Импорты `Collapsible`, `Input`, `Button`, `Loader2`, `CheckCircle2`, `ChevronDown`, `ChevronRight` — удалены.

## 2. Что осталось (бизнес-настройки)

```
☑ Принимать белорусские карты (bePaid)
   Подключение: [Select из integration_instances WHERE provider='bepaid' AND status IN (active,connected)] [Бейдж test/live]

☑ Принимать иностранные карты (Stripe)
   Подключение: [Select из acquiring_connections WHERE provider='stripe' AND status='active'] [Бейдж test/live]
   ⚠ (только для subscription без price_id) — мягкое предупреждение «обратитесь к интегратору»
```

## 3. Исправление «Нет активного подключения bePaid»

**Причина бага:** компонент читал bePaid из `acquiring_connections`, но bePaid в проекте живёт в `integration_instances` (provider='bepaid', status='connected', shop_id=33524). В `acquiring_connections` строка bePaid отсутствовала → UI показывал «нет подключения».

**Фикс:** для bePaid источник изменён на `integration_instances`. Из `config` синтезируется ConnectionRow:
- `account_code = "bepaid_" + shop_id` (или `bepaid_main`)
- `account_name = config.account_name` либо `"bePaid — Shop ID {shop_id}"`
- `test_mode = config.test_mode === true`
- `is_default = true` (единственное активное подключение)

Stripe SOT не меняется (`acquiring_connections`). Runtime bePaid также не меняется — `_shared/bepaid-credentials.ts` уже читает из `integration_instances`.

## 4. price_id поведение

- Существующий `meta.acquiring.stripe.price_id` **не теряется** (merge через `updateStripe` сохраняет его как есть, UI его не отображает и не очищает).
- Для **разовой оплаты** Stripe price_id не требуется → никаких предупреждений.
- Для **подписки** Stripe без price_id → жёлтое предупреждение в UI + блокировка save в `validateOfferAcquiring`: «Для подписки через Stripe не настроен тариф. Обратитесь к интегратору.»

## 5. Verify

| #   | Сценарий                                                       | Результат |
|-----|----------------------------------------------------------------|-----------|
| V1  | Stripe advanced block removed                                  | ✅ PASS — `rg "Дополнительные настройки Stripe" src/` → 0; `rg "Collapsible" src/components/admin/products/OfferAcquiringSettings.tsx` → 0 |
| V2  | Price ID field hidden                                          | ✅ PASS — `rg 'placeholder="price_' src/components/admin/products/` → 0; `<Input>` отсутствует |
| V3  | bePaid connection selector работает с integration_instances    | ✅ PASS — синтетический ConnectionRow из `integration_instances` (shop_id=33524) |
| V4  | Stripe connection selector работает                            | ✅ PASS — `acquiring_connections` provider='stripe' active |
| V5  | One-time Stripe без price_id — нет предупреждения              | ✅ PASS — `subscriptionStripeNotConfigured = hasStripe && isSubscription && !price_id` |
| V6  | Subscription Stripe без price_id — мягкое предупреждение + save блокируется | ✅ PASS — UI banner + validator returns error |
| V7  | Существующий price_id в meta сохраняется                       | ✅ PASS — `updateStripe` только patch, не очищает price_id |
| V8  | Runtime files changed                                          | ✅ 0 — изменён только `OfferAcquiringSettings.tsx` |

## 6. Zero-diff freeze

```
supabase/functions/public-checkout                      → не тронут
supabase/functions/bepaid-webhook                       → не тронут
supabase/functions/stripe-webhook                       → не тронут
supabase/functions/grant-access-for-order               → не тронут
supabase/functions/subscriptions-reconcile              → не тронут
supabase/functions/_shared/bepaid-credentials.ts        → не тронут
supabase/functions/_shared/resolve-provider-choice.ts   → не тронут
supabase/functions/admin-stripe-price-lookup            → не тронут (live, для будущего раздела «Интеграции → Stripe → Тарифы»)
DB schema acquiring_connections / integration_instances / tariff_offers → не тронуты
```

## 7. Backlog

- `stripe_price_mapping_admin_ui` — отдельный технический раздел «Интеграции → Stripe → Тарифы» для маппинга tariff_offer ↔ Stripe price_id. Кнопка «Проверить» переедет туда. До тех пор price_id настраивается интегратором напрямую в БД.

## 8. DoD

- [x] Stripe advanced block removed = PASS
- [x] Price ID field hidden = PASS
- [x] bePaid connection selector = PASS (через integration_instances)
- [x] Stripe connection selector = PASS
- [x] One-time Stripe no Price warn = PASS (warning не показывается)
- [x] Subscription Stripe without price_id blocked with user-friendly warning = PASS
- [x] Runtime files changed = 0

**PATCH 5-B.3 = DONE / PASS.**
