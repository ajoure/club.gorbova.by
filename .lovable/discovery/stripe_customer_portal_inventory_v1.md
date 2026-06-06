# Phase 3.3 — Stripe Customer Portal Inventory (v1)

Read-only discovery. Code не менялся.

## 1. Используется ли Customer Portal сейчас
`rg -ni "customer_portal|billing_portal|portal-session|billing.stripe.com" supabase/functions src` — **0 совпадений**. Portal в продукте не задействован.

## 2. Хранение customer_id
SOT: `profiles.meta.stripe.customers[<account_code>].customer_id`.
Запись/обновление — `stripe-webhook/index.ts` (стр. 166–195): при `checkout.session.completed` идёт guard «customer mismatch», далее set-if-absent или `last_synced_at` update. Никаких отдельных колонок.

Дополнительный snapshot встречается:
- `subscriptions_v2.meta.stripe.customer_id` — пишется ресoлвером в `_shared/stripe-subscription-resolver.ts` (`onSubscriptionCreated` → `mergeSubMetaStripe`).
- `provider_subscriptions.meta.stripe.customer_id` — там же.

Fallback-цепочка для Phase 3.3:
1. `profiles.meta.stripe.customers[account_code].customer_id`
2. `subscriptions_v2.meta.stripe.customer_id`
3. `provider_subscriptions.meta.stripe.customer_id`

## 3. subscription_id и account_code
- `provider_subscriptions`: `provider='stripe'`, `provider_subscription_id='sub_…'`, `meta.account_code` обязателен (binding contract Phase 3.1).
- `subscriptions_v2.meta.stripe.{subscription_id, account_code, customer_id, current_period_*, cancel_at_period_end, default_payment_method, status}` — синкается webhook'ом.

## 4. account_code → connection
`acquiring_connections` (`provider='stripe'`, `account_code`, `status`, `test_mode`). Секрет читаем через `readAcquiringSecret('stripe', account_code, 'secret_key')` (`_shared/acquiring/vault.ts`).

Сегодня в test mode:
- `stripe_poland` — единственный active stripe connection, использован для всех runtime proof Phase 3.2 (Fixture A/B).

## 5. UI кабинета подписок
`src/pages/Purchases.tsx` + `src/components/purchases/SubscriptionDetailSheet.tsx` — единственная клиентская поверхность управления подписками.
Действия в Sheet: cancel, resume (через `subscription-actions`), receipts. **Кнопки «Открыть Stripe Customer Portal» нет.**

Отдельной страницы `/account/subscription` в `src/App.tsx` НЕ существует. Phase 3.3 не создаёт собственный billing-кабинет: кнопка добавляется в существующий `SubscriptionDetailSheet`, return_url по умолчанию указывает обратно на `/purchases`.

## 6. Карта связей (customer → subscription → account_code → portal session)
```
profiles.id
  └── profiles.meta.stripe.customers[account_code].customer_id  (cus_*)
         └── subscriptions_v2.id (user_id = profiles.id)
                ├── subscriptions_v2.meta.stripe.{subscription_id, account_code, customer_id}
                └── provider_subscriptions (provider='stripe',
                                            provider_subscription_id=sub_*,
                                            subscription_v2_id, meta.account_code)
                        ↓
                acquiring_connections.account_code  → vault: acq:stripe:<account_code>:secret_key
                        ↓
                POST /v1/billing_portal/sessions  (customer=cus_*, return_url=…)
                        ↓
                Stripe Hosted Customer Portal
```

## 7. Billing Portal Configuration
В коде нет ни одного запроса к `/v1/billing_portal/configurations`. В Stripe Dashboard для test-аккаунта `stripe_poland` действует default Portal Configuration (Stripe-managed). Решения по конфигурации (allow/deny features) принимаются ОТДЕЛЬНО (вне runtime пользовательского запроса) — см. Phase 3.3 этап C.

DoD: discovery зафиксирован. Кода не правили.
