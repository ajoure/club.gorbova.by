# Phase 5-D — Admin Provider Override (Discovery)

**Статус:** READY — код не пишется до отдельного approve.

## Цель Phase 5-D

Дать admin/super_admin в `PaymentDialog` (internal/admin checkout flow) возможность **временно переопределить** провайдера эквайринга для конкретного платежа, не меняя оффер и не трогая пользовательскую логику.

Default behaviour без override — поведение Phase 5-C (по настройке кнопки оплаты).

---

## Точки расширения

### 1. `src/components/payment/PaymentDialog.tsx`

Используется admin/internal путём (вне `/pay/:token`). Сейчас вызывает `create-payment-checkout` (через RPC/edge-обёртку) без указания провайдера.

Что нужно:
- При `useAuth()` + `has_role_v2('admin')|has_role_v2('super_admin')` показывать блок «Способ оплаты (admin override)» внизу диалога.
- Radio:
  - **По настройке кнопки** (default) — текущее поведение, override не передаётся.
  - **Белорусская карта (bePaid)** — admin override, передаётся `admin_provider_override='bepaid'`.
  - **Международная карта (Stripe)** — admin override, передаётся `admin_provider_override='stripe'` + UI для выбора аккаунта/валюты (как в `AdminPaymentLinkDialog`).
- В админ-зоне можно использовать технические термины bePaid/Stripe (это не клиентский UI).
- Текст-поясняшка: «Применится только для этого платежа. Настройки кнопки оплаты не изменятся.»

### 2. `supabase/functions/_shared/create-payment-checkout.ts`

Сейчас принимает `provider` + `account_code` напрямую. Эти параметры приходят из `public-checkout` (после Phase 5-C — после резолва customer_choice).

Для Phase 5-D:
- Если вызывающий — `create-payment-checkout` (admin/internal путь), нужен новый параметр `admin_provider_override?: { provider: 'bepaid' | 'stripe'; account_code?: string; currency?: string; actor_user_id: string; }`.
- Override валидируется против `offer.meta.acquiring.allowed_payment_providers`. Если оффер не разрешает выбранного провайдера — 400 `admin_override_not_allowed_by_offer`.
- Override НЕ меняет постоянные настройки — только этот checkout.

### 3. `supabase/functions/create-payment-checkout/index.ts` (если оборачивает шаренный helper)

Принять `admin_provider_override` в body, провалидировать `has_role_v2(actor, 'admin'|'super_admin')` через JWT, прокинуть в шаренный helper.

---

## RBAC

- `has_role_v2(actor, 'admin')` или `has_role_v2(actor, 'super_admin')`.
- Любой другой пользователь — 403 `admin_role_required_for_override`.
- В UI radio скрывается, если у текущего user нет роли (clientside `useHasRole`).

---

## Audit-action (server-side mandatory)

В `audit_logs`:

```json
{
  "action": "admin.payment_provider.override",
  "actor_type": "user",
  "actor_user_id": "<uuid>",
  "actor_label": "create-payment-checkout",
  "target_user_id": "<payer uuid>",
  "meta": {
    "order_id": "<uuid>",
    "offer_id": "<uuid>",
    "override_provider": "stripe",
    "default_offer_provider": "bepaid",
    "account_code": "stripe_poland",
    "currency": "EUR",
    "reason": "admin_override"
  }
}
```

Запись делает edge function на сервере (не клиент).

---

## Что НЕ входит в Phase 5-D

- Изменение `offer.meta.acquiring` — это управляется Phase 5-B/UI.
- Customer-facing выбор — уже сделано в Phase 5-C.
- Webhooks/grant-access/Telegram lifecycle — freeze.
- Изменения в `admin-create-public-link` — публичные ссылки тоже не трогаем (там провайдер определяется `provider_mode`).

---

## Открытые вопросы

1. **Audit для одиночных провайдеров.** Override `bepaid → bepaid` (нет фактической смены) — писать ли audit? Предложение: не писать, чтобы не зашумлять.
2. **Stripe currency для override.** Брать из admin-input или из `acquiring_connections.capabilities`? Предложение: input + default из аккаунта (как в `AdminPaymentLinkDialog`).
3. **Installment override.** Если оффер `internal_installment` — UI блокирует Stripe (как в Phase 5-B/5-C). Решение: dropdown disabled + helper-текст.

---

## DoD кандидат для Phase 5-D

- [ ] UI в PaymentDialog (admin-only, RBAC через `useHasRole`).
- [ ] Server-side валидация (`has_role_v2`, allowed_payment_providers, audit).
- [ ] Audit `admin.payment_provider.override` пишется на сервере.
- [ ] Без override — пиксель в пиксель тот же flow, что и сейчас.
- [ ] Zero-diff на webhooks/grant-access/telegram.
- [ ] Proof + smoke по 4 кейсам (no override / bepaid override / stripe override / not allowed).

**READY for Phase 5-D implementation (pending approve).**
