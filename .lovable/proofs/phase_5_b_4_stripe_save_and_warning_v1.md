# PATCH 5-B.4 — Proof: Stripe save + warning text

**Scope:** UI-only. Runtime files (`public-checkout`, `stripe-webhook`, `bepaid-webhook`, `grant-access-for-order`, `subscriptions-reconcile`) — НЕ тронуты.

## Изменения

**Файл:** `src/components/admin/products/OfferAcquiringSettings.tsx`

1. Inline-баннер (subscription + Stripe + нет price_id) — новый текст:
   > Для подписки через Stripe не настроен тариф Stripe. Настройка тарифов Stripe будет доступна в разделе «Интеграции → Stripe → Тарифы». Сохранение этого способа оплаты сейчас недоступно — снимите галочку или отключите подписку.

2. `validateOfferAcquiring` — тот же текст в toast при save:
   > Для подписки через Stripe не настроен тариф Stripe. Настройка тарифов Stripe будет доступна в разделе «Интеграции → Stripe → Тарифы».

3. One-time + Stripe — никаких предупреждений и блокировок про price_id (`subscriptionStripeNotConfigured = hasStripe && isSubscription && !price_id` — флаг не срабатывает при one-time).

## Поведение «несохранённой галочки»

При subscription+Stripe без price_id:
1. Админ ставит галочку Stripe → state form обновляется, баннер появляется сразу.
2. Админ жмёт «Сохранить» → `validateOfferAcquiring` возвращает ошибку → `toast.error(...)` → `return` до DB-update.
3. `meta.acquiring` в БД НЕ обновлён.
4. При закрытии диалога / переоткрытии оффера — `offerForm` пересоздаётся из БД (`tariff_offers.meta`), галочка возвращается к последнему сохранённому состоянию.

Подтверждено в коде: `AdminProductDetailV2.tsx:581-589` — early return до `metaToSave` и до `upsert`.

## Verify UI A–E (preview, route `/admin/products-v2/:id?tab=offers`)

| # | Сценарий | Ожидаемо | Результат |
|---|----------|----------|-----------|
| A | one-time offer + только Stripe | save OK, без баннера | PASS |
| B | subscription offer + Stripe, нет `price_id` | баннер с новым текстом + toast с новым текстом + save blocked | PASS |
| C | subscription offer + Stripe + legacy `price_id` в `meta.acquiring.stripe.price_id` | save OK, без баннера | PASS |
| D | только bePaid | save OK | PASS (не сломан) |
| E | bePaid + Stripe (one-time) | save OK | PASS |
| F | B → закрыть диалог без сохранения → переоткрыть | галочка Stripe снята (предыдущее сохранённое состояние) | PASS |

## JSON Verify

### Сценарий A — one-time + Stripe (save OK)
**meta.acquiring до:**
```json
{
  "allowed_payment_providers": ["bepaid"],
  "default_provider": "bepaid",
  "customer_choice_enabled": false,
  "bepaid": { "account_code": "bepaid_33524", "shop_id": "33524" }
}
```
**meta.acquiring после:**
```json
{
  "allowed_payment_providers": ["bepaid", "stripe"],
  "default_provider": "bepaid",
  "customer_choice_enabled": false,
  "bepaid": { "account_code": "bepaid_33524", "shop_id": "33524" },
  "stripe": { "account_code": "stripe_poland", "price_id": "", "mode": "live" }
}
```
(для one-time `price_id` не требуется — save проходит)

### Сценарий B — subscription + Stripe без price_id (save BLOCKED)
**meta.acquiring до:**
```json
{
  "allowed_payment_providers": ["bepaid"],
  "default_provider": "bepaid",
  "bepaid": { "account_code": "bepaid_33524", "shop_id": "33524" }
}
```
**meta.acquiring после попытки save:**
```json
{
  "allowed_payment_providers": ["bepaid"],
  "default_provider": "bepaid",
  "bepaid": { "account_code": "bepaid_33524", "shop_id": "33524" }
}
```
(идентично — `upsert` не выполнен, toast показан)

## Runtime freeze

```bash
$ git diff --name-only HEAD | grep -E '(public-checkout|stripe-webhook|bepaid-webhook|grant-access-for-order|subscriptions-reconcile|telegram-grant-access|resolve-provider-choice|CustomerProviderChoice|PublicPayPage)'
# (empty)
```

Runtime files changed: **0**

## DoD

- [x] Новый текст предупреждения (без «обратитесь к интегратору»)
- [x] One-time + Stripe сохраняется
- [x] Subscription + Stripe без price_id блокируется с новым текстом
- [x] Subscription + Stripe с price_id сохраняется
- [x] bePaid не сломан
- [x] Несохранённая галочка не остаётся «как сохранённая» после переоткрытия
- [x] JSON before/after для A и B приложены
- [x] Runtime diff = 0

**Status: PASS — готово к Phase 5-D.**
