да, согласен, с учетом правок:

1. Перед Execute обязательно сделать **Discovery по текущему коду**, потому что в проекте уже есть две модели рассрочки:
  &nbsp;
  &nbsp;
  - старая internal scheduler `installment_payments + installment-charge-cron`;
  - новая целевая provider-managed через bePaid finite subscription.  
  Нужно явно зафиксировать, где старая модель ещё используется, чтобы не получить двойные списания.
2. В `DoD` добавить отдельный proof:
  - для новой рассрочки `installment_payments` **не создаются**;
  - `installment-charge-cron` не видит эту подписку как due;
  - списания идут только через bePaid subscription.
3. В `subscriptions_v2` не вводить новый `billing_type`, если это требует enum/constraint-миграции. Использовать:
  - `billing_type='provider_managed'`;
  - признак рассрочки только в `meta.installment`.
4. В `admin-create-public-link` обязательно сохранить в `payment_links.meta`:

&nbsp;

&nbsp;

```ts
meta.installment = {
  provider_managed: true,
  selected_installment_months: N,
  per_payment_amount_byn: X,
  total_amount_byn: total,
  billing_cycles: N,
  interval_days: 30,
  model: 'bepaid_finite_subscription'
}
```

5. В `bepaid-webhook` добавить hard guard:
  - если `meta.installment.model === 'bepaid_finite_subscription'`, не запускать/не создавать internal installment schedule ни при каких условиях.
6. Для старых уже созданных one-time рассрочек — только отдельный repair-plan. В этот патч не смешивать.

Можно выполнять после Discovery и STOP-guard проверки bePaid payload.

&nbsp;

План:

## 1. Проблема

При создании публичной ссылки на оплату рассрочки сейчас downstream-поток уводит клиента в **one-time checkout** bePaid (`/checkouts`), поэтому в bePaid показываются методы разового платежа, включая ЕРИП. Это критично: такой платёж не создаёт bePaid-подписку и не гарантирует будущие списания.

Нужное поведение: рассрочка должна создавать **стандартную bePaid subscription checkout-ссылку** через существующую функцию/ветку подписки (`POST https://api.bepaid.by/subscriptions`) с планом:

```text
infinite: false
billing_cycles: selected_installment_months
number_payment_attempts: 3
plan.amount: сумма одного платежа
plan.interval: 30
plan.interval_unit: day
```

Тогда bePaid сам покажет страницу подписки, ЕРИП автоматически исчезнет, и провайдер будет управлять списаниями по количеству циклов.

## 2. Диагностика

Проверены существующие компоненты, чтобы не создавать новый workflow:

1. `supabase/functions/admin-create-public-link/index.ts`
  - Сейчас для рассрочки есть блок Stage L.
  - Он валидирует `offer.payment_method='internal_installment'`, считает `selected_installment_months`, `per_payment_amount`, `total_installment_amount`.
  - Но затем принудительно делает:
    ```ts
    payment_type = 'one_time'
    ```
  - Это корневая ошибка маршрутизации: ссылка рассрочки уходит как разовый платеж.
2. `supabase/functions/public-checkout/index.ts`
  - Берёт `payment_links.payment_type` и передаёт в `createPaymentCheckout`.
  - Так как link хранит `payment_type='one_time'`, дальше создаётся one-time bePaid checkout.
3. `supabase/functions/_shared/create-payment-checkout.ts`
  - Уже содержит существующую subscription-ветку.
  - Ветка `payment_type === 'subscription'` уже вызывает:
    ```ts
    fetch('https://api.bepaid.by/subscriptions', ...)
    ```
  - Но сейчас plan payload для подписки бесконечный по умолчанию, потому что не передаются `infinite:false` и `billing_cycles`.
4. Документация bePaid:
  - `POST /subscriptions` создаёт ссылку подписки, клиент вводит карту и совершает оплату для создания подписки.
  - `POST /plans` / plan object поддерживает:
    - `infinite` — по умолчанию `true`;
    - `billing_cycles` — количество циклов оплаты, игнорируется если `infinite:true`;
    - `number_payment_attempts` — количество попыток перед отменой.
  - Статус `canceled` наступает, когда количество циклов достигло `billing_cycles`.
5. `supabase/functions/bepaid-webhook/index.ts`
  - Уже есть handler provider-managed subscription для `tracking_id` формата:
  - Он обновляет `orders_v2`, `subscriptions_v2`, `provider_subscriptions`, `payments_v2`, вызывает `grant-access-for-order`.
  - Значит новый webhook создавать не нужно; нужно, чтобы рассрочка шла в эту существующую ветку.

## 3. Предлагаемое решение

### 3.1. Изменить маршрутизацию рассрочки: payment_type должен быть `subscription`

В `admin-create-public-link/index.ts`:

- Для `installment_offer || offerPaymentMethod === 'internal_installment'` больше не ставить `payment_type='one_time'`.
- Вместо этого ставить:
  ```ts
  payment_type = 'subscription'
  ```
- Комментарий заменить на новый контракт:
  ```text
  installment-link = finite provider-managed bePaid subscription
  ```
- В `payment_links.amount` оставить **сумму одного платежа** (`per_payment_kopecks`), как сейчас.
- В `payment_links.meta.installment` оставить `selected_installment_months`, `interval_days`, `per_payment_amount_byn`, `total_installment_amount` — это станет входом для finite plan.

### 3.2. Пробросить installment meta в subscription checkout

В `public-checkout/index.ts`:

- Сейчас `installmentMetaExtra` добавляется в `orders_v2.meta`, но `payment_type` остаётся тем, что лежит в ссылке.
- После правки writer-а ссылка будет иметь `payment_type='subscription'`, поэтому `createPaymentCheckout` попадёт в subscription branch.
- Нужно дополнить `meta_extra` такими полями:
  ```ts
  installment_count: selected_installment_months
  installment_per_payment_amount_byn: per_payment_amount_byn
  installment_total_amount_byn: per_payment_amount_byn * selected_installment_months
  installment: {...}
  payment_flow: 'provider_managed_installment'
  ```
- Никакого нового endpoint не создаём.

### 3.3. В существующей subscription-ветке создать finite plan bePaid

В `_shared/create-payment-checkout.ts`, ветка `payment_type === 'subscription'`:

- Перед формированием `bepaidPayload` определить:
  ```ts
  const isInstallmentSubscription = Number(extraMeta.installment_count) >= 2;
  const billingCycles = isInstallmentSubscription ? Number(extraMeta.installment_count) : null;
  const intervalDays = isInstallmentSubscription
    ? Number(extraMeta.installment?.interval_days ?? 30)
    : 30;
  ```
- Для обычных подписок оставить старое поведение: infinite по умолчанию, без `billing_cycles`.
- Для рассрочки в `plan` добавить настройки bePaid:
  ```ts
  plan: {
    shop_id: Number(bepaidCreds.shop_id),
    currency: 'BYN',
    title: planTitle,
    description: planDescription,
    plan: {
      amount,                  // сумма одного платежа в копейках
      interval: intervalDays,  // 30
      interval_unit: 'day',
    },
    infinite: false,
    billing_cycles: billingCycles,
    number_payment_attempts: 3,
  }
  ```
- `planDescription` для рассрочки сделать точным:
  ```text
  Рассрочка: N платежа по X BYN каждые 30 дней. Подписка завершится после N платежей.
  ```
- `tracking_id` оставить provider-managed формата:
  ```text
  subv2:{subscription_v2_id}:order:{order_id}
  ```
  Важно: это заставит существующий `bepaid-webhook` идти в ветку provider-managed subscription, а не link-order.

### 3.4. Создать/связать local `subscriptions_v2` до вызова bePaid

Сейчас shared subscription-ветка `createPaymentCheckout` создаёт order и bePaid subscription, но `provider_subscriptions.subscription_v2_id` ставит `null` и потом webhook должен связать. Для рассрочки нужен стабильный `subv2:{subscription_v2_id}:order:{order_id}`.

Поэтому в subscription-ветке `createPaymentCheckout` будет добавлено создание `subscriptions_v2` перед вызовом bePaid:

- Для обычной подписки и рассрочки:
  ```ts
  status: 'past_due'
  billing_type: isInstallmentSubscription ? 'provider_managed_installment' : 'provider_managed'
  auto_renew: true
  order_id: order.id
  meta.checkout_order_id = order.id
  meta.installment_count = N только для рассрочки
  ```
- `trackingId` строить через `subscription.id`:
  ```ts
  const trackingId = `subv2:${subscription.id}:order:${order.id}`;
  ```
- `provider_subscriptions.upsert` писать сразу с `subscription_v2_id: subscription.id`.

Если в текущей базе enum/constraint не принимает `billing_type='provider_managed_installment'`, STOP-guard: не добавлять новый enum, использовать существующий `billing_type='provider_managed'`, а признак рассрочки хранить в `meta.installment_count`. Новых статусов/enum без необходимости не создаём.

### 3.5. Webhook: не создавать новую ветку, а поправить обработку finite subscription

В `bepaid-webhook/index.ts` provider-managed handler (`rawTrackingId.startsWith('subv2:')`):

- Оставить его основным обработчиком.
- Добавить распознавание `isInstallmentProviderManaged` по:
  ```ts
  subV2.meta.installment_count >= 2
  или order.meta.installment_count >= 2
  ```
- При active payment:
  - `orders_v2.status='paid'` как сейчас;
  - `subscriptions_v2.status='active'` как сейчас;
  - `provider_subscriptions.state='active'` как сейчас;
  - `payments_v2.is_recurring=true` как сейчас;
  - `grant-access-for-order` как сейчас.
- Для finite installment не запускать старую STAGE L3-логику `installment_payments + installment-charge-cron`, потому что теперь списания ведёт bePaid. Этот старый блок относится к прежней internal installment модели и не должен дублировать списания.
- В audit добавить явный proof:
  ```text
  bepaid.subscription.installment_processed
  ```
  с `billing_cycles`, `per_payment_amount`, `provider_subscription_id`, `subscription_v2_id`, `order_id`.

### 3.6. UI `/pay/:token`

В `src/pages/PublicPayPage.tsx` минимально поправить тексты:

- Рассрочка останется визуально как `N × X BYN`.
- Так как `payment_type` станет `subscription`, текущая логика уже покажет hint про bePaid subscription flow.
- Текст уточнить:
  ```text
  Вас перенаправит на защищённую страницу bePaid для оформления рассрочки. bePaid автоматически спишет N платежей и завершит подписку.
  ```
- ЕРИП вручную не скрывать и не упоминать как отдельную настройку: при корректном `/subscriptions` checkout bePaid сам не показывает ЕРИП.

## 4. Изменяемые компоненты

### Edge functions

1. `supabase/functions/admin-create-public-link/index.ts`
  - Исправить `payment_type` для installment: `subscription`, не `one_time`.
  - Обновить комментарии и audit proof.
2. `supabase/functions/public-checkout/index.ts`
  - Пробросить installment meta в subscription checkout.
  - Не создавать отдельный flow.
3. `supabase/functions/_shared/create-payment-checkout.ts`
  - В existing subscription branch добавить finite-plan настройки bePaid:
    - `infinite:false`
    - `billing_cycles:N`
    - `number_payment_attempts:3`
  - Создавать `subscriptions_v2` до bePaid request, чтобы `tracking_id` был `subv2:{subscription_v2_id}:order:{order_id}`.
  - `provider_subscriptions.subscription_v2_id` писать сразу.
4. `supabase/functions/bepaid-webhook/index.ts`
  - Использовать существующий provider-managed subscription handler.
  - Добавить installment proof/audit и защиту от запуска старого internal installment scheduler для новых provider-managed installment.

### UI

5. `src/pages/PublicPayPage.tsx`
  - Текст рассрочки/подписки, без новой логики оплаты.

### Memory

6. Добавить/обновить память:
  - `Installment Public Link = finite bePaid subscription`
  - публичная рассрочка не является one-time;
  - `billing_cycles = selected_installment_months`;
  - списания ведёт bePaid, не `installment-charge-cron`.

## 5. Что не будет изменено

- Не создаём новые таблицы.
- Не создаём новые RPC.
- Не создаём новую edge function.
- Не создаём второй checkout workflow.
- Не отключаем ЕРИП вручную в UI/payload `/checkouts`: проблема решается тем, что рассрочка больше не идёт через `/checkouts`, а идёт через `/subscriptions`.
- Не меняем обычные one-time ссылки.
- Не меняем обычные бесконечные provider-managed подписки Gorbova Club.
- Не используем string matching для продукта/тарифа; только UUID и meta-флаги.

## 6. Dry-run

Перед внесением правок выполнить безопасную проверку:

1. Найти текущие installment payment links:
  - `payment_links.meta.installment.selected_installment_months >= 2`
  - проверить их `payment_type`.
2. Найти активные/новые рассрочки, которые уже могли уйти one-time:
  - `orders_v2.meta.installment_count >= 2`
  - `orders_v2.meta.payment_flow` старого типа;
  - наличие/отсутствие `provider_subscriptions`.
3. Проверить, какие значения реально допустимы в `subscriptions_v2.billing_type`.
4. Проверить, что webhook logs по тестовому provider-managed subscription приходят с `tracking_id` `subv2:...`.

Dry-run не делает UPDATE/DELETE, только SELECT/логирование.

## 7. Execute

После approval:

1. Патч `admin-create-public-link`: installment → `payment_type='subscription'`.
2. Патч `public-checkout`: корректный `meta_extra` для finite subscription.
3. Патч `_shared/create-payment-checkout.ts`: finite bePaid plan + pre-created `subscriptions_v2` + correct `tracking_id`.
4. Патч `bepaid-webhook`: audit/proof для provider-managed installment и защита от internal scheduler дубля.
5. Патч `PublicPayPage`: текст.
6. Добавить memory-правило.
7. Провести тест edge function на создание ссылки/checkout без реального списания, если bePaid test mode доступен.

## 8. STOP-guards

Остановить выполнение и не выкатывать патч, если:

1. bePaid API не принимает `infinite:false` / `billing_cycles` внутри inline `plan` объекта при `POST /subscriptions` и требует предварительного `POST /plans`. Тогда план меняется: сначала existing subscription branch создаёт plan через `/plans`, затем subscription по `plan.id`, без новой функции.
2. `subscriptions_v2.billing_type` не принимает proposed value и нельзя безопасно использовать existing `provider_managed` + meta marker.
3. Webhook для `subv2:{subscription_id}:order:{order_id}` не сможет найти local subscription/order.
4. Dry-run показывает существующие paid one-time installment orders — их repair не смешиваем с этим патчем, а выносим отдельным планом.
5. Любой массовый UPDATE требуется для старых данных — не выполняем без отдельного dry-run и rowcount guard.

## 9. DoD

1. Новая публичная ссылка рассрочки в `payment_links` имеет:
  - `payment_type='subscription'`
  - `amount = per_payment_kopecks`
  - `meta.installment.selected_installment_months = N`
2. При переходе по `/pay/:token` и нажатии оплаты вызывается bePaid `/subscriptions`, а не `/checkouts`.
3. В bePaid checkout отображается подписка/план, ЕРИП отсутствует автоматически.
4. Payload в bePaid содержит:
  ```text
   infinite=false
   billing_cycles=N
   number_payment_attempts=3
   plan.amount=per_payment_kopecks
   plan.interval=30
   plan.interval_unit=day
  ```
5. `tracking_id` у bePaid subscription:
  ```text
   subv2:{subscription_v2_id}:order:{order_id}
  ```
6. Webhook попадает в existing provider-managed subscription branch, а не link-order/one-time branch.
7. После успешного первого платежа:
  - `orders_v2.status='paid'`
  - `subscriptions_v2.status='active'`
  - `provider_subscriptions.state='active'`
  - `provider_subscriptions.subscription_v2_id` заполнен
  - `payments_v2.is_recurring=true`
  - доступ выдан через `grant-access-for-order`
8. Для новых provider-managed installment не создаются duplicate internal `installment_payments` списания.
9. Обычные one-time ссылки продолжают открывать one-time checkout.
10. Обычные бесконечные subscription ссылки продолжают работать без `billing_cycles`.

## 10. Риски и зависимости

- Главная зависимость: bePaid должен принимать `infinite` и `billing_cycles` в inline `plan` внутри `POST /subscriptions`. Документация по планам это подтверждает для plan object; если конкретная API-форма потребует предварительный `/plans`, будет применён STOP-guard и скорректирован payload без новой архитектуры.
- Для уже созданных ошибочных one-time рассрочек потребуется отдельный repair-план: найти клиентов, у кого первый платёж уже ушёл как one-time, и перевести их на корректную finite subscription ссылку. В текущий патч это не смешивается.

## 11. Требуется дополнительная информация

Не требуется. Достаточно текущего кода, документации bePaid и предоставленного скрина с bePaid Plans UI.