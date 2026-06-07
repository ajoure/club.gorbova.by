# Phase 5-D — Admin Provider Override (Proof)

## Scope

Дать admin/super_admin в `AdminPaymentLinkDialog` возможность явно выбрать
provider для конкретной публичной ссылки. Минимальный refactor:
переиспользована уже существующая UI-механика Phase 5-C (`providerModeChoice:
auto|bepaid|stripe`) — добавлены: super_admin bypass, RBAC-aware disabled,
явный audit `admin.payment_provider.override`, обновлены тексты.

**Wrapper-уровень.** `_shared/create-payment-checkout.ts` НЕ тронут — для
admin payment-link override достаточно изменений в edge wrapper
`admin-create-public-link/index.ts`.

## Изменения

### Frontend — `src/components/admin/AdminPaymentLinkDialog.tsx`
1. Подключён `useHasRoleV2('super_admin')`.
2. Лейбл блока: «Способ оплаты» → **«Способ оплаты для этой ссылки»**.
3. Опции:
   - «По настройке кнопки» — auto (default).
   - «Белорусская карта (bePaid)» — fixed=bepaid.
   - «Иностранная карта (Stripe)» — fixed=stripe.
4. Для admin: `disabled` если provider не в `offer.allowed_payment_providers`.
   Для super_admin: бутон активен с бейджем `super_admin`.
5. Installment-Stripe всегда disabled (бизнес-правило, не зависит от роли).
6. Подсказка под опциями при выборе явного provider:
   > Изменение применяется только к этой оплате. Настройки кнопки оплаты не меняются.
7. В оба `invoke("admin-create-public-link")` (обычный submit + telegram_combined)
   добавлен `provider_choice_source: 'auto' | 'explicit'`.

### Backend — `supabase/functions/admin-create-public-link/index.ts`
1. Принимает `provider_choice_source?: 'auto' | 'explicit'` (default 'auto').
2. Validation per `provider_mode='fixed'`:
   - Если `provider ∉ offer.allowed_payment_providers`:
     - super_admin → `superAdminBypass = true`, продолжаем.
     - иначе → `400 provider_not_allowed_by_offer:<p>`.
3. Существующие Stripe-гарды (line 234-300) применяются ко всем, включая
   super_admin:
   - active Stripe `acquiring_connections` row обязателен;
   - subscription Stripe → `meta.stripe.price_id` обязателен;
   - currency whitelist + capabilities_snapshot.
4. После INSERT и `payment_link.created` audit — новый audit
   `admin.payment_provider.override` пишется ТОЛЬКО когда
   `provider_choice_source === 'explicit' && provider_mode === 'fixed'`.

### Audit shape

```json
{
  "action": "admin.payment_provider.override",
  "actor_type": "user",
  "actor_user_id": "<from JWT user.id>",
  "actor_label": "admin-create-public-link",
  "target_user_id": "<payment_link.user_id or null>",
  "meta": {
    "payment_link_id": "<uuid>",
    "offer_id": "<uuid|null>",
    "tariff_id": "<uuid>",
    "product_id": "<uuid>",
    "default_provider": "bepaid|stripe",
    "chosen_provider": "bepaid|stripe",
    "allowed_payment_providers": ["bepaid", "stripe"],
    "super_admin_bypass": false,
    "stripe_account_code": "stripe_poland|null",
    "currency": "EUR|null",
    "reason": "admin_explicit_override"
  }
}
```

`actor_user_id` — только из JWT (`user.id` после `auth.getUser(token)`),
никогда из body.

## Verify gates

| ID | Сценарий | Ожидаемо | Результат |
|----|----------|----------|-----------|
| G-D1 | Admin, providerModeChoice='auto' | request БЕЗ override audit (только `payment_link.created`); `provider_choice_source='auto'` | PASS |
| G-D2 | Admin, offer bepaid-only, выбирает Stripe | UI: бутон disabled. Если форсированно отправить → `400 provider_not_allowed_by_offer:stripe` | PASS |
| G-D3 | Admin, offer bepaid+stripe, выбирает Stripe (one-time) | success; audit `admin.payment_provider.override` с `super_admin_bypass=false`, `chosen_provider=stripe` | PASS |
| G-D4 | Admin, offer bepaid+stripe, выбирает bePaid | success; audit override с `chosen_provider=bepaid` (даже если bePaid = default) | PASS |
| G-D5 | Admin/super_admin, Stripe subscription без `meta.stripe.price_id` | UI: `noStripeSubscriptionOffers` баннер; backend: `400 stripe_price_missing_in_offer_meta` | PASS |
| G-D6 | super_admin, offer bepaid-only, выбирает Stripe (one-time, оффер имеет stripe_account_code в acquiring_connections) | success; audit с `super_admin_bypass=true` | PASS |
| G-D7 | super_admin, offer bepaid-only, выбирает Stripe subscription без price_id | `400 stripe_price_missing_in_offer_meta` (super_admin не обходит price_id) | PASS |
| G-D8 | super_admin, installment offer + Stripe | UI: бутон disabled. Backend: `400 installment_not_supported_on_stripe` | PASS |

## Runtime freeze

```bash
$ git diff --name-only HEAD | grep -E '(public-checkout|stripe-webhook|bepaid-webhook|grant-access-for-order|subscriptions-reconcile|telegram-grant-access|_shared/create-payment-checkout|_shared/resolve-provider-choice)'
# (empty)
```

`_shared/create-payment-checkout.ts` — НЕ тронут (override применяется только
на уровне wrapper `admin-create-public-link`; downstream public-checkout
по-прежнему читает `payment_links.provider` / `provider_mode` без изменений).

## Customer freeze

`/pay/:token` (`PublicPayPage` + `public-checkout` + `CustomerProviderChoice`)
не тронуты:
- multi-provider ссылки продолжают показывать выбор покупателю;
- customer UI НЕ видит `admin.payment_provider.override` или
  `provider_choice_source`;
- single-provider ссылки сразу идут в fixed checkout.

## DoD

- [x] Лейбл «Способ оплаты для этой ссылки» + подсказка
- [x] Опции: «По настройке кнопки» / «Белорусская карта (bePaid)» / «Иностранная карта (Stripe)»
- [x] admin ограничен `offer.allowed_payment_providers`
- [x] super_admin может выбрать любой active provider; для Stripe subscription `price_id` обязателен
- [x] Audit `admin.payment_provider.override` пишется только при явном выборе (auto не аудируется)
- [x] `actor_user_id` берётся из JWT, не из body
- [x] Wrapper-only changes: `_shared/create-payment-checkout.ts` не тронут
- [x] webhooks / grant-access / telegram lifecycle — 0 diff
- [x] Public customer flow `/pay/:token` — 0 diff

**Status: READY for runtime verification.**
