# Stripe Integration v1.1 — Phase 2 Admin Sandbox Checkout (PATCH)

Дата: 2026-06-03
Скоуп: только `/admin/integrations/payments` → Stripe row → тестовый запуск.

## Что добавлено

### Edge function (add-only)
- `supabase/functions/stripe-admin-sandbox-checkout/index.ts`
  - super_admin guard
  - resolves `acquiring_connections` by `account_code` (default `stripe_poland`); requires `status='active'` AND `test_mode=true`
  - если live → `{ ok:false, code:'sandbox_checkout_requires_test_keys' }`, HTTP 200
  - валидирует product_id / tariff_id / offer_id (cross-reference + active)
  - amount читает из `tariff_offers.amount`, currency — из whitelist `USD/EUR/PLN/GBP`
  - создаёт `orders_v2` (`provider='stripe'`, `status='pending'`, `meta.sandbox=true`,
    `meta.sandbox_source='admin_stripe_sandbox_checkout'`, `meta.created_by_user_id`)
  - вызывает `stripeAdapter.createCheckout` (тот же путь, что `stripe-create-checkout`)
  - возвращает `{ ok, url, session_id, order_id, order_number, amount, currency }`

### UI (add-only)
- `src/components/admin/integrations/StripeSandboxCheckoutDialog.tsx`
  - селекторы Продукт → Тариф → Кнопка оплаты (offer)
  - выбор валюты, опциональный email
  - открывает Stripe Checkout в новой вкладке
- `src/components/admin/integrations/PaymentsIntegrationsPanel.tsx`
  - в Stripe row кнопка «Тестовая оплата Stripe» (FlaskConical)
  - кнопка видна **только** если `status='active'` AND `test_mode=true`
  - при live: inline-подсказка «Sandbox-оплата недоступна (live keys)»

## Freeze zones (verified)
- `supabase/functions/bepaid-*` — не тронуты
- `supabase/functions/_shared/create-payment-checkout.ts` — не тронут
- `supabase/functions/stripe-create-checkout/index.ts` — не тронут
- `payment_links` — никаких записей с `provider='stripe'`
- обычный flow «Ссылка на оплату» из карточки контакта — не тронут
- `CreatePublicLinkDialog` — не тронут

```
rg -l "stripe" supabase/functions/bepaid-* supabase/functions/_shared/create-payment-checkout.ts 2>&1 | grep -v "No such" || echo "clean"
```

## DoD checklist

| # | Пункт | Статус |
|---|---|---|
| 1 | Из Stripe row можно открыть admin-only modal | ✅ UI ready |
| 2 | Кнопка доступна только при active + test_mode + provider=stripe + account_code | ✅ guard на UI и в edge |
| 3 | При live ключах показывается сообщение | ✅ inline notice + edge возвращает `sandbox_checkout_requires_test_keys` |
| 4 | Создаётся sandbox order_v2 (provider='stripe', meta.sandbox=true) | ✅ |
| 5 | Открывается Stripe Checkout | ⏳ runtime (super_admin кликает + 4242 4242 4242 4242) |
| 6 | webhook → provider_events processed | ⏳ runtime (после оплаты) |
| 7 | payments_v2 provider='stripe' | ⏳ runtime |
| 8 | orders_v2 paid | ⏳ runtime |
| 9 | grant-access-for-order отработал | ⏳ runtime |
| 10 | Дублей нет (UNIQUE idempotency_key) | ✅ guard уровня Phase 2 базы |
| 11 | bePaid не тронут | ✅ |
| 12 | create-payment-checkout.ts не тронут | ✅ |
| 13 | Никаких public payment_links с provider='stripe' | ✅ |
| 14 | Proof файл | ✅ (этот документ) |

## Runtime sequence для super_admin

1. `/admin/integrations/payments` → Stripe row
2. Нажать «Тестовая оплата Stripe»
3. Выбрать Продукт → Тариф → Offer
4. (Опц.) поменять валюту/email
5. «Создать sandbox order и открыть Stripe» → откроется новая вкладка
6. Карта `4242 4242 4242 4242`, любая будущая дата, любой CVC
7. После success — проверить:
   - `provider_events` row с `provider='stripe'`, processed
   - `payments_v2` row с `provider='stripe'`
   - `orders_v2.status='paid'`
   - `entitlements` / `access_rules` обновлены grant-access-for-order
8. Результаты внести в `.lovable/proofs/stripe_phase_2_runtime_sandbox_proof.md`

## Следующий шаг
Только после успешного runtime proof — переход к Фазе 3 (Public links / Subscriptions).
