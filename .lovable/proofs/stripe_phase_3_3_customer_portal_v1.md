# Phase 3.3 — Stripe Customer Portal Runtime Proof (v1)

Состояние: CODE COMPLETE, runtime G26–G32 ожидает прогона через browser automation.

## Артефакты кода
- `supabase/functions/stripe-create-customer-portal-session/index.ts` — единственный канонический путь открытия Portal'а.
- `supabase/functions/_shared/stripe-subscription-resolver.ts` — расширение `onSubscriptionUpdated` (add-only) для аудитов resume/payment_method.
- `src/components/purchases/StripePortalButton.tsx` — кнопка в кабинете (`SubscriptionDetailSheet`).
- `.lovable/discovery/stripe_customer_portal_inventory_v1.md` — карта связей.

## Контракт edge function
```
POST /stripe-create-customer-portal-session
Body: { "subscription_v2_id": "uuid", "return_url"?: "https://..." }
Auth: JWT (владелец подписки)
200:  { "url": "https://billing.stripe.com/..." }
4xx:  { "error": "<code>", "detail"?: "..." }
```

### Stop-gates (audit `stripe.portal.session_blocked_<reason>` + HTTP)
- `profile_missing` (403)
- `not_subscription_owner` (403)
- `provider_not_stripe` (400)
- `stripe_subscription_id_missing` (400)
- `account_code_missing` (400)
- `customer_id_missing` (400)
- `secret_unavailable` (200, manual_review для админа)
- `pci_violation` (400, до auth)

### Stripe API ошибки
- `portal_configuration_mismatch` (502) — если Stripe вернул конфигурационную ошибку.
- `stripe_api_error` (502) — прочие.

## Runtime Proof G26–G32 — план прогона
Фикстуры — две новые active Stripe-подписки по канону Phase 3.2 (Hosted Checkout → webhook → active).

| Гейт | Сценарий | Ожидание |
| --- | --- | --- |
| G26 | invoke edge на Fixture A | 200 + `url` начинается с `https://billing.stripe.com/`; audit `stripe.portal.session_created` |
| G27 | navigate в `url` | Portal открыт; подписка отображается; current period виден |
| G28 | Добавить новую test-карту `4242…` в Portal | webhook `customer.subscription.updated` (или `payment_method.attached` / `customer.updated`) пришёл; `subscriptions_v2.meta.stripe.default_payment_method` изменён; audit `stripe.portal.payment_method_updated` |
| G29 | Включить cancel в Portal | webhook → `subscriptions_v2.meta.stripe.cancel_at_period_end=true`; `entitlements.expires_at` НЕ изменён; audit `stripe.portal.cancel_at_period_end_enabled` |
| G30 | Снять cancel в Portal (resume) | webhook → `cancel_at_period_end=false`; `subscriptions_v2.status='active'`; доступ цел; audit `stripe.portal.cancel_at_period_end_disabled` |
| G31 | Открыть «Invoices» в Portal | Видим минимум 1 invoice (от активации фикстуры) |
| G32 | bePaid Freeze | `SELECT count(*) FROM subscriptions_v2 WHERE provider='bepaid' AND updated_at > <test_start>` = 0 |
| G32.1 | Access freeze | `entitlements.expires_at` Δ = 0; `access_rules` Δ = 0; Telegram access Δ = 0 |

## Notes
- `session_opened` отдельным аудитом не пишем: Stripe не присылает событие открытия Portal'а. Подтверждение — return-flow + последующие webhook'и. Зафиксировано в discovery.
- last4/brand в UI — кэш `subv2.meta.stripe.default_payment_method`. SOT карты — Stripe Portal.
- Backlog: Phase 3.4 — Stripe Dunning + Smart Retries + Failed Payment Recovery.

## Заполняется по факту прогона
- subscription_v2_id Fixture A: __
- subscription_v2_id Fixture B: __
- stripe_customer_id: __
- stripe_subscription_id: __
- portal_session_id (G26): __
- webhook event_id (G28/G29/G30): __
- SQL before/after: __
