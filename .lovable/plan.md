да, согласен, с учетом правок:

**1. Усилить защиту invoice.paid от повторной выдачи доступа**

Сейчас в C.4 есть идемпотентность orders_v2, но отдельно зафиксировать:

- если order уже существует для данного [invoice.id](http://invoice.id), то:
  - новый order не создаётся;
  - новый payment не создаётся;
  - grant-access-for-order повторно не вызывается;
  - событие логируется как invoice_paid_duplicate.

Иначе есть риск двойного grant при сложном webhook replay.

&nbsp;

**2. Зафиксировать Source of Truth для activation**

Добавить явно:

invoice.paid

=

единственный activation event

&nbsp;

customer.subscription.created

=

bind lifecycle only

&nbsp;

customer.subscription.updated

=

sync lifecycle only

&nbsp;

customer.subscription.deleted

=

sync lifecycle only

&nbsp;

invoice.payment_failed

=

grace lifecycle only

Чтобы подрядчик не начал в Stage 2 переносить activation в другие ветки.

&nbsp;

**3. Добавить обязательный audit trail**

Для всех 5 новых веток добавить DoD:

- event_id
- subscription_v2_id
- provider_subscription_id
- action
- result
- manual_review
- account_code

должны попадать в audit/event log.

Без этого Stage 2.5 будет тяжело доказывать G10–G18.

&nbsp;

**4. Добавить отдельную проверку zombie pending**

В C.1:

если найдена запись

provider='stripe'

state='pending'

provider_subscription_id='pending:*'

но соответствующая subscriptions_v2 уже:

canceled

expired

deleted

то:

manual_review=true

reason=zombie_pending_subscription

без bind.

&nbsp;

**5. Уточнить B-1**

Для Stage 1 фактически подтверждено:

provider_subscription_id = pending:{subscription_v2_id}

Из последнего PASS отчета:

pending:d04fbfa2-55fb-411f-b9d7-4fc8884b87d3

Поэтому в Stage 2 это должно быть зафиксировано как контракт.

Не делать альтернативные форматы.

Не использовать:

stripe_sub:pending:...

&nbsp;

**6. Уточнить B-2**

Согласен с вариантом (b):

SELECT before INSERT

Причины:

- нет миграции;
- нет нового индекса;
- соответствует STOP-GATE;
- достаточно для MVP.

Вынести в план как утверждённое решение, а не открытый вопрос.

&nbsp;

**7. Уточнить C.5**

Согласен с:

invoice.payment_failed

→ НЕ вызывать applyCrmStageOnTerminal('failed')

до отдельного спринта Smart Retries / Dunning.

Иначе CRM начнет показывать ложные потери клиентов после первой неудачной попытки Stripe.

&nbsp;

**8. Добавить явный запрет на работу с entitlements**

В STOP-GATE добавить:

Запрещено:

- прямое изменение entitlements;

- прямое изменение access_rules;

- прямой revoke доступа.

&nbsp;

Все изменения доступа только через существующий

grant-access-for-order.

&nbsp;

**Итог**

План соответствует мастер-спринту v1.0.

После внесения указанных уточнений можно запускать реализацию **Phase 3.1 Stage 2 — Webhook Lifecycle**.

&nbsp;

# План: Phase 3.1 Stage 2 — Webhook Lifecycle (Stripe Subscriptions)

## Статус входа

- Stage 0 = ✅ PASS (discovery контракта).
- Stage 1 = ✅ PASS (pre-create writer + runtime G1–G9, super_admin откатан).
- bePaid контур заморожен. Stripe webhook сейчас обрабатывает ТОЛЬКО 6 веток Phase 2: `checkout.session.completed`, `payment_intent.succeeded|payment_failed`, `charge.refunded`/`refund.*`, `checkout.session.expired`, `charge.dispute.created`. Подписочных веток нет.
- D4/D5/D8 контракты заданы и являются SOT этапа.

## Ключевое правило Stage 2 (зафиксировано пользователем)

`**customer.subscription.created` НЕ выдаёт доступ.**
**Единственный триггер активации (orders_v2 + payments_v2 + `grant-access-for-order`) — `invoice.paid`.**

`customer.subscription.*` — это lifecycle подписки (статус, period, cancel_at_period_end, default_payment_method). `invoice.payment_failed` — grace, доступ не отзывается. `customer.subscription.deleted` — `status=canceled`, доступ живёт до `entitlements.expires_at` (GREATEST).

## Scope Stage 2

### A. Backlog B1 (перенесён из Stage 1) — provider-aware conflict helper

`_shared/subscription-conflict.ts` сейчас захардкожен на `provider='bepaid'` в трёх местах: `checkSubscriptionConflict`, `classifySameProductState`, `BLOCKING_PROVIDER_STATES`. Унифицировать:

1. Добавить опциональный параметр `providers?: ('bepaid'|'stripe')[]` (default = оба).
2. Заменить `.eq('provider', 'bepaid')` → `.in('provider', providers)`.
3. Inline-guard в `stripe-create-subscription-checkout` удалить, переключить на единый helper.
4. bePaid-callers (`create-payment-checkout.ts`, `bepaid-create-subscription-checkout`) оставить без изменений сигнатур (default-параметр).
5. Юнит-тест в `subscription-conflict_test.ts` на матрицу `(bepaid|stripe) × (conflict|no_conflict|zombie)`.

### B. Новый `_shared/stripe-subscription-resolver.ts`

Единая точка для **webhook + reconcile + replay** (D5 требование). Содержит чистые функции без HTTP:

- `resolveStripeSubscriptionEvent(supabase, event, account_code)` → диспатч 5 веток.
- Внутри — резолв `subscriptions_v2` по приоритету:
  1. `provider_subscriptions.provider_subscription_id = sub_*` AND `provider='stripe'`;
  2. Fallback на `pending` запись по `meta.tracking_id` (для bind `customer.subscription.created`);
  3. Cross-account guard (event.account_code ≠ sub.meta.account_code → `manual_review`).
- Хелперы: `findSubByStripeId`, `bindPendingProviderSub`, `materializeOrderFromInvoice`, `mergeStripeSubMeta`.

### C. 5 новых веток в `stripe-webhook/index.ts`

Добавляются в `dispatch()` add-only. Метаданные читаются из `event.data.object.metadata` + parent objects (subscription/invoice).

#### C.1 `customer.subscription.created`

- Найти `provider_subscriptions(state='pending', provider='stripe', provider_subscription_id='pending:<subv2>')` по `subscription.metadata.subscription_v2_id`.
- **bind**: UPDATE `provider_subscriptions` → `provider_subscription_id=sub_*`, `state` ← маппинг из `subscription.status` (`incomplete|trialing|active|past_due|...`).
- UPDATE `subscriptions_v2.meta.stripe.*` (sub_id, customer_id, price_id, current_period_*, cancel_at_period_end, default_payment_method).
- `subscriptions_v2.status` НЕ переводим в `active` (это сделает `invoice.paid`). На `incomplete` оставляем `pending`.
- Если pending не найден → `manual_review` (`no_pre_created_sub`). НИКАКИХ INSERT.

#### C.2 `customer.subscription.updated`

- Snapshot `meta.stripe.*` (period, cancel_at_period_end, default_payment_method).
- Sync `subscriptions_v2.status` по таблице переходов D2 (`active`/`past_due`/`canceled`).
- Sync `provider_subscriptions.state`.
- Доступ не трогаем.

#### C.3 `customer.subscription.deleted`

- `subscriptions_v2.status='canceled'`, `cancel_reason='stripe_subscription_deleted'`.
- `provider_subscriptions.state='canceled'`.
- Доступ НЕ отзывается (живёт до `entitlements.expires_at`).

#### C.4 `invoice.paid` — **единственный write-path активации**

- Idempotent INSERT `orders_v2` по `meta.stripe.invoice_id=in_*` (guard через `SELECT … WHERE meta->>'stripe.invoice_id'=…` или unique index на meta-поле — выберется по результатам B-2 ниже).
- `tracking_id = stripe_sub:<sub_id>:order:<order_id>`.
- Amount/currency из `invoice.amount_paid` + `invoice.currency`.
- Резолв `user_id`, `product_id`, `tariff_id`, `offer_id` из `subscription.metadata` (pre-create).
- Вызов `grant-access-for-order` (existing, untouched) — он сам поймёт extend через `provider-linked-extend-priority` + `extend-tariff-match-required`.
- INSERT `payments_v2` по `invoice.payment_intent` (Phase 2 паттерн).
- Если на момент `invoice.paid` `subscriptions_v2.status='pending'` → перевести в `active` (первая оплата).
- `applyCrmStageOnTerminal(order_id, 'success', 'stripe.invoice.paid')`.

#### C.5 `invoice.payment_failed`

- `subscriptions_v2.status='past_due'` (если был `active`).
- `provider_subscriptions.state='past_due'`.
- Audit без revoke (grace).
- `applyCrmStageOnTerminal(..., 'failed', 'stripe.invoice.payment_failed')` — опционально, по согласованию с CRM правилами; **дефолт — НЕ применять**, чтобы не уводить deal с pipeline до Smart Retries.

### D. Cross-account / conflict policy → HTTP 200 + manual_review

Все 5 веток при следующих коллизиях возвращают **200 + audit с `manual_review=true**`, без INSERT/UPDATE:

- `no_pre_created_sub` (только C.1)
- `foreign_account` (event account_code ≠ sub.meta.account_code)
- `tariff_mismatch` (C.4, после резолва offer)
- `sbs_mismatch` (foreign customer_id на known sub)
- `unknown_invoice_no_subscription` (C.4 для one-time invoice — пока не поддерживаем)

### E. Idempotency

Используется существующий `provider_events_idem_unique` на `(provider, event_id)` через `idempotency_key = stripe:{account_code}:{event.id}` — уже стоит в Phase 2. Никаких новых таблиц/индексов.

## STOP-GATE для Stage 2

Запрещено:

- Менять `grant-access-for-order` (только вызывать).
- Менять `bepaid-*` файлы.
- Менять `stripe-create-subscription-checkout` (Stage 1 заморожен, кроме удаления inline-guard в пользу унифицированного helper из пункта A).
- Создавать новые таблицы / RPC / cron.
- Реализовывать reconcile / events-replay (это Stage 4).
- Реализовывать Schedule (installment) ветки — D2 описывает, но MVP = infinite only.
- Расширять `payment_method.*` / `customer.updated` ветки — это backlog `stripe_saved_pm_followup`.

## Definition of Done Stage 2 (CODE)

1. `_shared/subscription-conflict.ts` — provider-aware (B1 закрыт), юнит-тест.
2. `_shared/stripe-subscription-resolver.ts` создан.
3. `stripe-webhook/index.ts` — 5 новых веток через резолвер, add-only.
4. `stripe-create-subscription-checkout/index.ts` — inline-guard удалён, использует helper.
5. `supabase/config.toml` — без изменений (webhook уже зарегистрирован).
6. Регрессия: 6 существующих Phase 2 веток продолжают работать (юнит-snapshot не меняется).
7. Артефакт: `.lovable/proofs/stripe_phase_3_1_stage_2_webhook_lifecycle_v1.md` с описанием каждой ветки + conflict matrix.
8. `.lovable/plan.md` обновлён: Stage 2 = CODE COMPLETE, Stage 2.5 (Runtime Proof) = TODO.

## Runtime Proof Stage 2.5 (после CODE COMPLETE — отдельный шаг, не входит в этот план)

Будет описан отдельным under-plan: G10–G18 (live test через Stripe CLI / test clock), отдельный отчёт PASS/FAIL.

## Открытые вопросы (требуют решения до старта B / C.4)

- **B-1**: Какой формат `meta.tracking_id` для pre-create в `provider_subscriptions` сейчас (`pending:<subv2>` vs `stripe_sub:pending:order:<order_id>`)? Нужно сверить со Stage 1 фактически записанным значением и зафиксировать в резолвере.
- **B-2**: Idempotency `orders_v2` по `invoice.id` — через (a) уникальный partial index на `(meta->>'stripe_invoice_id')` WHERE provider='stripe', (b) проверку SELECT перед INSERT, (c) использовать `provider_payment_id` на orders_v2. Подход (b) безопаснее и не требует миграции — **default = (b)**.
- **C.5**: Применять ли `applyCrmStageOnTerminal('failed')` на `invoice.payment_failed`. **Default = НЕ применять** (Smart Retries grace).

Прошу подтвердить план целиком ИЛИ указать правки (особенно по 3 открытым вопросам) до старта реализации Stage 2.