# План по сути правильный. Перед выполнением нужно внести **четыре технические поправки**, иначе можно сломать dedup подписок или записывать marker не в тот момент.

## 1. Не перезаписывать существующий `meta.payment_flow`

Сейчас `createPaymentCheckout` использует системные значения:

```text
admin_subscription
renewal_subscription

```

и по ним ищет уже созданный pending-order для dedup.

При создании заказа сначала устанавливается системный `payment_flow`, а затем мержится `extraMeta`. Поэтому передача:

```json
{
  "payment_flow": "internal_installment"
}

```

перезапишет системное значение в сохранённом заказе, но следующий dedup продолжит искать `admin_subscription` или `renewal_subscription`.

### Правильно

Существующий `meta.payment_flow` не менять.

Canonical marker хранить отдельно:

```json
{
  "payment_method": "internal_installment",
  "installment": {
    "type": "internal",
    "provider": "bepaid",
    "model": "bepaid_finite_subscription",
    "billing_cycles": 5,
    "infinite": false
  }
}

```

Guard routing:

```ts
const installment =
  subscription.meta?.installment ??
  providerSubscription.meta?.installment ??
  order.meta?.installment;

const isFiniteInternalInstallment =
  order.meta?.payment_method === 'internal_installment' &&
  installment?.type === 'internal' &&
  installment?.provider === 'bepaid' &&
  installment?.model === 'bepaid_finite_subscription' &&
  installment?.infinite === false &&
  Number(installment?.billing_cycles) >= 2;

```

Системный `payment_flow` остаётся прежним.

---

## 2. `admin-create-public-link` не может сразу записать marker в три таблицы

Эта функция принципиально:

- не создаёт `orders_v2`;
- не создаёт подписку;
- не обращается в bePaid;
- создаёт только `payment_links`.

Поэтому Этап 1 нужно разделить.

### При создании ссылки

В:

```text
admin-create-public-link
public writer кнопки

```

сохранять canonical marker только в:

```text
payment_links.meta

```

Текущий installment block уже записывается туда.

Дополнить его:

```json
{
  "payment_method": "internal_installment",
  "type": "internal",
  "provider": "bepaid",
  "model": "bepaid_finite_subscription",
  "infinite": false
}

```

### При фактическом открытии checkout

`create-payment-checkout` получает snapshot ссылки и уже после создания сущностей распространяет его в:

```text
orders_v2.meta
subscriptions_v2.meta
provider_subscriptions.meta

```

Эта функция уже создаёт заказ, локальную подписку, provider subscription и отправляет bePaid:

```text
infinite=false
billing_cycles=N

```

---

## 3. `original_order_id` устанавливать только сервером после INSERT заказа

При создании payment link исходного заказа ещё нет.

Поэтому в `payment_links.meta`:

```text
original_order_id отсутствует или null

```

После успешного INSERT `orders_v2`:

```ts
const originalOrderId = order.id;

```

Именно сервер добавляет его в snapshots:

```text
orders_v2.meta.installment.original_order_id
subscriptions_v2.meta.installment.original_order_id
provider_subscriptions.meta.installment.original_order_id

```

Не принимать `original_order_id` от клиента или UI.

`provider_subscriptions` уже получает прямые:

```text
subscription_v2_id
order_id
user_id
profile_id

```

поэтому связь может быть зафиксирована без дополнительного поиска.

---

## 4. Историю платежей не запрашивать по несуществующему `payments_v2.subscription_id`

В плане указано:

```sql
WHERE subscription_id = ...

```

Но текущий canonical writer `payments_v2` обновляет и хранит прежде всего:

```text
order_id
user_id
profile_id
provider_payment_id
meta

```

Прямой `subscription_id` среди записываемых полей этого helper не используется.

### История исходной сделки

Основной фильтр:

```sql
payments_v2.order_id = original_order_id
AND payments_v2.provider = 'bepaid'

```

Для дополнительной защиты в `payments_v2.meta` при finite installment сохранять:

```json
{
  "subscription_v2_id": "...",
  "provider_subscription_id": "...",
  "payment_method": "internal_installment",
  "model": "bepaid_finite_subscription"
}

```

Тогда запрос истории:

```text
order_id = original_order_id
+
provider_subscription_id из meta

```

Это исключит смешивание платежей, если в одной сделке когда-либо появятся другие операции.

---

# Поправка к вкладке контакта

Не использовать абстрактное:

```text
user_id = :contact_id

```

без проверки типа идентификатора.

Карточка контакта может быть открыта по `[profiles.id](http://profiles.id)`, тогда запрос должен использовать:

```text
profile_id = contact.id

```

или сначала получить `profiles.user_id`, а затем фильтровать подписки по нему.

Система уже хранит одновременно `user_id` и `profile_id` в заказах и provider subscriptions.

---

# Исправленный canonical marker

## В `payment_links.meta`

```json
{
  "payment_method": "internal_installment",
  "installment": {
    "type": "internal",
    "provider": "bepaid",
    "model": "bepaid_finite_subscription",
    "billing_cycles": 5,
    "infinite": false,
    "per_payment_byn": 600,
    "effective_total_byn": 3000,
    "rounding_mode": "ceil_to_whole_byn",
    "rounding_delta_byn": 0
  }
}

```

## После создания заказа

```json
{
  "payment_flow": "admin_subscription",
  "payment_method": "internal_installment",
  "installment": {
    "type": "internal",
    "provider": "bepaid",
    "model": "bepaid_finite_subscription",
    "billing_cycles": 5,
    "infinite": false,
    "original_order_id": "<server order.id>",
    "per_payment_byn": 600,
    "effective_total_byn": 3000,
    "rounding_mode": "ceil_to_whole_byn",
    "rounding_delta_byn": 0
  }
}

```

`payment_flow` здесь пример существующего системного значения — его не подменять.

---

# Итоговый статус плана

```text
SCOPE ONLY INTERNAL INSTALLMENT     : PASS
ONE DEAL FOR FINITE INSTALLMENT     : PASS
ALL OTHER SUBSCRIPTIONS UNCHANGED   : PASS
NO LOCAL PAYMENT SCHEDULE           : PASS
EXISTING NOTIFICATIONS REUSED       : PASS

ROOT PAYMENT_FLOW OVERWRITE         : MUST REMOVE
LINK SNAPSHOT TIMING                 : MUST CORRECT
ORIGINAL_ORDER_ID SOURCE             : SERVER ONLY
PAYMENT HISTORY JOIN                 : MUST USE ORDER/META
CONTACT ID DOMAIN                    : MUST RESOLVE

```

После этих поправок план можно выполнять. Остальной Definition of Done и runtime-матрица сформулированы правильно.

&nbsp;

План: Finite bePaid installment — одна сделка, без локального schedule

## Этап 0. СТОП текущего Item 8

Отключить/откатить в коде без удаления файлов (файлы могут пригодиться для других сценариев рассрочки, если есть):

- В `supabase/functions/bepaid-webhook/index.ts` убрать вызовы `materializeFiniteInstallmentSchedule`, `advanceInstallmentCycleOnSuccess`, `annotateInstallmentCycleFailure`, `terminateFirstPendingInstallment` из ветки finite bePaid subv2.
- В `supabase/functions/_shared/charge-lifecycle-notifications.ts` — не вызывать для `model=bepaid_finite_subscription`. Provider-managed lifecycle уже покрыт существующими subscription-уведомлениями.
- Не публиковать frontend. Таблицу `installment_payments` НЕ трогать (используется другими flow).

## Этап 1. Canonical marker покупки

При создании finite bePaid installment (public-checkout + admin-create-public-link) сохранять неизменяемый snapshot в `orders_v2.meta`, `subscriptions_v2.meta`, `provider_subscriptions.meta`:

```json
{
  "payment_flow": "internal_installment",
  "installment": {
    "type": "internal",
    "provider": "bepaid",
    "model": "bepaid_finite_subscription",
    "billing_cycles": 5,
    "infinite": false,
    "original_order_id": "<uuid>",
    "per_payment_byn": 600,
    "effective_total_byn": 3000,
    "rounding_mode": "ceil_to_whole_byn",
    "rounding_delta_byn": 0
  }
}
```

Snapshot фиксирует параметры покупки — изменение оффера потом не должно влиять на уже созданную рассрочку.

## Этап 2. Узкая ветка маршрутизации в webhook

Единственное правило routing. В `supabase/functions/_shared/crm-routing.ts` (или на вызывающей стороне webhook перед REBILL-order веткой) добавить точный guard:

```ts
const isFiniteInternalInstallment =
  order.meta?.payment_flow === 'internal_installment' &&
  subscription.meta?.installment?.model === 'bepaid_finite_subscription' &&
  subscription.meta?.installment?.infinite === false &&
  Number(subscription.meta?.installment?.billing_cycles) >= 2;

if (isFiniteInternalInstallment) {
  paymentOrderId = subscription.meta.installment.original_order_id;
  createRebillOrder = false;
} else {
  // существующий flow без изменений
}
```

Требования:

- Маршрутизация читает **snapshot покупки**, не текущие настройки оффера.
- Признаки `auto_renew=false` / `provider=bepaid` / наличие `billing_cycles` сами по себе НЕ активируют ветку.
- `resolveOrderRouting` fallback для всех остальных подписок сохранён.

## Этап 3. Агрегация прогресса в исходной сделке

После каждого successful/failed webhook для finite internal installment обновлять `orders_v2.meta.installment_progress`:

```
billing_cycles, paid_billing_cycles, remaining_billing_cycles,
per_payment_byn, effective_total_byn,
paid_amount, remaining_amount, next_charge_at,
installment_status, provider_subscription_id
```

`paid_billing_cycles` — приоритет:

1. `paid_billing_cycles` из bePaid webhook.
2. Сохранённое значение `provider_subscriptions`.
3. Fallback: `COUNT(DISTINCT provider_payment_id)` succeeded `payments_v2` этой subscription.

Статусы: `active | completed | failed | canceled` — только на основании provider события. Локально retry не определяем.

Никаких `installment_payments` строк не создавать.

## Этап 4. UI: блок «Рассрочка bePaid» в исходной сделке

В карточке `orders_v2` (админский `DealDetail` / `OrderDetail`) отрендерить блок при наличии `meta.installment_progress` с `model=bepaid_finite_subscription`:

- Сводка: X из N, суммы, next_charge_at, provider_subscription_id.
- История: список фактических `payments_v2` этой subscription (`WHERE subscription_id = ...`), только реальные, без будущих строк.

## Этап 5. Вкладка «Рассрочки» в карточке контакта

`src/components/installments/ContactInstallments` — источник данных заменить/дополнить:

Запрос:

```
subscriptions_v2 JOIN provider_subscriptions JOIN orders_v2 (original)
WHERE user_id = :contact_id
  AND meta.installment.model = 'bepaid_finite_subscription'
  AND meta.payment_flow = 'internal_installment'
```

Одна карточка = одна рассрочка = одна исходная сделка. Группировка: Активные / Завершённые / Проблемные. Клик → исходная сделка.

Не показывать: обычные подписки клуба, бесконечные, Stripe, RR bank installment, счёт, разовые.

Существующие `installment_payments`-читатели (если есть для других сценариев) не трогать.

## Этап 6. Регрессионный аудит

Проверить, что НЕ изменилось:

- Обычная бесконечная подписка клуба → REBILL-flow работает как раньше.
- Подписки других продуктов, Stripe, разовые платежи, счёт, RR — без изменений.
- Существующие уведомления, доступы, Telegram/email, GetCourse, reconciliation не переопределены для не-finite веток.

## Runtime proof (6 сценариев + regression)


| #   | Сценарий                       | Ожидание                                                                      |
| --- | ------------------------------ | ----------------------------------------------------------------------------- |
| A   | Public N=2 через кнопку оффера | 1 сделка, provider `billing_cycles=2`, `infinite=false`, `amount=per_payment` |
| B   | Admin link N=5, total=3000     | `per_payment=600`, `billing_cycles=5`, оффер не изменён                       |
| C   | 1-й webhook                    | `payments_v2 count=1`, `order_id=original`, progress `1/5`, REBILL=0          |
| D   | 2-й webhook                    | `count=2`, оба на `original_order_id`, `2/5`, REBILL=0                        |
| E   | Дубль webhook с тем же UID     | новых `payments_v2=0`, прогресс не растёт, уведомление не повторяется         |
| F   | Финальный webhook              | `N/N`, `remaining=0`, `status=completed`, `next_charge_at=null`, REBILL=0     |
| R1  | Обычная подписка клуба         | старое поведение, REBILL-сделка создаётся как раньше                          |
| R2  | Дубль-guard                    | `auto_renew=false` без canonical marker → **не** попадает в новую ветку       |


## Технические файлы (ожидаемый scope изменений)

- `supabase/functions/bepaid-webhook/index.ts` — убрать Item 8 вызовы; добавить update `orders_v2.meta.installment_progress`; вызов узкого routing guard.
- `supabase/functions/_shared/crm-routing.ts` — точечная ветка `isFiniteInternalInstallment` перед REBILL-fallback.
- `supabase/functions/_shared/create-payment-checkout.ts` + `admin-create-public-link` — запись canonical marker в meta трёх таблиц.
- `src/components/installments/ContactInstallments.tsx` (+ query hook) — источник данных.
- Админский компонент карточки сделки — блок «Рассрочка bePaid».
- НЕ трогать: `installment_payments` таблицу и её потребителей, обычные subscription-notifications, Stripe, RR.

## Definition of Done

- Все 6 runtime сценариев PASS с реальным bePaid sandbox.
- R1/R2 регрессия PASS.
- Вкладка «Рассрочки» контакта показывает finite bePaid installment; пустой state исчезает для клиента с активной рассрочкой.
- Frontend НЕ публикуется (`FRONTEND PUBLISH: HOLD`).
- Отчёт по каждому пункту с evidence, без нового плана.