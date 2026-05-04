да, согласен, с учетом правок:

1. **Patch 1 подтверждаю**
  - Новый `orders_v2` создавать **начиная со второго успешного rebill-платежа**.
  - Первый платёж остаётся в исходной link-сделке.
  - Каждый следующий успешный rebill → отдельная новая сделка.
  - Старые «толстые» сделки не трогать в этом патче.
2. **Не использовать суффикс** `-RB{n}`**, если есть общий генератор order_number**
  - Использовать существующий канонический генератор номеров.
  - В `meta` новой сделки писать:
    - `parent_order_id`;
    - `source='subscription_rebill'`;
    - `source_payment_id`;
    - `subscription_id`;
    - `rebill_sequence`.
3. **Refund-row должен быть совместим с legacy**
  - Для новых refund:
    - `transaction_type='refund'`;
    - `status='refunded'`;
    - `amount=-actualRefundAmount`;
    - `meta.type='refund'`;
    - `meta.parent_payment_id`;
  - На parent payment обновлять:
    - `refunded_amount = COALESCE(refunded_amount, 0) + actualRefundAmount`.
4. **Order status при partial refund**
  - Если refund < paidSum: `orders_v2.status` оставить `paid`.
  - Если refund >= paidSum: `orders_v2.status='refunded'`.
  - В `meta` добавить:
    - `partial_refund_total`;
    - `refund_status='partial' | 'full'`.
5. **DealDetailSheet должен поддерживать оба формата**
  - новый формат через `transaction_type='refund'`;
  - legacy формат через `meta.type='refund'` и отрицательный `amount`;
  - не считать refund-row в paidSum;
  - partial refund показывать amber даже если `deal.status='paid'`.
6. **Добавить диагностику в webhook**
  - Audit/log для rebill split:
    - `bepaid.webhook.rebill_order_spawned`;
    - `parent_order_id`;
    - `new_order_id`;
    - `provider_payment_id`;
    - `rebill_sequence`.
  - Если split не выполнен из-за guard — audit:
    - `bepaid.webhook.rebill_order_spawn_skipped`.
7. **Добавить idempotency**
  - По `provider_payment_id` не должно создаваться две сделки.
  - Если webhook повторился — найти уже созданный order/payment и вернуть idempotent success.
  - Никаких duplicate `orders_v2` на один provider payment.
8. **Memory rules — да**  
Создать/обновить правила:
  - `1 successful payment = 1 commercial deal`;
  - exception: refund-row может жить в той же сделке, что и parent payment;
  - partial refund state: parent `refunded_amount` + refund-row.
9. **Что не делать**
  - Не мигрировать исторические сделки сейчас.
  - Не трогать `grant-access`, Telegram, subscriptions repair.
  - Не запускать webhook replay.
  - Не менять `bepaid-process-refunds`, если он уже пишет корректный формат.

Можно выполнять fix причины.

&nbsp;

План: Diagnose → почему не сработали существующие правила «1 платёж = 1 сделка» и «частичный возврат» на сделке `#SUB-LINK-MNIQS4P0`

## 0. Контекст по конкретному кейсу (read-only из БД, подтверждено)

`orders_v2` `4eaa9e40-…` (`SUB-LINK-MNIQS4P0`, status=`refunded`, final_price=250):

- payment 03.04.26  +250  status=`succeeded` transaction_type=`Платеж`  refunded_amount=`0`
- payment 03.05.26  +250  status=`succeeded` transaction_type=`payment` refunded_amount=`0`  meta.source=`link_order_subscription_webhook`
- payment 04.05.26  −80   status=`succeeded` transaction_type=`payment` refunded_amount=`0`  meta.type=`refund` meta.parent_payment_id=…

То есть в одной сделке три платежа (баг #1), а refund записан как обычный «успешный» платёж с отрицательной суммой и `meta.type=refund` (баг #2). Бейдж UI считает paidSum/refundedSum по полям `status` и `refunded_amount` — и получает `refundedSum=0`, поэтому НЕ показывает «Частичный возврат».

## 1. Diagnose — что именно сломано

### Баг A. «1 платёж = 1 сделка» не существует для recurring rebill

Файл: `supabase/functions/bepaid-webhook/index.ts`, ветка `WEBHOOK-LINK-ORDER`, строки 2325–2385.

Логика жёстко прибивает все recurring-платежи к **исходному** `linkOrder.id`:

```
const p5OrderId = (existingPayForP5?.order_id) ? existingPayForP5.order_id : linkOrder.id;
const paymentPayload = { order_id: p5OrderId, ... is_recurring: true, ... };
```

Никакого спавна нового `orders_v2` под каждое списание. Декларированного «patch: payment-per-order» в репозитории нет: `rg "payment.*deal\|one-payment-one-deal\|rebill.*new.*order"` пусто, мемори-файла на эту тему тоже нет (только `Rebill Idempotency` про дедуп, не про спавн заказа).

→ Поэтому в сделке оказывается 2 успешных платежа за разные даты.

### Баг B. UI-классификатор «Частичный возврат» неконсистентен с writer-ом refund

Файл: `src/components/admin/DealDetailSheet.tsx`, строки 460–478. Условие:

```
status === 'paid' || status === 'succeeded' || status === 'refunded'  → paidSum += amount
refundedSum += refunded_amount
isPartialRefund = refundedSum > 0 && paidSum > 0 && refundedSum + 0.01 < paidSum
```

Но writer refund-а (`subscription-admin-actions/index.ts` стр. 432–454) пишет refund так:

```
amount: -actualRefundAmount,
status: 'succeeded',
meta.type: 'refund',
meta.parent_payment_id: ...
// refunded_amount НЕ заполняется ни здесь, ни на родительском платеже
```

Получаем:

- refund-row с `amount=-80` попадает в `paidSum` (т.к. status='succeeded') → paidSum завышается, partial-логика всё равно бы упала
- `refunded_amount` нигде не выставляется → `refundedSum=0` → `isPartialRefund=false`
- бейдж берёт `STATUS_CONFIG['refunded']` = «Возврат», красный — то, что мы видим на скриншоте.

То есть писатель refund-а и читатель partial-state используют разные модели данных. Patch в memory-индексе («Partial Refund State — Amber badge for refunded < paidSum commercial status») заявлен, но writer не обновлён, поэтому условие никогда не срабатывает на реальных данных.

### Баг C. (вытекает из A) Возврат всегда применяется к «всей сделке»

Так как сделка содержит несколько списаний (250+250), а UI/refund считает `final_price=250` против `paidSum>=500`, классификация бейджа дополнительно искажена. Корень — баг A.

## 2. Что НЕ нужно создавать заново

- `RefundDialog`, `subscription-admin-actions` (action=`refund`), `bepaid-webhook` (`WEBHOOK-LINK-ORDER`), `DealDetailSheet` partial-логика — всё уже есть. Чинятся, не пересоздаются.
- Memory-файла «one-payment-one-deal» нет → его создание потребуется, но на этапе fix, не сейчас.
- Backup/SQL-репейр истории — НЕ в этом плане. Только починка причины.

## 3. Plan фикса (сам fix будет в default-mode после approve этого плана)

### Patch 1 — bepaid-webhook: spawn нового orders_v2 на каждый rebill

- В `WEBHOOK-LINK-ORDER` (после идемпотентного guard по `provider_payment_id`) определить, является ли событие первой оплатой ссылки или последующим rebill (есть ли уже `payments_v2` с этим subscription_id и статусом succeeded).
- Если rebill: создать **новый** `orders_v2` со ссылкой `meta.parent_order_id = linkOrder.id`, `meta.source='subscription_rebill'`, тем же `product_id/tariff_id/user_id`, `final_price=paymentAmount`, `status='paid'`. Номер — текущий генератор + суффикс `-RB{n}` или новый канонический формат, если существует.
- Платёж писать с `order_id = newOrder.id`, не `linkOrder.id`.
- CRM-routing/payment_link consume вызывать только для первичной оплаты.

### Patch 2 — subscription-admin-actions: правильная запись refund

В блоке вставки refund-row (стр. 432–454):

- `transaction_type: 'refund'` (явно), `status: 'refunded'`, `amount: -actualRefundAmount` (как сейчас).
- В **родительском** `payments_v2` (по `provider_payment_id = parent_uid`) увеличить `refunded_amount += actualRefundAmount` (одной транзакцией с insert).
- В `orders_v2.status` ставить `'refunded'` только если суммарный refund по сделке ≥ суммарного paid. Иначе оставить `'paid'` и положить в `meta.partial_refund_total`.

### Patch 3 — DealDetailSheet: классификатор partial → согласован с writer

- `paidSum` считать только по платежам, у которых `transaction_type` НЕ refund **и** `meta?.type !== 'refund'` **и** `amount > 0`.
- `refundedSum` считать как `Σ refunded_amount` по платежам **плюс** `Σ |amount|` по refund-rows (на случай legacy данных).
- `isPartialRefund = refundedSum > 0 && refundedSum + 0.01 < paidSum` (без обязательного `deal.status==='refunded'` — partial может быть и при `paid`).
- Бейдж жёлтый «Частичный возврат» как сейчас.

### Patch 4 — Memory rules

- `mem://commercial-logic/orders/one-payment-one-deal` — каждый успешный rebill должен порождать новый `orders_v2`; единственная допустимая множественность в одной сделке — пара «платёж + (частичный)возврат» по одному `provider_payment_id`.
- Обновить существующее правило про partial refund: указать точные поля (`refunded_amount` на родительском, `transaction_type='refund'` + `status='refunded'` на refund-row).

### Что НЕ делается этим патчем

- Историческая миграция уже существующих «толстых» сделок с N платежами → отдельный repair-план после approve фикса причины.
- Никаких grant/revoke/replay/webhook-replay.
- Никаких изменений в `bepaid-process-refunds` (он работает с очередью; формат refund там корректный, проблема — в admin-инициированном пути).

## 4. DoD после фикса

1. На новой recurring-оплате через `WEBHOOK-LINK-ORDER` создаётся новый `orders_v2`, в нём ровно 1 успешный платёж.
2. На новом частичном refund: `payments_v2` содержит refund-row с `transaction_type='refund'` + `status='refunded'`; на родительском `refunded_amount` = сумма возврата; `orders_v2.status='paid'` (если refund < paid).
3. На сделке с partial-refund в `DealDetailSheet` бейдж = «Частичный возврат» (amber).
4. На сделке с full-refund бейдж = «Возврат» (красный) — без регрессии.
5. Memory-правила записаны.

## 5. Вопрос на approve

Подтверждаешь ли scope в Patch 1 (создавать новый `orders_v2` на каждый rebill начиная с момента деплоя; старые «толстые» сделки оставить как есть до отдельного repair-плана)? Или нужно чтобы новый order создавался начиная **со второго** платежа (тогда первый платёж остаётся в исходной link-сделке, как и было)?