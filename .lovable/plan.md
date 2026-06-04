## да, согласен, с учетом правок:

```text
Discovery Subscriptions Compatibility Map можно запускать.

Правки перед execute:

1. Добавить обязательный раздел:
   "Subscription SOT Matrix"

   Для каждой сущности указать SOT:
   - subscriptions_v2
   - provider_subscriptions
   - Stripe Subscription
   - Stripe Invoice
   - Stripe PaymentIntent
   - Entitlement
   - Access window
   - Customer
   - PaymentMethod

2. Добавить обязательный анализ:
   "Stripe event → our action"

   Таблица:
   - checkout.session.completed
   - customer.subscription.created
   - customer.subscription.updated
   - customer.subscription.deleted
   - invoice.created
   - invoice.finalized
   - invoice.paid
   - invoice.payment_failed
   - invoice.payment_action_required
   - charge.refunded

   Для каждого:
   - что пишет в provider_events;
   - что меняет в subscriptions_v2;
   - что меняет в provider_subscriptions;
   - создаёт ли orders_v2;
   - вызывает ли grant-access-for-order;
   - когда manual_review.

3. Добавить обязательный анализ:
   "First payment vs renewal"

   Разделить:
   - первая оплата subscription checkout;
   - последующее автосписание invoice.paid;
   - failed renewal;
   - cancellation;
   - resume.

4. Добавить обязательный анализ:
   "Duplicate subscription guard"

   Проверить не только provider='stripe', но и cross-provider:
   - bePaid active → Stripe запрещён;
   - Stripe active → bePaid запрещён;
   - Stripe account A active → Stripe account B запрещён для того же product_id.

5. Добавить анализ:
   "Customer Portal subscription actions"

   Потому что MVP self-service = Stripe Customer Portal:
   - отмена подписки через Portal;
   - смена карты через Portal;
   - как webhook отражает это в нашей БД;
   - какие события Stripe должны быть обработаны.

6. Добавить раздел:
   "No schema change assumption"

   Подтвердить, что Phase 3 можно сделать через `meta.*`.
   Если discovery показывает необходимость новых колонок — STOP и отдельный schema mini-plan.

7. Добавить раздел:
   "Testing strategy"

   Как в test-mode проверять:
   - first payment;
   - renewal;
   - payment_failed;
   - cancel_at_period_end;
   - resume;
   - finite cycles.

   Обязательно указать:
   - Stripe Test Clock или альтернативу;
   - как не ждать реального месяца.

8. Добавить раздел:
   "bePaid recurring freeze check"

   Подтвердить, какие файлы/пути нельзя трогать при будущей реализации:
   - bepaid-webhook;
   - bepaid-create-subscription;
   - bepaid recurring jobs;
   - existing provider_subscriptions rows provider='bepaid'.

9. Добавить итоговую секцию:
   "Implementation Recommendation"

   Не код, а порядок будущей реализации:
   1. Infinite Subscription MVP.
   2. Runtime proof.
   3. Customer Portal actions.
   4. Failed payment / dunning.
   5. Reconcile.
   6. Только потом Subscription Schedule / finite installments.

10. В отчёте обязательно указать статус:
   - compatible as-is;
   - compatible with add-only extension;
   - requires mini-plan;
   - blocked.

После этих правок можно выполнять discovery.
```

Сейчас это правильный следующий шаг по мастер-спринту: **Фаза 3 Subscriptions — сначала compatibility discovery, без кода**.

&nbsp;

Discovery Subscriptions Compatibility Map — Stripe Subscriptions (Фаза 3)

### 1. Проблема

Сейчас подписочная инфраструктура работает только с bePaid (provider-managed). Stripe в проекте прошёл one-time pilot (Stage C, 10/10 PASS), но подписочный flow (Subscription -> Checkout -> Webhook -> Grant -> Recurring) через Stripe ещё не анализирован на совместимость с существующей архитектурой.

### 2. Диагностика (актуальное состояние)

- `subscriptions_v2` — поля: id, user_id, order_id, product_id, tariff_id, flow_id, status (USER-DEFINED), access_start_at, access_end_at, is_trial, trial_end_at, next_charge_at, charge_attempts, payment_token, canceled_at, cancel_reason, meta, created_at, updated_at, trial_canceled_at, trial_canceled_by, keep_access_until_trial_end, cancel_at, payment_method_id, auto_renew, profile_id, auto_renew_disabled_by, auto_renew_disabled_at, auto_renew_disabled_by_user_id, grace_period_started_at, grace_period_ends_at, grace_period_status, billing_type.
- `provider_subscriptions` — поля: id, provider, provider_subscription_id, user_id, subscription_v2_id, profile_id, state, next_charge_at, last_charge_at, amount_cents, currency, interval_days, card_brand, card_last4, card_token, raw_data, created_at, updated_at, meta, order_id. Provider = 'bepaid' по умолчанию.
- `grant-access-for-order` — решает recurring через `resolveRecurringFromOrderOrTariff` (SOT = `tariff_offers.meta.recurring.is_recurring`). Для recurring-заказа ищет активную подписку через `provider_linked_subscription_resolver.ts` и делает extend (при совпадении tariff_id) или создаёт новую.
- `subscription-conflict.ts` (duplicate-subscription-prevention-guard) — проверяет конфликт по `user_id + product_id + status in [active, trial] + provider_subscriptions.provider='bepaid' + state in [active]`. Без provider-связи — зомби, не блокирует.
- `subscription-actions` — cancel, check-resume, resume, change-payment-method. Resume: 3-level eligibility (local -> payment method -> provider bePaid state). Provider-dead = блок.
- `access-rules-nightly-reconcile` — батчит active `subscriptions_v2`, прогоняет secondary product access grants.
- `stripe-create-checkout` — только one-time (`is_one_time: true`), `save_payment_method` опционально.
- `stripe-webhook` — checkout.session.completed -> `grant-access-for-order` (вызывает как есть, без модификаций).

### 3. Предлагаемое решение (Discovery-only)

Провести полный аудит каждого subscription-компонента на предмет совместимости с Stripe Subscription API (Checkout Session с `mode='subscription'`, Subscription object, Invoice, Invoice.payment_succeeded). Результат — markdown-отчёт `.lovable/proofs/stripe_phase_3_discovery_subscriptions_compatibility_v1.md` с матрицей совместимости.

### 4. Изменяемые компоненты

Нет. Discovery — read-only анализ, без изменений кода/таблиц/RPC.

### 5. Что не будет изменено (STOP-guards Discovery)

- Не писать `stripe-create-subscription-checkout`
- Не писать Subscription Schedule
- Не расширять `reconcile` / `nightly-access-reconcile`
- Не менять `subscription-actions`
- Не менять `provider_subscriptions`
- Не менять `grant-access-for-order`
- Не менять `subscription-conflict.ts`
- Не менять `subscriptions_v2` схему
- Не включать live mode
- Не трогать bePaid

### 6. Dry-run

Discovery не имеет side-effects. Read-only просмотр кода + схемы.

### 7. Execute

Не применимо. Discovery-задача.

### 8. DoD Discovery

1. Карта полей `subscriptions_v2` -> какие поля нужны/не нужны для Stripe Subscription.
2. Карта полей `provider_subscriptions` -> какие поля заполнятся из Stripe API (`sub_xxx`, `in_xxx`).
3. Анализ `grant-access-for-order` — как recurring-flow будет работать со Stripe (pre-create subv2 -> checkout -> webhook -> extend vs new).
4. Анализ `subscription-conflict.ts` — как добавить provider='stripe' в конфликт-гвард без поломки bePaid.
5. Анализ `subscription-actions` — cancel/resume/change-payment-method через Stripe API (Cancellation behavior, Resume, PaymentMethod update).
6. Анализ `access-rules-nightly-reconcile` — нарушит ли Stripe active-записи secondary grants.
7. Анализ Extend<->Tariff Match SOT — как работает для bePaid, как должно для Stripe.
8. Анализ `stripe-webhook` — какие Stripe events нужны для subscription lifecycle (`invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`).
9. Анализ `stripe-create-checkout` — что нужно изменить для `mode='subscription'` (line_items с recurring price, subscription_data).
10. Gap-список: что нужно создать/изменить в Phase 3 Execution (после отдельного approve).

### 9. Риски и зависимости

- Discovery-отчёт не должен содержать production-код (только анализ).
- Нужно убедиться, что анализ не пропускает скрытые зависимости bePaid в subscription-actions (hardcoded provider='bepaid').