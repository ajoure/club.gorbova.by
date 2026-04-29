# План: публичная ссылка рассрочки = finite bePaid subscription

> Источник: чат-сообщение пользователя (полный текст), сохранён здесь как канонический план.
> Любое расхождение между этим файлом и текущим кодом — повод для STOP-guard, не для тихой адаптации.

## 1. Цель

Публичная ссылка рассрочки (`/pay/:token`, `payment_links.meta.installment.selected_installment_months >= 2`) должна оплачиваться через bePaid `/subscriptions` как **finite** подписка с `billing_cycles=N`, а не через `/checkouts` как one-time платёж.

После первого успешного платежа bePaid сам списывает оставшиеся N−1 платежей раз в 30 дней, завершает подписку, никаких internal `installment-charge-cron` дублирующих списаний.

## 2. Что сейчас не так

- `admin-create-public-link` для installment пишет `payment_type='one_time'`.
- `/pay/:token` уходит в one-time `/checkouts` bePaid → ЕРИП виден, авто-списания нет.
- В DB: `provider_subscriptions` не создаётся, `subscriptions_v2` нет, второй и далее платежи не выполняются автоматически.
- Старая internal installment-схема (`installment_payments` + `installment-charge-cron`) применима только к старой ветке и не должна срабатывать на новой provider-managed installment.

## 3. Что меняем (по компонентам)

### 3.1. `admin-create-public-link`
- Если `meta.installment.selected_installment_months >= 2` → `payment_type='subscription'`.
- `amount` = per-payment kopecks (как сейчас для рассрочки).
- Audit proof обновить: `public_link.installment_as_subscription`.
- Никаких новых таблиц/RPC.

### 3.2. `public-checkout`
- Для installment-ссылки пробросить в shared subscription branch:
  ```ts
  meta_extra: {
    installment_count: N,
    installment: { interval_days: 30 },
  }
  ```
- Не создавать второй workflow, использовать существующую subscription-ветку.

### 3.3. `_shared/create-payment-checkout.ts`
- Распознать installment subscription:
  ```ts
  const isInstallmentSubscription = Number(extraMeta.installment_count) >= 2;
  const billingCycles = isInstallmentSubscription ? Number(extraMeta.installment_count) : null;
  const intervalDays = isInstallmentSubscription
    ? Number(extraMeta.installment?.interval_days ?? 30)
    : 30;
  ```
- Для обычных подписок — старое поведение: `infinite=true`, без `billing_cycles`.
- Для рассрочки в bePaid plan:
  ```ts
  plan: {
    shop_id: Number(bepaidCreds.shop_id),
    currency: 'BYN',
    title: planTitle,
    description: planDescription,
    plan: { amount, interval: intervalDays, interval_unit: 'day' },
    infinite: false,
    billing_cycles: billingCycles,
    number_payment_attempts: 3,
  }
  ```
- `planDescription`:
  ```
  Рассрочка: N платежа по X BYN каждые 30 дней. Подписка завершится после N платежей.
  ```
- `tracking_id`: `subv2:{subscription_v2_id}:order:{order_id}` (provider-managed формат).

### 3.4. Pre-create `subscriptions_v2` до bePaid
В subscription-ветке `createPaymentCheckout`:
- Создать `subscriptions_v2`:
  - `status='past_due'`
  - `billing_type='provider_managed'` (если enum не принимает `provider_managed_installment` — STOP-guard, использовать существующее значение + `meta.installment_count`)
  - `auto_renew=true`
  - `order_id=order.id`
  - `meta.checkout_order_id=order.id`
  - `meta.installment_count=N` только для рассрочки
- `trackingId = subv2:${subscription.id}:order:${order.id}`.
- `provider_subscriptions.upsert` с `subscription_v2_id: subscription.id` сразу.

### 3.5. `bepaid-webhook`
- Использовать существующий provider-managed handler (`rawTrackingId.startsWith('subv2:')`).
- Распознавать `isInstallmentProviderManaged` по `subV2.meta.installment_count >= 2 || order.meta.installment_count >= 2`.
- При active payment: orders.paid, subv2.active, ps.active, payments.is_recurring=true, grant-access-for-order — как есть.
- Защита от запуска old internal STAGE L3 (`installment_payments` + `installment-charge-cron`) для provider-managed installment.
- Audit: `bepaid.subscription.installment_processed` с `billing_cycles, per_payment_amount, provider_subscription_id, subscription_v2_id, order_id`.

### 3.6. `PublicPayPage`
- Только текст:
  ```
  Вас перенаправит на защищённую страницу bePaid для оформления рассрочки.
  bePaid автоматически спишет N платежей и завершит подписку.
  ```
- ЕРИП вручную не скрывать — на `/subscriptions` он отсутствует автоматически.

## 4. Что НЕ меняем
- Никаких новых таблиц, RPC, edge functions, статусов, enum.
- Никакого второго checkout workflow.
- Никаких ручных манипуляций ЕРИП в payload.
- Обычные one-time ссылки и обычные infinite subscriptions — без изменений.
- Никакого string-matching по продукту/тарифу.

## 5. Dry-run (только SELECT)
1. Текущие installment payment_links: `payment_links.meta.installment.selected_installment_months >= 2` → их `payment_type` сейчас.
2. Уже оплаченные/начатые рассрочки, которые ушли one-time: `orders_v2.meta.installment_count >= 2`, `payment_flow`, наличие `provider_subscriptions`.
3. Реально допустимые значения `subscriptions_v2.billing_type` (enum/check).
4. Формат `provider_subscriptions.tracking_id` для уже работающих provider-managed подписок (валидация формата `subv2:...`).

## 6. Execute (после approval, последовательно)
1. `admin-create-public-link` — installment → `payment_type='subscription'`.
2. `public-checkout` — пробросить installment meta_extra.
3. `_shared/create-payment-checkout.ts` — finite plan + pre-create `subscriptions_v2` + tracking_id.
4. `bepaid-webhook` — installment audit + защита от internal scheduler.
5. `PublicPayPage` — текст.
6. Memory: `Installment Public Link = finite bePaid subscription`.

## 7. STOP-guards
1. bePaid не принимает inline `infinite/billing_cycles` в `POST /subscriptions` → план меняется: сначала `/plans`, потом `/subscriptions` по `plan.id`. Без новой функции.
2. `subscriptions_v2.billing_type` enum не принимает proposed value и нельзя безопасно использовать `provider_managed` + meta marker.
3. Webhook не сможет резолвить `subv2:{sub_id}:order:{order_id}`.
4. Dry-run находит уже paid one-time installment orders → их repair выносится в отдельный план, не в этот патч.
5. Любой массовый UPDATE по старым данным — отдельный dry-run + rowcount guard.

## 8. DoD
1. Новая публичная installment-ссылка: `payment_type='subscription'`, `amount=per_payment_kopecks`, `meta.installment.selected_installment_months=N`.
2. `/pay/:token` → bePaid `/subscriptions` (не `/checkouts`).
3. ЕРИП в bePaid не отображается автоматически.
4. Payload bePaid: `infinite=false`, `billing_cycles=N`, `number_payment_attempts=3`, `plan.amount=per_payment_kopecks`, `plan.interval=30`, `plan.interval_unit=day`.
5. `tracking_id = subv2:{subscription_v2_id}:order:{order_id}`.
6. Webhook идёт в provider-managed subscription branch.
7. После 1-го успешного платежа: orders.paid, subv2.active, ps.active, ps.subscription_v2_id заполнен, payments.is_recurring=true, доступ через grant-access-for-order.
8. Никаких duplicate internal `installment_payments` для новых provider-managed installment.
9. Обычные one-time ссылки — без изменений.
10. Обычные infinite subscriptions — без `billing_cycles`.

## 9. Риски
- bePaid API: возможно потребуется отдельный `POST /plans` перед `POST /subscriptions`. Решается в рамках STOP-guard №1, без архитектурных изменений.
- Старые ошибочные one-time installment orders — repair НЕ в этом патче, отдельным планом.
