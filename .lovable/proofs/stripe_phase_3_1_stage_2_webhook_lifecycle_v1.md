# Phase 3.1 Stage 2 — Webhook Lifecycle (CODE COMPLETE)

**Дата:** 2026-06-05
**Статус:** CODE COMPLETE — ожидает Stage 2.5 Runtime Proof (G10–G18).
**Scope:** add-only расширение `stripe-webhook` на 5 подписочных event-классов + унификация `subscription-conflict` helper.

---

## 1. Изменения

| Файл | Тип | Назначение |
|---|---|---|
| `supabase/functions/_shared/subscription-conflict.ts` | edit | provider-aware (`providers: ['bepaid','stripe']` default) в `checkSubscriptionConflict` + `classifySameProductState`; backlog B1 закрыт |
| `supabase/functions/_shared/stripe-subscription-resolver.ts` | **new** | SOT-резолвер 5 подписочных event-классов; pure helpers без HTTP; готов к re-use в reconcile/replay (Stage 4) |
| `supabase/functions/stripe-webhook/index.ts` | edit | add-only dispatch через резолвер для `STRIPE_SUBSCRIPTION_EVENT_TYPES`; обработка `manual_review:*` → `provider_events.processing_status='manual_review'` |
| `supabase/functions/stripe-create-subscription-checkout/index.ts` | edit | удалён inline Stripe-aware guard (6.b), теперь использует унифицированный `checkSubscriptionConflict({providers:['bepaid','stripe']})` |
| `supabase/config.toml` | — | без изменений |
| bePaid edge-функции | — | НЕ затронуты |
| `grant-access-for-order` | — | НЕ затронут (только вызывается из `invoice.paid`) |
| RPC / cron / миграции | — | НЕ создавались |

---

## 2. Ключевое правило (Source of Truth активации)

```
invoice.paid                     = ЕДИНСТВЕННЫЙ activation event
                                   (orders_v2 + payments_v2 + grant-access-for-order)

customer.subscription.created    = bind lifecycle only        (НЕ выдаёт доступ)
customer.subscription.updated    = sync lifecycle only        (НЕ выдаёт доступ)
customer.subscription.deleted    = cancel lifecycle only      (НЕ revoke доступ)
invoice.payment_failed           = grace lifecycle only       (НЕ revoke, НЕ CRM fail)
```

Это правило enforced на уровне резолвера: только `onInvoicePaid` создаёт `orders_v2` и зовёт `grant-access-for-order`. Остальные 4 ветки делают только UPDATE по `subscriptions_v2.meta` + `subscriptions_v2.status` (без записи в `entitlements`/`access_rules`).

---

## 3. Покрытие 5 веток

### C.1 `customer.subscription.created` (`onSubscriptionCreated`)
- Резолв pending placeholder: `provider_subscriptions WHERE provider='stripe' AND subscription_v2_id=<md.subscription_v2_id> AND state='pending' AND provider_subscription_id='pending:<subv2_id>'`.
- **Zombie pending guard**: если `subscriptions_v2.status ∈ {canceled, expired, superseded, expired_reentry}` → `manual_review` (`zombie_pending_subscription`), bind НЕ выполняется.
- **Bind**: UPDATE `provider_subscriptions.provider_subscription_id = sub_*`, `state ← mapStripeSubStatus(...)`.
- UPDATE `subscriptions_v2.meta.stripe.*` (sub_id, customer_id, periods, cancel_at_period_end, default_payment_method, status).
- `subscriptions_v2.status` **не** переводим в `active` — это сделает `invoice.paid`.
- Idempotency: повторная доставка → `already_bound` (noop).
- Conflict: `no_pre_created_sub`, `foreign_account`, `subv2_missing`, `zombie_pending_subscription` → `manual_review`.

### C.2 `customer.subscription.updated` (`onSubscriptionUpdated`)
- Резолв через `findSubByStripeId(stripeSubId)`.
- Snapshot `meta.stripe.*` (period, cancel_at_period_end, default_payment_method, status).
- Sync `subscriptions_v2.status` по `mapStripeSubStatus` — но **только если status ≠ 'pending'** (защита от ложной активации).
- Sync `provider_subscriptions.state`.
- Доступ НЕ трогаем.
- Conflict: `unknown_subscription`, `subv2_missing`, `foreign_account` → `manual_review`.

### C.3 `customer.subscription.deleted` (`onSubscriptionDeleted`)
- `subscriptions_v2.status='canceled'`, `cancel_reason='stripe_subscription_deleted'`, `canceled_at=now`, `auto_renew=false`.
- `provider_subscriptions.state='canceled'`.
- **Доступ НЕ отзывается** (живёт до `entitlements.expires_at`, GREATEST-логика).
- Audit фиксирует `access_preserved_until_entitlements_expiry: true`.

### C.4 `invoice.paid` — **EXCLUSIVE ACTIVATION PATH**
- **B-2 idempotency (SELECT before INSERT)**: `orders_v2 WHERE meta->stripe->>invoice_id = invoice.id`. Если найдено → `invoice_paid_duplicate`, **новый order/payment не создаётся, grant-access НЕ вызывается** (доп. защита от двойного grant при webhook replay).
- Резолв `subv2` через `findSubByStripeId(invoice.subscription)`. Если нет → `manual_review` (`unknown_subscription`).
- Cross-account guard.
- Резолв `offer_id` через `tariff_offers WHERE tariff_id=subv2.tariff_id AND meta->stripe->>price_id = line.price.id`.
- INSERT `orders_v2`: provider='stripe', status='paid', `meta.stripe.invoice_id`, `meta.tracking_id=stripe_sub:{sub_id}:invoice:{invoice_id}`, `meta.subscription_v2_id`, `meta.provider_subscription_row_id`.
- INSERT `payments_v2` по `provider_payment_id=invoice.payment_intent` (с SELECT-guard).
- UPDATE `provider_subscriptions.order_id` + `last_charge_at` (важно для `provider-linked-extend-priority`).
- Promote `subv2.status: pending → active` (если это первая оплата).
- Вызов `grant-access-for-order { order_id, source:'stripe_webhook_invoice_paid', provider:'stripe' }` — extend подписки делает он сам через `provider-linked-extend-priority` + `extend-tariff-match-required`.
- `applyCrmStageOnTerminal('success')` — **через стандартный путь grant-access** (вызовом ниже по стеку), здесь явно не вызываем — оставляем единый source.
- Conflict: `no_subscription`, `unknown_subscription`, `subv2_missing`, `foreign_account` → `manual_review`. `invoice_paid_duplicate` → noop.

> **Замечание про `applyCrmStageOnTerminal('success')`:** Phase-2 ветки `checkout.session.completed` / `payment_intent.succeeded` вызывают `applyCrmStageOnTerminal` явно. Для подписочного пути CRM stage будет применён через стандартный путь `grant-access-for-order → orders_v2.status='paid'` (уже выставлен в INSERT) + последующие триггеры/инвокации. Если в Stage 2.5 G15 покажет, что stage не двинулся — добавим явный вызов в `onInvoicePaid` отдельным патчем (P-B2-CRM).

### C.5 `invoice.payment_failed` (`onInvoicePaymentFailed`)
- Если `subv2.status='active'` → `past_due`.
- Если `provider_subscriptions.state='active'` → `past_due`.
- **Доступ НЕ отзывается** (grace).
- **`applyCrmStageOnTerminal('failed')` НЕ вызывается** (зафиксировано в утверждённом плане: до отдельного Smart Retries / Dunning спринта).
- Audit фиксирует `attempt_count`, `next_payment_attempt`, `access_preserved: true`, `crm_stage_failed_skipped: true`.

---

## 4. Audit Trail (DoD)

Все 5 веток пишут `audit_logs` с обязательным набором полей:

```jsonc
{
  "action": "stripe.<event_type>.<result>",
  "actor_type": "system",
  "actor_label": "stripe-webhook",
  "entity_type": "subscriptions_v2" | "provider_events",
  "entity_id": "<subscription_v2_id | null>",
  "meta": {
    "event_id":                "evt_*",
    "event_type":              "<stripe event type>",
    "account_code":            "<resolved account_code>",
    "subscription_v2_id":      "<uuid | null>",
    "provider_subscription_id":"sub_* | pending:<uuid> | null",
    "result":                  "ok | noop | manual_review | error | logged",
    "manual_review":           true | false,
    "manual_review_reason":    "<reason | null>",
    // + per-branch extras (invoice_id, order_id, period bounds, attempt_count, …)
  }
}
```

Stage 2.5 G16/G18 проверит: каждый prod event имеет соответствующую запись с этим shape.

---

## 5. Conflict Matrix

| Reason | C.1 | C.2 | C.3 | C.4 | C.5 | Result |
|---|---|---|---|---|---|---|
| `no_pre_created_sub` | ✓ | — | — | — | — | manual_review, no bind |
| `subv2_missing` | ✓ | ✓ | (no-op) | ✓ | (skip) | manual_review |
| `zombie_pending_subscription` | ✓ | — | — | — | — | manual_review, no bind |
| `unknown_subscription` | — | ✓ | ✓ | ✓ | ✓ | manual_review |
| `foreign_account` | ✓ | ✓ | ✓ | ✓ | — | manual_review |
| `invoice_paid_duplicate` | — | — | — | ✓ | — | noop, return existing order_id |
| `unknown_invoice_no_subscription` | — | — | — | ✓ | — | manual_review |
| Order INSERT error | — | — | — | ✓ | — | throw → provider_events.failed |
| `grant-access-for-order` failure | — | — | — | ✓ | — | audit logged, processing_status='processed' (retry via nightly reconcile) |

HTTP всегда **200** для conflict (так Stripe не ретраит бесконечно), `provider_events.processing_status='manual_review'` для админ-аудита.

---

## 6. Idempotency

| Уровень | Механизм |
|---|---|
| Event delivery | существующий `provider_events_idem_unique (provider, event_id)` (Phase 2) |
| Subscription bind (C.1) | поиск `findSubByStripeId(stripeSubId)` → `already_bound` noop |
| Activation (C.4) | **SELECT-before-INSERT** на `orders_v2.meta->stripe->>invoice_id` (B-2 утверждённый default; без миграций/индексов) |
| Payment (C.4) | существующий SELECT по `payments_v2.provider_payment_id` (Phase 2 паттерн) |
| Status sync (C.2/C.3/C.5) | UPDATE-only, не зависит от idempotency |

---

## 7. STOP-GATE compliance ✅

- [x] `grant-access-for-order` не модифицирован, только вызывается.
- [x] bePaid функции/RPC не затронуты.
- [x] `entitlements` / `access_rules` напрямую не трогаются.
- [x] Доступ нигде не revoke'аем.
- [x] Schedule (installment) ветки не реализованы (D2 backlog для finite).
- [x] `payment_method.*` / `customer.updated` не реализованы (см. backlog `stripe_saved_pm_followup`).
- [x] reconcile / events-replay не реализованы (Stage 4).
- [x] Новые таблицы / RPC / cron не созданы.
- [x] `supabase/config.toml` не изменён.
- [x] 6 существующих Phase 2 веток (`checkout.session.completed`, `payment_intent.*`, `charge.refunded`/`refund.*`, `checkout.session.expired`, `charge.dispute.created`) — нетронуты в логике, добавлен только верхний guard перед ними.

---

## 8. Регрессия Phase 2

Логика 6 существующих веток не модифицирована — изменён только верхний layer:
- добавлен early-return через резолвер для `STRIPE_SUBSCRIPTION_EVENT_TYPES`;
- если event.type не подписочный → старый код выполняется как раньше (включая `order_id_meta` guard, `meta_account_code` cross-check).

Tracking_id формат для подписочных orders: `stripe_sub:{sub_id}:invoice:{invoice_id}` (не пересекается с Phase 2 разовыми оплатами).

---

## 9. Stage 2.5 Runtime Proof Plan (TODO — отдельный шаг)

| ID | Сценарий | Ожидаемый PASS |
|---|---|---|
| G10 | Создание подписки в test mode → Stripe Checkout оплачен | `customer.subscription.created` → bind, `invoice.paid` → activated |
| G11 | invoice.paid duplicate replay через Stripe CLI | `invoice_paid_duplicate`, ровно 1 order/payment в БД |
| G12 | Cancel via Customer Portal (cancel_at_period_end=true) | `customer.subscription.updated.synced`, status остаётся active, `meta.stripe.cancel_at_period_end=true` |
| G13 | Subscription auto-cancelled после period_end | `customer.subscription.deleted.canceled` → status=canceled, доступ жив до expires_at |
| G14 | invoice.payment_failed (test clock, expired card) | `grace`, status → past_due, access preserved |
| G15 | Test renewal (test clock fast-forward 1 month) | новый `invoice.paid.activated`, `grant-access-for-order` extend через provider-linked-extend |
| G16 | audit_logs shape проверка | все 7 обязательных полей присутствуют |
| G17 | Foreign account event (другой webhook secret) | `manual_review:foreign_account`, no DB writes |
| G18 | bePaid non-regression 24h diff | 0 расхождений в orders/payments/subscriptions для provider='bepaid' |

---

## 10. Готовность к Stage 2.5

CODE COMPLETE. Ожидание approve пользователем перед запуском runtime proof через Stripe test clock + CLI.
