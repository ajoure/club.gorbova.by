# Phase 3.1 Stage 0 — Pre-MVP Webhook Contract Discovery

Дата: 2026-06-04
Статус: **PASS (discovery)** — контракт зафиксирован, переход к Stage 1 (Pre-create writer) разблокирован после approve.

## Назначение

Зафиксировать as-is контракт `stripe-webhook` и `stripe-create-checkout`, сопоставить с целевым контрактом Phase 3.1 MVP (5 новых event-классов + pending lifecycle + provider-linked extend) и явно перечислить gaps, которые будут закрыты в последующих этапах. Кода в этом этапе не пишем (add-only spec).

Связанные документы:
- `.lovable/discovery/stripe_subscriptions_capabilities_v1.md` (D1)
- `.lovable/discovery/stripe_subscriptions_object_mapping_v1.md` (D2)
- `.lovable/discovery/stripe_subscriptions_webhook_plan_v1.md` (D5)
- `.lovable/proofs/stripe_phase_3_1_0_pending_readers_audit_v1.md`
- `.lovable/proofs/stripe_phase_3_1_0b_pending_guard_discovery_v1.md`
- `.lovable/proofs/stripe_phase_3_1_3_gap_d_runtime_capability_v1.md` (GAP-D PASS)

---

## 1. As-Is: `stripe-webhook` (Phase 2, 554 LOC)

### 1.1 Обработчики (event_type → действие)

| Event | Действие | SOT-эффект |
|---|---|---|
| `checkout.session.completed` | profile customer cache sync (MP-A2-2), `mergeStripeMetaOnOrder`, `grant-access-for-order`, INSERT `payments_v2`, `transitionOrderPaid`, `applyCrmStageOnTerminal('success')` | order.status=paid; payments_v2 row; access granted; CRM stage |
| `payment_intent.succeeded` | `mergeStripeMetaOnOrder`, INSERT `payments_v2` (idem by `provider_payment_id`), `transitionOrderPaid`, `applyCrmStageOnTerminal('success')` | payment + paid transition |
| `payment_intent.payment_failed` | audit_logs only + `applyCrmStageOnTerminal('failed')` | CRM stage |
| `charge.refunded` / `refund.created` / `refund.updated` | RPC `record_refund_atomic_multi` (refund_uid идемпотентен) | refund row, partial/full refund state |
| `checkout.session.expired` | audit only | none |
| `charge.dispute.created` | audit only | none |

### 1.2 Идемпотентность

- Уникальный INSERT в `provider_events` с `idempotency_key='stripe:{account_code}:{event_id}'`. Конфликт `23505` → `200 skipped_duplicate`.
- Дополнительная дедупликация:
  - `payments_v2.provider_payment_id` (UNIQUE-маркер по `pi_*`/`ch_*`).
  - `orders_v2.status='paid' AND paid_amount>0` блокирует `transitionOrderPaid` повторно.
  - `record_refund_atomic_multi` (refund_uid).

### 1.3 Безопасность и multi-account

- Verify подписи перебором всех `acquiring_connections` (`provider='stripe'`, `status IN ('active','pending','invalid')`); первый успешный `verifyStripeSignature` фиксирует `verifiedAccount`.
- Cross-check: `metadata.account_code` ≠ `verifiedAccount` → `manual_review` + ранний 200 без dispatch.
- `verify_jwt=false` (public endpoint), RAW body парсится только после verify.

### 1.4 Adapter (`stripe-adapter.ts`, 110 LOC) — только `mode=payment`

Реализован `createCheckout()`:
- `mode=payment` (one-time), `line_items[0][price_data]`, metadata mirror в `payment_intent_data[metadata]`.
- `idempotencyKey='order:{order_id}'` на `/checkout/sessions`.
- Резолв customer: `customer_id` приоритетнее `customer_email`.
- `save_payment_method && customer_id` → `payment_intent_data[setup_future_usage]=off_session`.
- **НЕТ методов:** `createSubscriptionCheckout()`, `cancelSubscription()`, `retrieveSubscription()`, `createSchedule()`. Stripe Subscription API не вызывается ни из одного callsite в проекте, кроме `admin-stripe-subscription-capability-probe` (GAP-D, изолированный пробник).

### 1.5 `stripe-create-checkout` (entrypoint, 250 LOC)

- Требует `super_admin`.
- Требует `orders_v2` уже существует, `provider='stripe'`, `status IN ('pending','processing')`.
- Резолв `account_code` через `resolveDefaultStripeAccount` (без хардкода).
- Только sandbox (`test_mode=true`).
- Материализует `crm_routing_snapshot` + pipeline_pending на ордере **до** возврата URL.
- Sticky meta: `orders_v2.meta.stripe.{checkout_session_id, customer_id, account_code, business_stream}`.
- **НЕ создаёт** `subscriptions_v2 (pending)` и `provider_subscriptions (pending)` — нет writer'а под подписочный flow.

---

## 2. Целевой контракт Phase 3.1 MVP (5 event-классов)

### 2.1 Новые webhook ветки

| Event | Идемп.ключ | SOT-эффект | Conflict-policy → 200 manual_review |
|---|---|---|---|
| `customer.subscription.created` | `provider_events.event_id` + bind по `sub.id` | bind `provider_subscriptions.provider_subscription_id`, snapshot `subscriptions_v2.meta.stripe.*`, status sync | `no_pre_created_sub`, `foreign_account`, `sbs_mismatch` |
| `customer.subscription.updated` | `event_id` + last-write-wins по `period/cancel_at_period_end/default_payment_method` | meta sync; `status` пересчёт (active/past_due/canceled) | `unknown_subscription_id` |
| `customer.subscription.deleted` | `event_id` | `subscriptions_v2.status='canceled'`, `cancel_reason='stripe_subscription_deleted'`; **access не отзываем** (GREATEST через entitlement-sync) | `unknown_subscription_id` |
| `invoice.paid` | UNIQUE по `invoice.id` (`orders_v2.meta.stripe.invoice_id`), вторичный — `provider_events.event_id` | idempotent CREATE `orders_v2` (provider='stripe', subscription_id, tracking_id=`stripe_sub:{sub_id}:order:{order_id}`); call `grant-access-for-order`; INSERT `payments_v2` (idem by `pi.id`); `transitionOrderPaid`; CRM `success` | `unknown_subscription`, `tariff_mismatch`, `no_pre_created_sub` (первый invoice без bind) |
| `invoice.payment_failed` | `event_id` + `invoice.id` | `subscriptions_v2.status='past_due'` + audit; **access не отзываем**; CRM `failed` | `unknown_invoice_no_subscription` |

Все ветки идут через общий резолвер **`supabase/functions/_shared/stripe-subscription-resolver.ts`** (новый файл, появится в Stage 2). Reconcile/replay используют тот же резолвер для 1-в-1 поведения.

### 2.2 Pending lifecycle (4 точки)

1. **CREATE pending** — только `stripe-create-subscription-checkout` (новая edge, Stage 1). Pre-create `subscriptions_v2(status='pending', billing_type='provider_managed', meta.stripe.account_code, meta.amount_byn, meta.currency='BYN', meta.tariff_access_days)` + `provider_subscriptions(state='pending', provider='stripe', meta.account_code, tracking_id='stripe_sub:{subv2_id}:order:pending')`.
2. **pending → active** — первый `invoice.paid` ИЛИ `customer.subscription.created` (whichever wins). Атомарный `UPDATE subscriptions_v2 SET status='active' WHERE id=$1 AND status='pending' RETURNING *` (защита от race).
3. **Stale pending** — нет `customer.subscription.created` за `PENDING_TTL_MS=24h` от `subscriptions_v2.created_at`.
4. **Cleanup** — `admin-cleanup-stale-pending-subscriptions` расширяется фильтром `provider='stripe'`:
   - `UPDATE subscriptions_v2 SET status='canceled', auto_renew=false, meta=jsonb_set(meta,'{stripe,pending_cleanup_at}', now())`
   - `DELETE FROM provider_subscriptions WHERE state='pending' AND provider='stripe' AND subscription_v2_id=$1`
   - audit_logs `stripe.pending_cleanup`.

Pre-check `checkPendingCheckoutConflict({user_id, product_id, tariff_id, provider:'stripe'})` обязателен **перед** `INSERT pending` (см. `mem://commercial-logic/subscriptions/duplicate-subscription-prevention-guard`).

### 2.3 Provider-linked extend (re-use стандарта)

`grant-access-for-order` уже использует приоритет provider-linked → legacy (см. `mem://architecture/fulfillment/provider-linked-extend-priority`). Stripe-ветка соблюдает тот же контракт:
- Lookup через `provider_subscriptions(provider='stripe', state IN ('active','pending'))` по `meta.tracking_id` строгий regex `^stripe_sub:{uuid}:order:{uuid|pending}$`.
- Совпадение `(user_id, product_id, tariff_id)` обязательно. Иначе → `manual_review_provider_linkage_conflict`, HTTP 200 skipped.

---

## 3. Gaps между as-is и target

| Gap | Где закрывается | Этап |
|---|---|---|
| G1. Нет `stripe-create-subscription-checkout` edge | Новый файл | Stage 1 |
| G2. `stripe-adapter` не имеет `createSubscriptionCheckout()` | Расширение адаптера (add-only) | Stage 1 |
| G3. Нет `_shared/stripe-subscription-resolver.ts` | Новый файл — общий resolver для webhook/reconcile/replay | Stage 2 |
| G4. `stripe-webhook` не диспатчит 5 новых event-типов | Add-only ветки + dispatch table | Stage 2 |
| G5. `admin-cleanup-stale-pending-subscriptions` не различает provider | Расширение фильтром `provider='stripe'` | Stage 1 (вместе с pre-create) |
| G6. Нет `stripe-subscriptions-reconcile`/`stripe-events-replay` | Lost Webhook Recovery (D5) | Stage 4 |
| G7. Нет integration tests для 5 событий | tests harness через `supabase--curl_edge_functions` + fixture replay | Stage 3 |

---

## 4. STOP-GATE Idempotency Contract

Для каждой из 5 новых веток обязателен runtime-тест Stage 3:

1. Доставить event 2 раза подряд (одинаковый `event.id`).
2. Diff по `orders_v2 / payments_v2 / subscriptions_v2 / entitlements / access_grant_ledger / telegram_access_queue` за окно теста = **0 new rows** на 2-й доставке.
3. `provider_events` второй INSERT возвращает `23505` → ответ `200 skipped_duplicate`.

Ключи дедупликации (повторно от D5):
- `invoice.id` (для `invoice.paid`/`invoice.payment_failed`)
- `subscription.id` (для `customer.subscription.*` — bind/lookup)
- `payment_intent.id`, `charge.id` (уже на месте)
- `event_id` (универсальный, `provider_events_idem_unique`)

Дополнительно: атомарный pending→active через `UPDATE ... WHERE status='pending' RETURNING` исключает гонку «обе ветки одновременно поднимают подписку».

---

## 5. bePaid Non-Regression Contract

Перед каждым merge в Stage 1/2/3 обязательно:
- `rg "bepaid" supabase/functions/stripe-*` = **0 hits** в новых файлах.
- Diff по `provider_subscriptions WHERE provider='bepaid'` и `orders_v2 WHERE provider='bepaid'` за окно прогона = **0** строк, изменённых функциями Stripe-ветки.
- `bepaid-webhook`, `bepaid-create-subscription*`, `bepaid-admin-create-subscription-link`, `payments-reconcile` НЕ модифицируются.

---

## 6. Stage 0 DoD

- [x] As-is контракт `stripe-webhook` зафиксирован (6 типов, идемп.ключи, multi-account verify).
- [x] As-is контракт `stripe-create-checkout` зафиксирован (нет pre-create subv2/ps).
- [x] Target контракт 5 новых событий перечислен с идемп.ключами и conflict-policies.
- [x] Pending lifecycle (4 точки) расписан, увязан с `subscription-conflict.ts`, `admin-cleanup-stale-pending-subscriptions`, schema contract (`mem://architecture/payments/subscriptions-v2-schema-contract`).
- [x] STOP-GATE Idempotency и bePaid non-regression формализованы.
- [x] Gaps G1–G7 разнесены по этапам Stage 1–4.

## 7. Запрос approve

Stage 0 = PASS. Прошу подтвердить переход к **Stage 1: Pre-create writer + adapter extension**:
1. `supabase/functions/stripe-create-subscription-checkout/index.ts` (new edge).
2. `_shared/acquiring/stripe-adapter.ts` add-only `createSubscriptionCheckout()`.
3. `admin-cleanup-stale-pending-subscriptions` filter `provider='stripe'`.
4. Подключение `checkPendingCheckoutConflict` перед `INSERT pending`.
5. Discovery proof Stage 1 (pre-create flow happy-path + duplicate-guard + stale-pending cleanup).

Никаких изменений `stripe-webhook` в Stage 1 (webhook диспатч ветки идут в Stage 2).
