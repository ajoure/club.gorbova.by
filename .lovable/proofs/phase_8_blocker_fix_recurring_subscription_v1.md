# BLOCKER FIX — Stripe recurring offer → subscription checkout

Дата: 2026-06-08
Связан с: `.lovable/proofs/phase_8_runtime_verify_partial_v1.md`

## 1. Root cause

`payment_links.payment_type='one_time'` записывался для recurring CHAT (offer.meta.recurring.is_recurring=true). UI был SOT, backend не проверял recurring-флаг оффера. Дальше `create-stripe-checkout` строил Stripe Checkout `mode='payment'` → one-time PaymentIntent → нет `invoice.paid` → пустые invoice-поля в `payments_v2`.

Нарушение Core rule **Product Type SOT**: recurring vs one-time определяется ТОЛЬКО через `tariff_offers.meta.recurring.is_recurring`.

## 2. Fix summary

### Backend — `supabase/functions/admin-create-public-link/index.ts`

После Stage L (installment) добавлен recurring-guard:

```ts
const recurringPromotionEligible =
  offerIsRecurring === true &&
  !installmentBlock &&
  offerPaymentMethod !== 'internal_installment' &&
  (
    (providerMode === 'fixed' && provider === 'stripe') ||
    (providerMode === 'customer_choice' && effectiveAllowedProviders.includes('stripe'))
  );
if (recurringPromotionEligible && payment_type === 'one_time') {
  recurringPromotedFromPaymentType = 'one_time';
  payment_type = 'subscription';
  recurringPromoted = true;
}
```

- Action audit `payment_link.payment_type_promoted_recurring` (system actor, `actor_label='admin-create-public-link'`) пишется при срабатывании guard.
- super_admin bypass **не добавлен** — recurring semantics нельзя ломать даже супером.
- bePaid path и installment не затронуты (installment уже форсится `subscription` выше).

### UI — `src/components/admin/AdminPaymentLinkDialog.tsx`

- Новый dervied `lockPaymentTypeToSubscription = effectiveOffer + offer recurring + Stripe path active + !installment`.
- `useEffect` авто-промоутит UI-стейт `paymentType` в `subscription`, чтобы preview/audit совпадали с тем, что запишет backend.
- Кнопка «Разовая оплата» получает `disabled`, серый стиль и хинт: «Тариф является рекуррентным, поэтому для Stripe будет создана подписка (mode=subscription). Изменить тип нельзя.»
- bePaid-only и one-time офферы — без изменений.

## 3. Diff scope (соответствует freeze)

| Файл | Изменён |
|------|---------|
| `supabase/functions/admin-create-public-link/index.ts` | да |
| `src/components/admin/AdminPaymentLinkDialog.tsx` | да |
| bePaid webhook / cron / reconcile / grant-access / Telegram / canonical-documents / Gotenberg / storage / PDF / receipt materializer / Stripe webhook / migrations / новые таблицы / новые edge functions | **НЕ ТРОНУТЫ** |

Deploy: `admin-create-public-link` — Successfully deployed.

## 4. Verify SQL templates (после нового теста)

```sql
-- 4.1 payment_links row после fix (CHAT recurring, Stripe)
SELECT id, provider, provider_mode, payment_type, offer_id, currency, meta
FROM payment_links
WHERE id = '<new_payment_link_id>';
-- Ожидание: payment_type='subscription'

-- 4.2 payments_v2 после invoice.paid
SELECT id, provider, provider_payment_id, order_id, receipt_url,
       meta->'stripe'->>'hosted_invoice_url' AS hosted_invoice_url,
       meta->'stripe'->>'invoice_pdf'        AS invoice_pdf,
       meta->'stripe'->>'stripe_invoice_id'  AS stripe_invoice_id,
       updated_at
FROM payments_v2
WHERE provider='stripe'
ORDER BY updated_at DESC
LIMIT 20;
-- Ожидание: hosted_invoice_url, invoice_pdf, stripe_invoice_id заполнены

-- 4.3 audit (новый + materialization)
SELECT action, actor_type, actor_user_id, actor_label, meta, created_at
FROM audit_logs
WHERE action IN (
  'payment_link.payment_type_promoted_recurring',
  'stripe.invoice_document_materialized',
  'stripe.receipt_materialization.applied'
)
ORDER BY created_at DESC
LIMIT 50;
```

Ожидаемый actor для materialization: `actor_type='system'`, `actor_user_id IS NULL`, `actor_label='stripe-webhook'`.

## 5. Verify workflow (для runtime прогона)

1. Открыть `/admin/payments/links` → Create link.
2. Продукт: Gorbova Club, Тариф: CHAT, Recipient: 7500084@gmail.com, Provider: **Stripe** (explicit), Currency: EUR/BYN.
3. В диалоге наблюдать: «Разовая оплата» **disabled**, выбран «Подписка», amber-хинт.
4. Создать ссылку → `payment_links.payment_type='subscription'` + audit `payment_link.payment_type_promoted_recurring`.
5. Открыть `/pay/:token`, оплатить Stripe test card `4242 4242 4242 4242`.
6. Webhook events: `checkout.session.completed` (mode=subscription) → `customer.subscription.created` → `invoice.paid`.
7. `payments_v2.meta.stripe.{hosted_invoice_url, invoice_pdf, stripe_invoice_id}` заполнены.
8. Audit `stripe.invoice_document_materialized` (system / stripe-webhook).

## 6. Lifecycle safety expectation

- 1 order, 1 payment, 1 subscription по новой Stripe sub_id; никаких дублей.
- Один канонический grant Club через `grant-access-for-order → telegram-grant-access`.
- bePaid таблицы/cron не задеты.

## 7. Final status после runtime

| Сценарий | Статус |
|----------|--------|
| `payment_type='subscription'` записан + `invoice.paid` материализовал invoice fields | **Phase 8 FULL PASS** |
| `payment_type='subscription'` записан, invoice materialization не прошла | PARTIAL / SUBSCRIPTION MATERIALIZATION FAILED |
| `payment_type='one_time'` снова | BLOCKER NOT FIXED |

Phase 9 не начинать до FULL PASS.
