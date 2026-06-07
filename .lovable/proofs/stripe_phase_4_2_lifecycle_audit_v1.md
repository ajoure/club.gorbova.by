# Proof: Phase 4.2 — Public Link Lifecycle Integrity (Stripe vs bePaid)

Дата: 2026-06-07
Тип: discovery-driven audit, без правок production-кода и миграций.
Аккаунт runtime: 7500084@gmail.com (Stripe тест-карта **не использовалась** — гэп выявлен структурно, см. STOP-guard #2 плана).

## Итоговая матрица

| Gate | Stripe | bePaid | Parity | Источник |
|---|---|---|---|---|
| **G61** current_uses increment | **FAIL** | PASS (historical) | **NO** | structural |
| **G62** max_uses enforcement | PARTIAL / BLOCKED-BY-G61 | PASS | partial | structural |
| **G63** expires_at enforcement | PASS | PASS | YES | structural |
| **G64** inactive link block | PASS | PASS | YES | structural |
| **G65** consume-payment-link path | **FAIL** | PASS | **NO** | structural |
| **G66a** payment_link_id linkage (one-time) | PASS (create) / FAIL (consume) | PASS | partial | DB + grep |
| **G66b** payment_link_id linkage (subscription) | PENDING / N/A | PASS | n/a | offer mapping = Phase 5 |
| **G67** bePaid parity | — | — | **NO** | follows G61/G65 |

**Финальный статус Phase 4.2 = FAIL.**
**Root cause:** `stripe-webhook` does not call `consume-payment-link` after a paid event и не материализует `orders_v2.meta.payment_link_id` в paid-состоянии.
**Next patch:** Phase 4.3 — Stripe `consume-payment-link` integration.

---

## G61 — current_uses increment

**Метод:** structural. Per STOP-guard #2 нового плана пользователя — не делаем лишний реальный Stripe-платёж, если гэп очевиден из кода.

**Доказательство FAIL:**
```bash
$ rg -n "consume|payment_link" supabase/functions/stripe-webhook/index.ts
(empty)
```
- `stripe-webhook/index.ts` (577 строк) — ноль импортов `consume-payment-link`, ноль чтений `metadata.payment_link_id`.
- `_shared/consume-payment-link.ts` — единственный writer `payment_links.current_uses`, вызывается ТОЛЬКО из `bepaid-webhook:2438` (link-order) и `bepaid-webhook:4170` (link).

**Историческое подтверждение bePaid PASS:** `payment_links.provider='bepaid'` = 114 строк; ненулевые `current_uses` подтверждают регулярный инкремент через `consumePaymentLinkForOrder`. Новые bePaid оплаты в рамках 4.2 не запускались (per STOP-guard #1 нового плана).

**Точка отказа Stripe:** отсутствует insert/update вызова `consumePaymentLinkForOrder(supabase, orderId, 'stripe-webhook[link]')` после terminal `checkout.session.completed` (one_time) и `invoice.paid` (subscription).

---

## G62 — max_uses enforcement

**Структурный анализ:** `public-checkout/index.ts:122-124` блокирует POST start, если `link.max_uses && link.current_uses >= link.max_uses`. Эта проверка provider-agnostic, выполняется ДО Stripe-ветки.

**Stripe partial:**
- **Pre-pay block:** работает (тот же провайдер-агностический guard в `public-checkout` GET 57-59 и POST 122-124).
- **Post-pay limit:** **BLOCKED-BY-G61** — поскольку `current_uses` Stripe-оплатой не инкрементится, фактический лимит `max_uses=1` после первой Stripe-оплаты НЕ сработает. Возможна 2-я, 3-я, N-я оплата через ту же ссылку. Это прямое следствие G61.

**bePaid:** PASS исторически — invariant соблюдён, инкремент после paid → `is_exhausted=true` → next attempt в `public-checkout` блокируется.

---

## G63 — expires_at enforcement

**Структурный анализ:** `public-checkout/index.ts:53-55` (GET) и `:118-120` (POST):
```ts
if (link.expires_at && new Date(link.expires_at) < new Date()) {
  return errorResponse('Payment link has expired', 410);
}
```
Provider-agnostic. Stripe-ссылка с истёкшим `expires_at` будет отклонена ДО early-dispatch.

**Status:** **PASS** для обоих провайдеров.

---

## G64 — inactive link block

**Структурный анализ:** `public-checkout/index.ts:49-51` и `:114-116`:
```ts
if (link.status !== 'active') {
  return errorResponse('Payment link is no longer active', 410);
}
```
`admin-invalidate-payment-link` (canonical writer) переводит status в `invalidated` — оба провайдера одинаково заблокированы.

**Подтверждение из DB:** 3 Stripe-ссылки (`b19c1fec`, `73c003be`, `b3b9886f`) уже в статусе `invalidated` после ручных тестов в 4.1 — `current_uses=0`, `paid_orders=0`. Открытие токена возвращает 410.

**Status:** **PASS** для обоих провайдеров.

---

## G65 — consume-payment-link path

**Метод:** структурный grep.

**Доказательство:**
- bePaid (PASS): `bepaid-webhook/index.ts:2438` и `:4170` вызывают `consumePaymentLinkForOrder(...)` после terminal=paid.
- Stripe (FAIL): `stripe-webhook/index.ts` НЕ содержит ни импорта, ни вызова `consumePaymentLinkForOrder`. Подтверждено `rg -n "consume|payment_link" supabase/functions/stripe-webhook/index.ts` → empty.

**Точка вставки для Phase 4.3:**
- one_time: в обработчике `checkout.session.completed`, после материализации/линковки `orders_v2` (с гарантией `meta.payment_link_id` из `event.data.object.metadata.payment_link_id`).
- subscription: в обработчике `invoice.paid` для первого цикла (subsequent циклы — отдельный invariant, пока не требуется).

---

## G66a — payment_link_id linkage (one-time)

**Create-side (PASS):**
```bash
$ rg -n "payment_link_id" supabase/functions/_shared/create-stripe-checkout.ts
54:  payment_link_id?: string | null;
89:    ..., payment_link_id,
194:      type: 'public_payment_link_stripe',
205:      ...(payment_link_id ? { payment_link_id } : {}),       # Stripe Session.metadata
308:        payment_link_id: payment_link_id ?? null,            # orders_v2.meta
374:        payment_link_id: payment_link_id ?? null,            # audit_log
514:    payment_link_id: payment_link_id ?? null,                # subscription meta
547:      payment_link_id: payment_link_id ?? null,              # audit_log
```

**DB подтверждение:** 2 pending заказа из 4.1/4.1.1 smoke (`2219d2cc`, `9f4979b3`) имеют `meta.payment_link_id` = id соответствующей ссылки. Linkage на стороне create — корректен.

**Consume-side (FAIL):** см. G65. После terminal paid stripe-webhook НЕ связывает Stripe Session.metadata.payment_link_id с `orders_v2` и НЕ инкрементирует счётчик.

---

## G66b — payment_link_id linkage (subscription)

**Status:** **PENDING / N/A**.

**Причина:** В рамках проекта на 2026-06-07 нет ни одного активного Stripe-eligible offer с `meta.stripe.price_id` И `meta.recurring.is_recurring=true` одновременно (single Stripe-eligible offer = Gorbova Club / CHAT, one-time tariff). Subscription public link через Stripe пока невозможно создать без backlog Phase 5 (Product Acquiring Settings / Stripe Price Mapping UI).

**Create-side готовность:** `stripe-pre-create-subscription.ts:267-268` записывает `payment_link_id` в `metadata` Stripe Session И в `subscription_data.metadata` (наследуется на subscription и invoices). Structural готовность есть, runtime данных нет.

---

## G67 — bePaid parity

Сводная таблица в начале документа. Parity = NO по G61/G65 — Stripe не реплицирует bePaid behavior для `consume-payment-link`.

Bepaid baseline (исторический, новые оплаты не запускались):
- 114 ссылок;
- ненулевой `current_uses` на оплаченных ссылках;
- идемпотентность через `orders_v2.meta.payment_link_counted=true`;
- enforcement status/expires/max_uses через тот же `public-checkout` код.

---

## Baseline orphan-снимок (для Phase 4.3 верификации)

| Метрика | Значение на 2026-06-07 |
|---|---|
| `payment_links.provider='stripe'` всего | 5 |
| Stripe ссылки `status='active' AND paid_orders > current_uses` | 0 (нет paid Stripe public-link заказов в истории) |
| Stripe ссылки с `related_orders > 0` | 2 (обе с pending orders из smoke 4.1) |
| Stripe paid `orders_v2 WHERE meta->>'payment_link_id' IS NOT NULL` | 0 |
| bePaid paid `orders_v2 WHERE meta->>'payment_link_id' IS NOT NULL AND meta->>'payment_link_counted'='true'` | большинство (historical baseline) |

После Phase 4.3 ожидается: первая paid Stripe public-link оплата → `payment_links.current_uses` инкрементируется на 1, `orders_v2.meta.payment_link_counted=true`, parity-таблица переходит в полный YES.

---

## Финальный отчёт для пользователя

```
G61  current_uses increment      = FAIL    (Stripe: no writer in webhook; bePaid: PASS hist)
G62  max_uses enforcement        = PARTIAL (pre-pay block PASS; post-pay BLOCKED-BY-G61)
G63  expires_at enforcement      = PASS    (provider-agnostic guard в public-checkout)
G64  inactive link block         = PASS    (admin-invalidate + status guard)
G65  consume-payment-link path   = FAIL    (stripe-webhook не вызывает consume)
G66a payment_link_id linkage     = PASS create / FAIL consume
G66b payment_link_id linkage     = PENDING (нет subscription offer с stripe.price_id)
G67  bePaid parity               = FAIL    (G61/G65 не реплицированы для Stripe)

Phase 4.2 = FAIL
Root cause = Stripe webhook does not consume payment link after paid event
Next patch = Phase 4.3 — Stripe consume-payment-link integration
            (точка вставки: handlers checkout.session.completed + invoice.paid)
```

Никаких правок production-кода/миграций в рамках 4.2 не выполнялось. Никаких новых runtime тестовых оплат картой не запускалось (per STOP-guards #1 и #2 нового плана).
