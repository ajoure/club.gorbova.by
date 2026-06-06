# Phase 4.1 — Provider-aware Public Payment Links (Stripe), Code Proof v1

**Status:** CODE PASS (runtime smoke pending).
**Scope:** add-only. bePaid path не изменён ни на байт. Webhook / grant-access / admin Stripe checkout — не тронуты.

## Файлы изменены

### Backend (новые)
- `supabase/functions/_shared/stripe-minor-units.ts` — `toStripeMinorUnits(amount, currency)` + zero-decimal guard.
- `supabase/functions/_shared/stripe-pre-create-subscription.ts` — shared helper, извлечён из `stripe-create-subscription-checkout` (шаги 8–11 + rollback). Поведение байт-в-байт идентично admin-функции. Поддерживает опциональный `payment_link_id` в Stripe Session metadata.
- `supabase/functions/_shared/create-stripe-checkout.ts` — Stripe-ветка для public payment link (one_time + subscription).

### Backend (изменены)
- `supabase/functions/_shared/create-payment-checkout.ts` — early-dispatch на Stripe-ветку при `provider==='stripe'`; bePaid-ветка не тронута. Расширены `CreateCheckoutParams` (`provider`, `account_code`, `currency`) и `CreateCheckoutSuccess` (`order_id` теперь `string | null`).
- `supabase/functions/admin-create-public-link/index.ts` — принимает `provider`/`account_code`, валидирует Stripe (whitelist валют, acquiring_connections active, installment+stripe запрет, sub+stripe требует `meta.stripe.price_id`). Записывает `provider`/`account_code`/`provider_mode` в `payment_links`.
- `supabase/functions/public-checkout/index.ts` — пробрасывает `link.provider`/`link.account_code`/`link.currency` в `createPaymentCheckout`; добавляет `provider` в GET-ответ.

### Backend (НЕ изменены)
- `supabase/functions/stripe-create-subscription-checkout/index.ts` — admin-функция оставлена байт-в-байт. Рефакторинг на shared helper отложен до runtime smoke (по требованию из правок плана).
- `supabase/functions/stripe-webhook/index.ts` — не тронут.
- `supabase/functions/grant-access-for-order/index.ts` — не тронут.
- bePaid-ветка `_shared/create-payment-checkout.ts` (one_time и subscription) — не тронута.

### Frontend
- `src/components/admin/AdminPaymentLinkDialog.tsx` — блок «Эквайер» (bePaid / Stripe), селект Stripe-подключения и валюты, ранние гарды: installment+Stripe запрещён, account missing — disable, subscription+Stripe без `meta.stripe.price_id` — disable. Поля `provider/account_code/currency` уходят в body `admin-create-public-link` для обоих CTA (manual + telegram_combined).
- `src/components/admin/payments/links/LinksTabContent.tsx` — provider filter уже существовал (Phase 1), полностью совместим.

### Frontend (НЕ изменены)
- BePaid существующие компоненты — без изменений.

## Контрактные инварианты

| Инвариант | Подтверждение |
|---|---|
| bePaid public link path байт-в-байт совместим | early-dispatch проверяет `params.provider === 'stripe'`; всё остальное (default + явный `bepaid`) идёт в существующий код без изменений |
| `provider` default = `bepaid` в writer и в shared helper | `provider: 'bepaid' \| 'stripe' = rawProvider === 'stripe' ? 'stripe' : 'bepaid'` |
| Stripe-ошибка → controlled FAIL, никакого bePaid fallback | Stripe-ветка возвращает `{ success: false, error }`, никаких bepaid fallback paths |
| Stripe subscription НЕ создаёт `orders_v2` | Subscription-ветка `create-stripe-checkout.ts` создаёт только pending `subscriptions_v2` + `provider_subscriptions` через shared helper. `orders_v2` остаётся за `invoice.paid` в stripe-webhook (Phase 3.1/3.2 канон) |
| `payment_link_id` уходит в Stripe metadata | one_time: `metadata.payment_link_id` через `stripe-adapter.createCheckout({ metadata })`. subscription: `metadata.payment_link_id` + `subscription_data.metadata.payment_link_id` через shared helper |
| Installment + Stripe запрещено | Writer: `installment_not_supported_on_stripe` (400). UI: `stripeInstallmentBlocked` дизейблит кнопку с пояснением |
| Subscription + Stripe требует `meta.stripe.price_id` early | Writer: 400 `stripe_price_missing_in_offer_meta`. UI: дизейбл + текст ошибки |
| `requireSuperAdmin` на admin Stripe edge-функциях не снят | `stripe-create-checkout` / `stripe-create-subscription-checkout` не тронуты |

## Proof: `toStripeMinorUnits`

| Input | Expected | Result |
|---|---|---|
| `5, 'EUR'` | `500` | OK |
| `5, 'eur'` | `500` | OK |
| `100, 'BYN'` | `10000` | OK |
| `24.99, 'USD'` | `2499` | OK |
| `0.10, 'PLN'` | `10` | OK |
| `1234.56, 'usd'` | `123456` | OK |
| `1, 'JPY'` | `throws unsupported_zero_decimal_currency:JPY` | OK |

## Runtime gates (PENDING)

Минимальный набор для PASS 4.1:
- **G4.1-A** bePaid existing public link (один из 113) → `redirect_url` checkout.bepaid.by, `payment_links.provider='bepaid'` неизменно.
- **G4.1-B** Новая bePaid public link (без `provider` в body) → провайдер записан как `bepaid` по умолчанию, оплата работает.
- **G4.1-C** Новая Stripe one-time public link → `payment_links.provider='stripe'`, `redirect_url` checkout.stripe.com, `orders_v2 pending provider='stripe'` создан.
- **G4.1-D** Новая Stripe subscription public link (offer с `meta.stripe.price_id`) → `redirect_url` Stripe subscription URL, `subscriptions_v2 status='pending'` + `provider_subscriptions state='pending' provider_subscription_id='pending:{uuid}'` созданы, `orders_v2` НЕ создан.
- **G4.1-E** Admin `stripe-create-subscription-checkout` (super_admin) → продолжает работать как раньше (smoke по той же фикстуре, что в Phase 3.1).

## Known gaps (вне scope 4.1)

- **G-NEXT-1:** `stripe-webhook` не вызывает `consume-payment-link` → счётчик `payment_links.current_uses` не вырастет после оплаты Stripe link. `payment_link_id` уже передаётся в metadata, нужен только тонкий патч в webhook. Фиксируем как backlog.
- **G-NEXT-2:** Рефакторинг `stripe-create-subscription-checkout` на shared helper отложен. Сейчас в коде два независимых пути с идентичной логикой. После runtime PASS — отдельный мини-патч с proof admin smoke.
