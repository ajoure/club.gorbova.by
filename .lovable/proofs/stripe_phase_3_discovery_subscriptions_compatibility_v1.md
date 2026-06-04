# Stripe Phase 3 — Discovery Subscriptions Compatibility Map (v1)

**Тип:** Discovery, read-only анализ. Кода, миграций, схемных изменений, edge-function deployment — нет.
**Scope:** Stripe Subscriptions (recurring) поверх существующей подписочной архитектуры bePaid.
**Mode:** Анализ под test-mode pilot, без касания live mode и bePaid.
**Дата:** 2026-06-04.
**Базис:** Stage C Runtime Pilot (one-time) — 10/10 PASS. PRR — 13/13 PASS.

> Этот документ — карта совместимости. Все «recommendation» в нём — для будущих отдельных планов Phase 3 Execution. Из этого Discovery НИЧЕГО не подлежит немедленной реализации.

---

## 0. Использованные источники (фактический code-read)

| Объект | Файл / схема |
|---|---|
| `subscriptions_v2` | live schema (33 поля) |
| `provider_subscriptions` | live schema (20 полей, `provider` default `'bepaid'`) |
| `subscription_status` enum | `{active, trial, past_due, canceled, expired, superseded, expired_reentry}` |
| Conflict guard | `supabase/functions/_shared/subscription-conflict.ts` |
| Fulfillment | `supabase/functions/grant-access-for-order/index.ts` (+ `provider_linked_subscription_resolver.ts`, `sbs_mismatch_guard.ts`, `three_ds_writer.ts`) |
| Self-service actions | `supabase/functions/subscription-actions/index.ts` (cancel, check-resume, resume, change-payment-method) |
| Nightly | `supabase/functions/access-rules-nightly-reconcile/index.ts` |
| bePaid recurring writer | `supabase/functions/bepaid-create-subscription-checkout/index.ts` |
| Stripe one-time writer | `supabase/functions/stripe-create-checkout/index.ts` |
| Stripe webhook | `supabase/functions/stripe-webhook/index.ts` (handles `checkout.session.completed`, `payment_intent.*`, `charge.refunded`, `refund.*`) |
| Memory canons | Extend↔Tariff Match, Provider-Linked Extend Priority, Recurring Snapshot Resolver SOT, Auto-Renewals Cohort SOT, INV-22 Desync Resolution, Resume 3-Level Eligibility, Auto-Renew Logic Standard v2, bePaid Webhook Parity, bePaid active_to Overshoot Guard, SBS Mismatch No-New-Sub Guard, Installment Public Link = finite bePaid subscription |

---

## 1. Subscription SOT Matrix

| Сущность | SOT (источник истины) | Кто пишет | Кто читает | Stripe-эквивалент |
|---|---|---|---|---|
| `subscriptions_v2` | local DB, единственный SOT recurring-доступа | `grant-access-for-order`, `bepaid-webhook`, `subscription-actions`, `subscriptions-reconcile` | UI кабинета, nightly, conflict guard, broadcasts, telegram-renewal | Не существует; Stripe Subscription отражается, но не заменяет |
| `provider_subscriptions` | local DB, mirror провайдерского состояния | `bepaid-webhook`, `bepaid-create-subscription-checkout` | conflict guard, resume eligibility, INV-22 | Должен быть mirror `stripe.Subscription` (`sub_xxx`) |
| `entitlements` | local DB, технический визибилити-снимок | `entitlement-sync.ts` (через `grant-access-for-order`) | access-resolver, UI кабинета | Не существует, не дублировать |
| Access window (`access_start_at`/`access_end_at`) | `grant-access-for-order` SOT (см. memory `bePaid active_to Overshoot Guard`) | `grant-access-for-order` (canonical write-path) | UI, telegram, secondary grants | Stripe `current_period_start/end` — read-only сигнал, не SOT |
| `orders_v2` | local DB, commercial entity SOT | writers (`bepaid-create-subscription-checkout`, `stripe-create-checkout`), `bepaid-webhook`, `stripe-webhook` | grant, CRM, refunds | Stripe `Invoice` ≠ order; mapping: 1 invoice → 1 order |
| Stripe `Customer` (`cus_xxx`) | Stripe API, mirror в `acquiring_connections` через resolver (`stripe-customer-resolver.ts`) | `stripe-create-checkout` | `subscription-actions`, future Customer Portal | Per (user_id, account_code) — уже реализован |
| `PaymentMethod` (`pm_xxx`) | Stripe (default_payment_method у Subscription/Customer) + локальный mirror в `payment_methods` | `payment-methods-tokenize`, `payment-methods-webhook` | resume guard, change-payment-method | Для Stripe `subscription.default_payment_method` — авторитет |
| Stripe Subscription (`sub_xxx`) | Stripe API | webhook | `provider_subscriptions` (mirror) | Новый источник, mirror only |
| Stripe Invoice (`in_xxx`) | Stripe API | webhook (`invoice.*`) | `orders_v2` (1:1 на каждую успешную оплату цикла) | Renewal => новый `orders_v2` запись |
| Stripe PaymentIntent (`pi_xxx`) | Stripe API | webhook | `payments_v2` | Уже работает для one-time |

**Ключевой принцип:** `subscriptions_v2` остаётся ЕДИНСТВЕННЫМ SOT recurring-доступа. Stripe Subscription — это remote authoritative state, который mirror-ится в `provider_subscriptions`. Никаких новых SOT не вводим.

---

## 2. Stripe event → our action

Канон: webhook идемпотентен через `provider_events ON CONFLICT (idempotency_key) DO NOTHING` (уже реализовано в `stripe-webhook`).

| Stripe event | provider_events | subscriptions_v2 | provider_subscriptions | orders_v2 | grant-access-for-order | manual_review когда |
|---|---|---|---|---|---|---|
| `checkout.session.completed` (mode=subscription) | INSERT idempotent | UPDATE pre-created row: link `sub_xxx`, status `pending → active`, set `access_start_at` | UPSERT (provider='stripe', `provider_subscription_id=sub_xxx`, state='active', `subscription_v2_id=<pre-created>`, `order_id=<first order>`) | UPDATE first order status `pending → paid`, set `provider_payment_id=pi_xxx` | **YES** (как для bePaid first payment) | session не найден локально / mismatch user_id/product_id/tariff_id (по аналогии с SBS Mismatch Guard) |
| `customer.subscription.created` | INSERT idempotent | (no-op, уже создан pre-record) | UPSERT (interval_days из items.price.recurring.interval, amount_cents, card_brand/last4 из default_payment_method) | — | — | sub отсутствует в `provider_subscriptions` после tolerance (race с checkout.session.completed) |
| `customer.subscription.updated` | INSERT idempotent | UPDATE: `cancel_at` (если `cancel_at_period_end=true`), `next_charge_at` (`current_period_end`), `auto_renew` (`!cancel_at_period_end`), `status` (mapping: stripe `active`→local `active`, `past_due`→`past_due`, `unpaid`→`past_due`, `canceled`→`canceled`, `incomplete`→pending state — НЕ active) | UPDATE state, next_charge_at, raw_data | — | — | local sub не найден; status mapping не определён; tariff_id меняется (нельзя) |
| `customer.subscription.deleted` | INSERT idempotent | UPDATE status → `canceled` или `expired` в зависимости от `canceled_at` vs `current_period_end`. **Доступ НЕ отзывается** (canon: keep_access_until_trial_end / cancel_at logic) | UPDATE state='canceled' | — | — | local sub не найден |
| `invoice.created` | INSERT idempotent | — | — | — | — | informational only |
| `invoice.finalized` | INSERT idempotent | — | — | — | — | informational only |
| `invoice.paid` (renewal) | INSERT idempotent | UPDATE: `access_end_at` = `current_period_end` (через grant-access SOT; см. overshoot guard аналог), `next_charge_at`, `charge_attempts=0`, `grace_period_*=null` | UPDATE last_charge_at, next_charge_at, state='active' | INSERT new order (renewal): `provider='stripe'`, `status='paid'`, `paid_amount=invoice.amount_paid/100`, linked via `meta.stripe.invoice_id` | **YES** (renewal must trigger grant — canon `Renewal Secondary Grants`) | tariff_id mismatch на subscription items (canon: extend only on tariff match → иначе manual_review, НЕ создавать новую sub) |
| `invoice.payment_failed` | INSERT idempotent | UPDATE: `charge_attempts++`, при `attempt_count >= N` → status=`past_due`, `grace_period_started_at=now`, `grace_period_status='active'` | UPDATE state='past_due', `raw_data` | INSERT failed-charge order (`status='failed'`) для аудита | — (no access change in grace) | exhausted retries без status update |
| `invoice.payment_action_required` | INSERT idempotent | UPDATE meta.requires_action=true (для UI notification) | UPDATE state='requires_action' | — | — | persistent >24h |
| `charge.refunded` / `refund.*` | INSERT idempotent | — (статус подписки не меняется автоматически) | — | UPDATE через `record_refund_atomic_multi` (уже реализовано для Stripe one-time в Stage C) | — | refund > paid_amount; refund на несуществующий order |

**Доп. правила:**
- Идемпотентность: уже обеспечена `provider_events.idempotency_key` (`event.id`).
- Order ID для renewal: deterministic generation (например, `STRIPE-{invoice_id}` mapped в `orders_v2.order_number`) — иначе нарушение Commercial Entity SOT.
- `payment_flow` в `orders_v2.meta`: `'stripe_subscription_first'` для первого order, `'stripe_subscription_renewal'` для последующих. Это критично для canon `Auto-Renew Logic Standard v2`.

---

## 3. First payment vs Renewal

### 3.1. First payment (subscription checkout)

```
User -> stripe-create-subscription-checkout (NEW)
  -> classifySameProductState (cross-provider) -> no_existing
  -> orders_v2 INSERT (status=pending, payment_flow='stripe_subscription_first')
  -> subscriptions_v2 INSERT (status=pending/incomplete, NO access yet)
  -> Stripe Checkout Session create (mode=subscription, customer_id, line_items=[{price=<recurring_price>}], subscription_data.metadata={subv2_id, order_id, product_id, tariff_id, user_id})
  -> redirect URL

User completes payment
  -> webhook checkout.session.completed
     -> orders_v2 UPDATE status=paid, paid_amount, provider_payment_id=pi_xxx
     -> provider_subscriptions UPSERT (provider='stripe', sub_xxx, state='active', subscription_v2_id, order_id)
     -> subscriptions_v2 UPDATE status='active', access_start_at, access_end_at via grant
     -> grant-access-for-order CALL (resolves recurring SOT, creates entitlement, secondary grants, telegram)
```

Соответствует canon `Provider-Linked Extend Priority`: webhook ищет subv2 через `provider_subscriptions` по `order_id` или `meta.tracking_id=subv2:{uuid}:order:{uuid}`. **Tracking_id pattern должен быть одинаковый для bePaid и Stripe** (полная совместимость).

### 3.2. Renewal (automatic next-cycle charge)

```
Stripe -> charges card automatically
  -> webhook invoice.paid (event includes subscription=sub_xxx, lines.data[].price.id, period.end)
     -> resolve subscriptions_v2 by provider_subscriptions.provider_subscription_id=sub_xxx
     -> STOP-guard: tariff match (price.id ↔ tariff offer recurring snapshot)
       - mismatch → manual_review (canon SBS Mismatch No-New-Sub Guard), HTTP 200, no order, no extend
     -> orders_v2 INSERT (status='paid', payment_flow='stripe_subscription_renewal',
        meta.stripe.invoice_id, order_number=deterministic from invoice)
     -> grant-access-for-order CALL (extend same subv2, tariff match → extend)
     -> provider_subscriptions UPDATE last_charge_at, next_charge_at
```

Соответствует canon `Renewal Secondary Grants`: каждый успешный renewal должен пройти через grant-access-for-order.

### 3.3. Failed renewal

```
webhook invoice.payment_failed
  -> subscriptions_v2: charge_attempts++, при threshold → status='past_due', grace_period_*
  -> provider_subscriptions: state='past_due'
  -> NO orders_v2 paid INSERT (опционально: failed-charge audit row)
  -> grace_period_* aligns с локальной retry policy (НЕ Stripe Smart Retries; либо мы доверяем Stripe Smart Retries — это решение для Phase 3 Execution mini-plan)
```

### 3.4. Cancellation

Два сценария:
- **cancel_at_period_end (recommended)**: Stripe sets `cancel_at_period_end=true`, генерит `customer.subscription.updated` → local `cancel_at` устанавливается, `auto_renew=false`, доступ сохраняется до `access_end_at`.
- **immediate**: Stripe генерит `customer.subscription.deleted` → local status='canceled', `canceled_at`, но **доступ keep до `access_end_at`** (canon `Club Status Integrity`).

### 3.5. Resume

См. §5 ниже (требует расширения 3-Level Eligibility для Stripe).

---

## 4. Duplicate subscription guard (cross-provider)

### Текущее состояние (`_shared/subscription-conflict.ts`)
- `CONFLICTING_STATUSES = ['active','trial']`
- `BLOCKING_PROVIDER_STATES = ['active']`
- Provider hardcoded: `.eq('provider','bepaid')` в `checkSubscriptionConflict` и `classifySameProductState`.

### Cross-provider матрица (целевая)

| Существующий active | Новый запрос | Ожидаемое поведение |
|---|---|---|
| bePaid active | bePaid (тот же tariff) | `extend_same_tariff` (HTTP 200, no new sub) |
| bePaid active | bePaid (другой tariff) | `replace_other_tariff` → требует explicit `replacement_of_subscription_v2_id` |
| bePaid active | **Stripe (любой)** | **БЛОК**: `cross_provider_conflict` (HTTP 200, no order, manual_review audit) |
| Stripe (account A) active | **Stripe (account A, same tariff)** | `extend_same_tariff` |
| Stripe (account A) active | **Stripe (account A, другой tariff)** | `replace_other_tariff` |
| Stripe (account A) active | **Stripe (account B, любой)** | **БЛОК**: `cross_account_conflict` (multi-account Stripe не разрешён для одного product_id) |
| Stripe active | **bePaid** | **БЛОК**: `cross_provider_conflict` |

### Изменения, нужные в `subscription-conflict.ts` (Phase 3 Execution, НЕ сейчас)
- Снять hardcoded `.eq('provider','bepaid')` → расширить до `IN ('bepaid','stripe')` для общего `checkSubscriptionConflict`.
- Добавить новую функцию `classifyCrossProviderConflict(supabase, {user_id, product_id, new_provider, new_account_code})`, возвращающую decision `{no_conflict | extend_same_tariff | replace_other_tariff | cross_provider_block | cross_account_block}`.
- Все три точки (bePaid writer, новый Stripe writer, INV-style reconcile) обязаны вызвать новую функцию.

**Status:** compatible with add-only extension.

---

## 5. Customer Portal subscription actions (MVP self-service)

**Решение архитектуры:** MVP self-service для Stripe = Stripe Customer Portal (НЕ собственный UI для Stripe-specific actions; собственный UI остаётся для bePaid + унифицированной cancel/resume семантики через нашу БД, отражаемой webhook'ами).

### Действия пользователя в Portal и их отражение

| Portal action | Stripe event | Local effect | Edge handler |
|---|---|---|---|
| Update payment method | `customer.subscription.updated` (default_payment_method changed), `payment_method.attached` | UPDATE `subscriptions_v2.payment_method_id`, `payment_methods` mirror | `stripe-webhook` (extend handler) |
| Cancel subscription (at period end) | `customer.subscription.updated` (`cancel_at_period_end=true`) | UPDATE `cancel_at=current_period_end`, `auto_renew=false`, `canceled_by='user_portal'` | `stripe-webhook` |
| Resume canceled (before period end) | `customer.subscription.updated` (`cancel_at_period_end=false`) | UPDATE `cancel_at=null`, `auto_renew=true`, `meta.resumed_at` | `stripe-webhook` |
| Update billing email | `customer.updated` | UPDATE `acquiring_connections` mirror (optional) | future |
| Download invoices | — | — | Portal handles natively |
| Switch plan | `customer.subscription.updated` (items.price changed) | STOP-guard: tariff change requires app approval. Реализация: Portal `allowed_updates` НЕ включает `price` (admin-config). | Portal config |

### Канонические события для Stripe webhook (Phase 3 Execution must add)

```
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
invoice.payment_action_required
payment_method.attached
payment_method.detached
customer.updated
```

`charge.refunded`, `payment_intent.*`, `checkout.session.completed` — уже реализованы.

**Portal session creation:** новый edge function `stripe-create-portal-session` (super_admin или JWT user, return_url из `PUBLIC_APP_HOST`). Это безопасный thin wrapper, без изменений SOT.

---

## 6. No schema change assumption

### Аудит: можно ли реализовать Phase 3 Stripe Subscriptions без новых колонок?

| Требуемое поле | Уже существует? | Где хранить |
|---|---|---|
| Stripe Subscription ID (`sub_xxx`) | да | `provider_subscriptions.provider_subscription_id` (`text NOT NULL`) |
| Stripe Customer ID | да | `acquiring_connections` resolver (`stripe-customer-resolver.ts`) + `subscriptions_v2.meta.stripe.customer_id` |
| Stripe Invoice ID | да | `orders_v2.meta.stripe.invoice_id` |
| Stripe Price ID | да | `provider_subscriptions.meta.stripe.price_id` |
| `cancel_at_period_end` | да | `subscriptions_v2.cancel_at` (timestamptz) + `auto_renew=false` |
| Stripe `current_period_start/end` | да | `subscriptions_v2.access_start_at/access_end_at` + `provider_subscriptions.next_charge_at` |
| Account code (multi-account Stripe) | да | `provider_subscriptions.meta.stripe.account_code` |
| `provider` discriminator | да | `provider_subscriptions.provider` (text default 'bepaid' — default нужно убрать или переопределить per-insert; см. ниже) |

### STOP-flag (требует mini-plan если подтвердится)
- `provider_subscriptions.provider` имеет default `'bepaid'`. Insert от Stripe **должен явно передавать** `provider='stripe'`. Это уже соблюдается семантически в bePaid коде (явный `'bepaid'`), но Stripe writer должен быть симметричен. Менять default НЕ требуется — это compatible as-is при дисциплине writer.
- `interval_days integer DEFAULT 30` — для Stripe weekly/yearly интервалов нужно либо вычислять (interval='week' → 7), либо хранить interval+interval_count. **Решение:** хранить `interval_days` через расчёт из `interval` + `interval_count`. Совместимо с текущей схемой.

**Подтверждение:** **No schema change required**. Phase 3 Stripe Subscriptions реализуется через `meta.*` JSONB + дисциплину writers. Если в ходе Execution обнаружится потребность в новой колонке (например, `provider_account_code` как first-class для индексации) — STOP и отдельный schema mini-plan.

---

## 7. Testing strategy (test-mode)

### Инструменты
- **Stripe Test Clock**: первичный инструмент. Позволяет advance time на subscription/customer без ожидания реального месяца. Доступен только в test mode.
- **Stripe Test Cards**: `4242 4242 4242 4242` (success), `4000 0000 0000 9995` (insufficient funds → invoice.payment_failed), `4000 0025 0000 3155` (3DS challenge → payment_action_required), `4000 0000 0000 0341` (succeeds first then fails on subscription).
- **Stripe CLI webhook forward**: не нужен — наш webhook принимает реальные test-mode события из Stripe.

### Сценарии (минимум для Phase 3 runtime pilot)

| # | Сценарий | Инструмент |
|---|---|---|
| T1 | First payment + entitlement grant | Test card 4242, ручная оплата |
| T2 | Successful renewal | Test Clock advance на 1 период → invoice.paid |
| T3 | Failed renewal + retry | Test card 9995, Test Clock advance до period end |
| T4 | cancel_at_period_end + still has access | Portal cancel → Test Clock advance → assert access until period end |
| T5 | Resume before period end | Portal reactivate → assert auto_renew=true |
| T6 | Finite cycles (N=3) — для будущей installment-via-Stripe | Subscription Schedule + Test Clock × 3 (ОТЛОЖЕНО в Phase 3 step 6) |
| T7 | 3DS required first payment | Card 3155 |
| T8 | Cross-provider conflict (bePaid active → Stripe blocked) | Manual setup + attempt |
| T9 | Webhook replay idempotency | `bepaid-webhook-replay` equivalent для Stripe (re-deliver same event.id → 200 skipped_duplicate) |

### Принципы
- Test Clock — обязателен. Без него runtime pilot невозможен в рамках одной сессии.
- Никаких боевых ключей. Все сценарии — test-mode (`pk_test_*`/`sk_test_*`).
- Каждый сценарий должен оставлять trace: `provider_events` row + `audit_logs` entry + `subscriptions_v2`/`provider_subscriptions` snapshot.

---

## 8. bePaid recurring freeze check

**Подтверждение замороженных компонентов** (NEVER touch при Phase 3 Execution):

| Файл / путь | Статус |
|---|---|
| `supabase/functions/bepaid-webhook/` | FROZEN |
| `supabase/functions/bepaid-create-subscription-checkout/` | FROZEN |
| `supabase/functions/bepaid-create-subscription/` | FROZEN |
| `supabase/functions/bepaid-admin-create-subscription-link/` | FROZEN |
| `supabase/functions/bepaid-cancel-subscriptions/` | FROZEN |
| `supabase/functions/bepaid-subscription-audit*/` | FROZEN |
| `supabase/functions/bepaid-get-subscription-details/` | FROZEN |
| `supabase/functions/bepaid-list-subscriptions/` | FROZEN |
| `supabase/functions/bepaid-sync-orchestrator/` | FROZEN |
| `supabase/functions/subscription-charge/` (bePaid charge cron) | FROZEN |
| `supabase/functions/subscription-renewal-reminders/` | FROZEN (логика чтения чувствительна к provider — но изменений не вносим) |
| `supabase/functions/subscription-grace-reminders/` | FROZEN |
| `supabase/functions/subscriptions-reconcile/` | FROZEN |
| `provider_subscriptions` rows где `provider='bepaid'` | FROZEN (никаких массовых UPDATE на cohort'е) |
| `_shared/bepaid-*` | FROZEN |
| All bePaid cron jobs (`bepaid-queue-cron`, `bepaid-receipts-cron`, etc.) | FROZEN |

**Допустимые касания shared-кода (с явным flag-gating per provider):**
- `_shared/subscription-conflict.ts` — расширение провайдер-фильтра (`IN ('bepaid','stripe')`), но семантика для bePaid не меняется.
- `grant-access-for-order/index.ts` — добавление Stripe-aware ветки в `provider_linked_subscription_resolver.ts` (provider-agnostic lookup); bePaid path не модифицируется.
- `subscription-actions/index.ts` — see §10 step 3 (Customer Portal preferred path для Stripe, локальная отмена остаётся для bePaid).

---

## 9. Implementation Recommendation (порядок Phase 3 Execution)

Это **рекомендация порядка**, не код. Каждый шаг требует отдельного approve.

1. **Infinite Subscription MVP**
   - `stripe-create-subscription-checkout` edge function (admin-only, test-mode).
   - Расширение `subscription-conflict.ts` (provider-agnostic + cross-account guard).
   - Webhook handlers: `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`.
   - Pre-create `subscriptions_v2` + `provider_subscriptions` rows.
   - `grant-access-for-order` provider-aware ветка через `provider_linked_subscription_resolver`.

2. **Runtime proof (Stage D Pilot)**
   - Sandbox продукт-эквивалент консультации, но recurring.
   - T1, T2, T3 (test clock), T7, T9.
   - Proof: `.lovable/proofs/stripe_phase_3_runtime_pilot_subscription_v1.md`.

3. **Customer Portal actions**
   - `stripe-create-portal-session`.
   - Portal config (allowed_updates: payment_method, cancel; NOT price).
   - Webhook handlers полные (cancel_at_period_end mirror, resume mirror).
   - T4, T5.

4. **Failed payment / dunning**
   - `invoice.payment_failed` retry policy alignment с локальным `grace_period_*`.
   - `subscription-grace-reminders` совместимость для provider='stripe'.
   - Решение: использовать Stripe Smart Retries (default) или собственный cron — отдельный mini-decision.

5. **Reconcile**
   - Расширение `subscriptions-reconcile` для provider='stripe' (pull `stripe.Subscription.list`, diff с локальным state).
   - `access-rules-nightly-reconcile` — provider-agnostic уже (читает `subscriptions_v2.status='active'` без фильтра по провайдеру), но требует verify, что Stripe-rows не дают false-positive secondary grants.

6. **Subscription Schedule / finite installments**
   - ОТЛОЖЕНО. Только после стабильного infinite-flow.
   - Аналог bePaid `billing_cycles=N` (canon `Installment Public Link = finite bePaid subscription`).

---

## 10. Per-component compatibility status

Легенда:
- **CAS** — compatible as-is
- **CAE** — compatible with add-only extension
- **MP** — requires mini-plan
- **BL** — blocked

| # | Компонент | Status | Комментарий |
|---|---|---|---|
| 1 | `subscriptions_v2` schema | CAS | Все нужные поля есть; `meta` JSONB достаточно для Stripe-specific атрибутов |
| 2 | `provider_subscriptions` schema | CAS | `provider='stripe'` + `provider_subscription_id=sub_xxx` достаточно |
| 3 | `subscription_status` enum | CAS | `{active,trial,past_due,canceled,expired,superseded,expired_reentry}` покрывает Stripe states через mapping |
| 4 | `grant-access-for-order` | CAE | Add provider-aware ветка в `provider_linked_subscription_resolver.ts` (lookup без фильтра по провайдеру); основной flow recurring snapshot SOT работает as-is |
| 5 | `subscription-conflict.ts` (`checkSubscriptionConflict`, `classifySameProductState`) | CAE | Снять hardcoded `.eq('provider','bepaid')`; добавить cross-account check |
| 6 | `subscription-actions` (cancel/resume/change-pm) | MP | Для Stripe — defer to Customer Portal (preferred); локальный UI оставить для bePaid. Resume 3-Level Eligibility расширить provider-aware check |
| 7 | `access-rules-nightly-reconcile` | CAS | Provider-agnostic (читает все active subscriptions_v2 без provider filter) |
| 8 | Extend↔Tariff Match SOT (canon) | CAS | Применяется к любой подписке независимо от провайдера; в Stripe реализуется через price.id ↔ tariff_offer mapping |
| 9 | `stripe-webhook` (existing handlers) | CAE | Add subscription event handlers; existing one-time/refund handlers не меняем |
| 10 | `stripe-create-checkout` (one-time) | CAS | НЕ трогать; для subscription создаётся новая функция `stripe-create-subscription-checkout` |
| 11 | `acquiring_connections` (multi-account Stripe) | CAS | Уже поддерживает; resolver `default-account.ts` + `stripe-customer-resolver.ts` готовы |
| 12 | `provider_events` (idempotency) | CAS | Универсальный механизм, работает для любых Stripe events |
| 13 | `record_refund_atomic_multi` RPC | CAS | Уже работает для Stripe one-time (Stage C); subscription refunds через тот же RPC |
| 14 | CRM routing (`crm-routing.ts`) | CAS | Снимок materialize-ится для любого order (one-time или renewal) |
| 15 | `payment_methods` mirror | CAE | Расширить `payment-methods-webhook` для Stripe `payment_method.attached/detached` |
| 16 | Customer Portal session creation | MP | Новый edge function (small); требует mini-plan на config (allowed_updates, return_url) |
| 17 | `subscriptions-reconcile` for Stripe | MP | Полностью новый pull-path; нельзя расширять bePaid-функцию без freeze check |
| 18 | `subscription-grace-reminders` / `renewal-reminders` | MP | Provider-aware: Stripe handles dunning natively → подумать, дублировать ли локальные напоминания |
| 19 | Telegram renewal sync (canon) | CAS | Триггерится из `grant-access-for-order` независимо от провайдера |
| 20 | Stripe Subscription Schedule (finite N) | BL до отдельного approve | Только Phase 3 step 6 |
| 21 | Live mode | BL | Не включать ни в Phase 3 Execution, ни в Phase 3 runtime pilot |
| 22 | Переключение существующих bePaid-подписок на Stripe | BL | Не входит в scope Phase 3; миграция cohort'а — отдельный долгосрочный план |

---

## 11. Gap list (что отсутствует и требует Phase 3 Execution)

| Gap | Тип | Phase 3 step |
|---|---|---|
| Edge function `stripe-create-subscription-checkout` | new | 1 |
| Edge function `stripe-create-portal-session` | new | 3 |
| Webhook handlers: `customer.subscription.created/updated/deleted`, `invoice.created/finalized/paid/payment_failed/payment_action_required`, `payment_method.attached/detached`, `customer.updated` | new (in existing file) | 1, 3 |
| `subscription-conflict.ts` cross-provider extension | extension | 1 |
| `provider_linked_subscription_resolver.ts` — снять bePaid filter | extension | 1 |
| Stripe-aware reconcile (`stripe-subscriptions-reconcile`) | new | 5 |
| Stripe Test Clock orchestration (для runtime pilot) | external (Stripe API direct) | 2 |
| Price ID ↔ tariff_offer mapping (где хранить) | architecture decision (mini-plan) | 1 |
| Stripe Subscription metadata schema (что класть в `subscription.metadata`) | architecture decision (mini-plan) | 1 |
| `subscription-actions` provider routing (bePaid local vs Stripe Portal) | extension | 3 |
| Provider-aware audit_logs actor_label naming | extension | 1 |

---

## 12. STOP-guards для Phase 3 Execution

1. Любое изменение в `bepaid-*` — STOP, требует отдельного approve и обоснования.
2. Любое изменение схемы (`ALTER TABLE`, новый column, новая таблица) — STOP, требует schema mini-plan.
3. Любая попытка mass UPDATE на `subscriptions_v2` / `provider_subscriptions` существующих rows — STOP.
4. Любое включение live mode — STOP до Phase 10 Final Regression.
5. Любая попытка ускоренной реализации Subscription Schedule до infinite-flow proof — STOP.
6. Cross-provider migration (bePaid → Stripe для существующих cohort'ов) — STOP, отдельный план.
7. Tariff swap inside subscription — STOP, всегда manual_review (canon Extend↔Tariff Match Required).
8. price.id mismatch на invoice.paid — STOP, manual_review (canon SBS Mismatch No-New-Sub Guard аналог).

---

## 13. DoD (Discovery)

| # | Критерий | Статус |
|---|---|---|
| 1 | Subscription SOT Matrix | ✅ §1 |
| 2 | Stripe event → our action | ✅ §2 |
| 3 | First payment vs renewal | ✅ §3 |
| 4 | Duplicate guard cross-provider | ✅ §4 |
| 5 | Customer Portal actions | ✅ §5 |
| 6 | No schema change assumption | ✅ §6 |
| 7 | Testing strategy | ✅ §7 |
| 8 | bePaid freeze check | ✅ §8 |
| 9 | Implementation Recommendation | ✅ §9 |
| 10 | Per-component status (CAS/CAE/MP/BL) | ✅ §10 |

**Все 10 правок плана учтены.**

---

## 14. Master Sprint Alignment

| Фаза | Статус |
|---|---|
| Phase 0 Discovery | DONE |
| Phase 1 Provider Abstraction | DONE |
| Phase 2 Stripe Sandbox | DONE |
| PRR Gate | DONE (13/13) |
| Stage C Runtime Pilot (one-time) | DONE (10/10) |
| **Phase 3.0 Subscription Discovery (this doc)** | **DONE** |
| Phase 3.1 Infinite Subscription MVP | NOT STARTED — требует approve |
| Phase 3.2 Stage D Runtime Pilot | NOT STARTED |
| Phase 3.3 Customer Portal | NOT STARTED |
| Phase 3.4 Dunning | NOT STARTED |
| Phase 3.5 Reconcile | NOT STARTED |
| Phase 3.6 Subscription Schedule (finite) | NOT STARTED |
| Phase 4 Public Links | NOT STARTED |
| Phase 5 Product Acquiring Settings | NOT STARTED |
| Phase 6-10 | NOT STARTED |

**Freeze maintained:** bePaid, live mode, Subscription Schedule, all phases 4-10.

---

## 15. Что НЕ сделано (явно)

- Не написан ни один production-код подписочного flow Stripe.
- Не создана `stripe-create-subscription-checkout`.
- Не расширен `subscription-conflict.ts`.
- Не модифицирован `grant-access-for-order`.
- Не модифицирован `subscription-actions`.
- Не добавлены webhook handlers для `customer.subscription.*` / `invoice.*`.
- Не созданы миграции.
- Не выполнены runtime тесты (no test clock, no card runs).
- Не затронут bePaid.
- Не включён live mode.

## 16. Следующий шаг

Ожидаю approve на **Phase 3.1 Infinite Subscription MVP plan**, который будет включать:
- mini-plan на price.id ↔ tariff_offer mapping (где хранить);
- mini-plan на `subscription.metadata` schema;
- список затрагиваемых файлов с явными add-only extension диффами (но БЕЗ кода в плане — только список).
