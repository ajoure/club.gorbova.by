# Stripe — First Real Event Checklist (v1)

> Status: ACTIVE OPERATIONAL CHECKLIST  
> Created: 2026-06-13 (STRIPE-FINAL-CLOSURE-SPRINT-V1 / RUN 4)  
> **Эти пункты НЕ являются открытыми engineering-patch'ами.** Новый deploy выполняется только если первое реальное событие выявит фактический дефект.

## Назначение

Список deferred live UAT-сценариев, для которых код, тесты и runtime-инфраструктура уже реализованы. Каждый пункт проверяется при наступлении первого реального production-события.

## Чеклист

### F1. Stripe receipt в Documents Drawer (live)

- **Event:** реальный `charge.succeeded` от live Stripe-аккаунта на любую сумму ≥ 1 USD.
- **Expected:** в `/admin/payments → drawer документов` появляются провайдерские документы:
  - `receipt` с `external_id = ch_*`, `url = charge.receipt_url`, `url_kind = external_provider`, `can_open = true`.
  - При наличии invoice: `hosted_invoice` (`url = invoice.hosted_invoice_url`), `invoice_pdf` (`url = invoice.invoice_pdf`).
- **SQL/audit checks:**
  - `SELECT meta->'stripe' FROM payments_v2 WHERE provider_payment_id = 'ch_...'` → объект содержит `receipt_url`, `invoice_id`, `payment_intent_id`.
  - `audit_logs.action = 'admin.payment_documents.provider_refresh'` фиксирует обновление.
- **Failure condition:** drawer пустой ИЛИ `url_kind = unavailable` при наличии `receipt_url` в meta.
- **Owner:** super_admin (`7500084@gmail.com`).
- **Deploy required:** нет.

### F2. Card enrichment — checkout.session.completed (live)

- **Event:** первая live one-time оплата картой через Stripe Checkout.
- **Expected:** `payments_v2.card_brand` и `card_last4` материализуются из `payment_method_details.card.{brand,last4}` (см. `mem://architecture/payments/stripe-card-enrichment` backlog F2/F3).
- **Failure condition:** card_brand/card_last4 = NULL при наличии `latest_charge.payment_method_details.card` в Stripe API.
- **Deploy required:** нет (логика в `stripe-webhook`).

### F3. Card enrichment — payment_intent.succeeded (live)

- **Event:** первая live recurring оплата через Subscription invoice.
- **Expected:** аналогично F2, но через `invoice.charge.payment_method_details`.
- **Failure condition:** card data отсутствует после успешного invoice.
- **Deploy required:** нет.

### F4. Card enrichment — invoice.paid (live)

- **Event:** первый успешный invoice cycle (renewal без 3DS-challenge).
- **Expected:** card data поднимается через `invoice.charge`.
- **Deploy required:** нет.

### F5. Consultation document — first live PDF

- **Event:** первая реальная (не fixture) консультация после введения шаблона.
- **Expected:** `ai_generated_documents` row с `status='ready'`, корректный `url_kind`, PDF доступен.
- **Failure condition:** генерация падает / шаблон не найден / FLD-токен не резолвится.
- **Deploy required:** нет.

### F6. Recurring subscription — first invoice cycle

- **Event:** первое реальное автопродление Stripe-подписки (через ~30 дней после первой оплаты).
- **Expected:**
  - `invoice.paid` webhook → `subscriptions_v2.access_end_at` продлевается через канонический `grant-access-for-order`.
  - `provider_subscriptions.last_charge_at` обновляется.
  - `subscriptions_v2.meta.stripe.current_period_end` обновляется → resolver показывает корректный «следующее списание».
- **Failure condition:** двойное списание access (см. `grant-access-idempotency` guard); подписка остаётся в `past_due`.
- **Deploy required:** нет.

### F7. invoice.payment_failed lifecycle

- **Event:** первый реальный отказ карты при автопродлении.
- **Expected:**
  - `subscriptions_v2.status = 'past_due'`, доступ НЕ отзывается (grace).
  - `meta.stripe.dunning_status` ставится (см. backlog `stripe_dunning_*`).
- **Failure condition:** access снят немедленно (нарушение grace policy).
- **Deploy required:** нет.

### F8. Webhook event replay / idempotency

- **Event:** Stripe доставляет один и тот же event дважды (или manual replay из Dashboard).
- **Expected:** второй обработчик возвращает 200 без побочных эффектов (idempotency-ключ по `event.id` ИЛИ по `charge.id`).
- **Failure condition:** дублирование `payments_v2` или двойной grant access.
- **Deploy required:** нет.

### F9. Non-admin RBAC live smoke

- **Event:** обычный авторизованный пользователь (не admin) пытается дёрнуть `admin-stripe-bulk-cancel` или `stripe-subscription-action`.
- **Expected:** HTTP 403 `forbidden`, audit не пишется.
- **Failure condition:** запрос принят / выполнен.
- **Deploy required:** нет.

### F10. Bulk cancel — первый production execute

- **Event:** первое реальное использование `admin-stripe-bulk-cancel` для отмены ≥ 2 подписок.
- **Expected:**
  - dry-run выдаёт `batch_id` с корректной eligibility.
  - execute с `confirm=true` обрабатывает каждый sub отдельным вызовом `stripe-subscription-action`.
  - audit `admin.subscriptions.bulk_cancel.execute.*` содержит результаты.
- **Failure condition:** частичное выполнение без отчёта; stale-checks не срабатывают.
- **Deploy required:** нет (функция уже задеплоена).

### F11. Test fixture marker — первая запись

- **Event:** первое production-использование `meta.fixture = true`.
- **Expected:** `admin-payment-documents-resolve` возвращает `can_generate=false`, `blocked_reason='TEST_PAYMENT_DOCUMENT_BLOCKED'` после redeploy resolver'а с новой версией classifier'а.
- **Failure condition:** генерация production-номера на fixture-платёж.
- **Deploy required:** **ДА**, при первом write-use — единый controlled redeploy `admin-payment-documents-resolve` (нужно подать `is_test_fixture: payment.meta?.fixture === true` в `classifyGeneration` facts).

---

## Глобальное правило

Если события F1–F10 показывают expected behavior — никаких действий не требуется. Если F11 потребует первого write-use — выполняется отдельный controlled deploy `admin-payment-documents-resolve` через одну точку (никакого нового спринта).

Pull этого checklist'а в новые спринты запрещён — это операционный артефакт.
