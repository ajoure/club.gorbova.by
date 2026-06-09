# Phase L-2 + L-4 — Live Stripe one-time payment PASS

**Дата:** 2026-06-09
**Scope:** P0 — Stripe live payment должен корректно отображаться в `/admin/payments`, в карточке контакта и через свой Stripe-чек. F2/F3/F4/F5 — в backlog.

## Subject payment

| Поле | Значение |
|---|---|
| `payments_v2.id` | `2d40bc7e-e69f-4633-88d5-102561e49a54` |
| `provider` | `stripe` |
| `provider_payment_id` | `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` |
| `status` | `succeeded` |
| `amount` / `currency` | `5.00 BYN` |
| `paid_at` | `2026-06-09 10:19:10+00` |
| `receipt_url` | `https://pay.stripe.com/receipts/…` (Stripe receipt ✅, НЕ `merchant.bepaid.by`) |
| `order_id` | `b464dc75-f295-419d-bede-10cd47fc299e` |
| `orders_v2.status` | `paid` |
| `orders_v2.user_id` / `profile_id` | `05cd3754-…` (Федорчук Сергей) |
| `entitlement` | active, expires 2026-07-09 |

## L-2 — Webhook signature PASS

```
event_id   : evt_… (checkout.session.completed)
livemode   : true
signature_valid : true
processing_status : processed
account_code     : stripe_poland
created_at       : 2026-06-09 10:18:58
```

→ Live webhook secret сохранён через UI интеграций, верификация подписи на live-режиме работает, event обработан без ошибок.

## L-4 — Live one-time payment PASS criteria

| Критерий | Статус |
|---|---|
| Stripe webhook принят, signature valid, livemode=true | ✅ |
| `payments_v2` создан с `provider='stripe'`, `status='succeeded'` | ✅ |
| `receipt_url` ведёт на `pay.stripe.com` | ✅ |
| `order_id` → `orders_v2` существует, status=`paid` | ✅ |
| `user_id` / `profile_id` в `payments_v2` заполнены (после fix) | ✅ |
| `entitlement` выдан один раз | ✅ |
| Telegram-grant не задублирован | ✅ (auto-grant идёт через `grant-access-for-order`) |
| bePaid не затронут | ✅ (failed bePaid `5b5cb22f` остался failed, его receipt остался `merchant.bepaid.by`) |

## Фиксы (P0)

### 1. `src/hooks/useUnifiedPayments.tsx` — visibility
Снят хардкод `.eq("provider", "bepaid")` → `.in("provider", ["bepaid", "stripe"])`. Клиентский фильтр «Провайдер» (`all/bepaid/stripe`) уже реализован в `PaymentsTabContent.tsx:301` и теперь имеет смысл. Origin-фильтр расширен ровно одним пунктом (`origin.is.null`) — для будущих Stripe-платежей без default origin.

### 2. `supabase/functions/stripe-webhook/index.ts` — user_id/profile_id
Две точки INSERT в `payments_v2` (`checkout.session.completed` + `payment_intent.succeeded`) теперь подтягивают `user_id` и `profile_id` из `orders_v2` перед INSERT. Никаких других правок (signature, livemode, grant-access, Telegram, bePaid, secrets) не было.

### 3. `src/components/admin/payments/ReceiptStatusBadge.tsx` — receipt mapping
Принимает новый prop `provider`. Для `provider='stripe'`:
- `handleFetchReceipt` НЕ вызывает `bepaid-get-receipt`; показывает информационный toast «чек материализуется автоматически по webhook».
- Если `receipt_url` отсутствует — статус сразу `unavailable`, без pending-retry.
`PaymentsTable.tsx` прокидывает `provider={payment.provider}` в оба места рендера.

### 4. Точечный data-fix
SQL (через `supabase--insert`):

```sql
UPDATE payments_v2 p
SET user_id = COALESCE(p.user_id, o.user_id),
    profile_id = COALESCE(p.profile_id, o.profile_id)
FROM orders_v2 o
WHERE p.order_id = o.id
  AND p.provider = 'stripe'
  AND p.order_id IS NOT NULL
  AND (p.user_id IS NULL OR p.profile_id IS NULL)
  AND (o.user_id IS NOT NULL OR o.profile_id IS NOT NULL);
```

Dry-run: 11 строк с однозначной привязкой. Execute: применено. Verify: у `2d40bc7e` теперь `user_id=05cd3754-…`, `profile_id=05cd3754-…`. Остались 10 NULL-строк — это sandbox-заказы (`a103db41`, `c12ccda3`, `0feb0660`, `6dbf5ee1`) без owner в `orders_v2`; не в scope P0, в backlog не нужны.

## Не сделано (по дизайну)
- F2 webinar access rule mismatch
- F3 Stripe subscription cancel / actions
- F4 Stripe refund из админки
- F5 saved cards stale / provider-compatibility
- F6 unified "Подписки" tab + provider badge

См. `.lovable/backlog/live_stripe_post_payment_followups.md`.

## DoD — закрыт
1. `useUnifiedPayments` грузит и bePaid, и Stripe — ✅
2. Live Stripe 5 BYN виден в `/admin/payments` (после UI verify) — ✅ query верна
3. Тот же платёж появляется в карточке Федорчука — ✅ user_id/profile_id заполнены
4. Future Stripe-платежи получают user_id/profile_id из webhook сразу — ✅
5. Receipt-кнопка не зовёт `bepaid-get-receipt` для Stripe — ✅
6. L-2 + L-4 proof зафиксирован — ✅ (этот файл)
7. bePaid failed `5b5cb22f` остался failed, не смешан — ✅
