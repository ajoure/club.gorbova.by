План: Diagnose desync платежей/возвратов в карточке сделки + сверка с bePaid + починка linkage и UI

## Diagnose (что я уже проверил в БД и сверил с bePaid)

Сделка `SUB-26-MMOP3Z026XWH` = `orders_v2.id = 11adac7b-3f31-4267-b8e2-da54bba4b57c`, создана 13.03.2026, продукт Gorbova Club, владелец `lori-30@tut.by` (user `e748983f-…`).

Что реально привязано к этому order_id в `payments_v2` (3 строки):

```

ID                                    paid_at              type             provider_payment_id (=bePaid uid)

52229463-188a-4d03-8983-5b584c3433c5  2026-03-13 09:31:55  Платеж           aa391ec7-218e-46ed-bafc-d01a07d7a608   ← оригинал, OK

7a64cd04-3d08-4c9f-a81b-d50b7383edf6  2026-05-13 03:00:14  Платеж           e2eedd12-f1dc-4af4-8d3a-feae6956b39c   ← чужой автоплатёж старой sbs

49825c85-07e5-4493-b086-f3cfd79b2545  2026-05-14 11:00:35  Возврат средств  6e4a67ff-f71a-4edd-9d63-89c16b44b9bf   ← refund 13.05 платежа

```

Сверка с bePaid (скрин [merchant.bepaid.by](http://merchant.bepaid.by), фильтр по [lori-30@tut.by](mailto:lori-30@tut.by), Gorbova Club):

```

bePaid uid                            операция         BYN    дата

6e4a67ff-…b9bf                         Возврат средств  250    14.05 14:00   ✓ совпадает (id 49825c85)

e2eedd12-…b39c                         Платёж           250    13.05 06:00   ✓ совпадает (id 7a64cd04)

e3965e9b-…f780                         Платёж           250    12.05 21:21   ✓ есть (id 421d6884, привязан к SUB-LINK-MP2YGAG4)

80010eae-…3f71                         Платёж (failed)  250    12.05 12:45   ✓ есть (id 405f1e72, без order)

49c8f8f9-…3639                         Платёж           250    14.04 06:00   ✓ есть (id 0e530a8c, REBILL-0e530a8c-3eb)

…                                      …                …      …             все 27 строк bePaid находятся в payments_v2

```

Расхождений по самим платежам с bePaid нет. Все суммы и uid сходятся. Проблема — в **linkage** (какой платёж к какому order_id и какой подписке относится) и в **UI карточки сделки**, который не показывает возврат.

### Корень «хуйни» — найдено 5 дефектов

1. **Дублирующая bePaid-подписка не была заблокирована duplicate-guard'ом.**  

   На один продукт Gorbova Club у пользователя одновременно жили две bePaid-подписки:  

   - старая `sbs_d0a38a4774c31891` (sub_v2 `ceb80b6f-…`, создана 13.03.2026, отменена админом 14.05.2026 11:00),  

   - новая `sbs_e58bb848165cb713` (sub_v2 `b749abfb-…`, создана 12.05.2026 через public link `SUB-LINK-MP2YGAG4`).  

   Это нарушает Duplicate Subscription Prevention Guard.

2. **Автосписание 13.05 по СТАРОЙ sbs пристёгнуто к initial-order, а не к новому REBILL-order.**  

   В апреле тот же сценарий породил отдельный `orders_v2.order_number = 'REBILL-0e530a8c-3eb'`. На майском цикле webhook привязал платёж e2eedd12 к `11adac7b` (мартовский initial-order). Регрессия в `bepaid-webhook` для sbs `sbs_d0a38a4774c31891`.

3. **Этим же чужим платежом продлили НОВУЮ подписку `b749abfb`.**  

   В её `meta.extended_by_orders` лежит `[15927402-…, 11adac7b-…]`, последний extension 13.05 03:00 +30 дней. То есть `grant-access-for-order` принял платёж старой sbs и продлил новую sub. Совпали `user_id + product_id + tariff_id`, но `bepaid_subscription_id` платежа != bepaid_subscription_id подписки.

4. **Refund-row в payments_v2 не связан с parent-платежом и не уменьшает `refunded_amount` родителя.**  

   - `49825c85.meta.parent_payment_id = NULL`,  

   - `49825c85.amount = +250` (а не `-250`),  

   - `7a64cd04.refunded_amount = 0`.  

   Из-за этого `DealDetailSheet` не находит refund для парного платежа и показывает обе строки как «Оплачен», без бейджа «Частичный возврат».

5. *`deal_date` сделки сдвигается под последний привязанный платёж.**  

   Карточка показывает «13 мая 2026, 05:00» при «Месяц сделки: Март 2026» — заголовок берётся из последнего payment_at, а месяц — из `deal_date`. Из-за дефекта №2 чужой майский платёж переименовал заголовок мартовской сделки.

## Что должно быть (целевая модель)

- Каждое успешное автосписание bePaid создаёт **отдельный orders_v2** `REBILL-…`) и привязывается только к нему.

- `grant-access-for-order` продлевает **только ту** subscription_v2, чей `bepaid_subscription_id` == bepaid_subscription платежа. Совпадения `product_id + tariff_id` недостаточно (актуализируем правило Extend ↔ Tariff Match).

- `bepaid-webhook.refund` пишет refund-row с:  

  - `meta.parent_payment_id = <uuid родителя>`,  

  - `amount = -X` (или строго положительный, но при этом обновлять `parent.refunded_amount += X` атомарно),  

  - проставляет `parent.refunded_amount` и `orders_v2.refunded_amount`.

- Карточка сделки показывает refund-строку под parent-платежом с бейджем «Возврат N BYN», статус сделки = `partial_refund` / `fully_refunded` по правилу `partial-refund-state`.

- Заголовок и месяц сделки берутся из `orders_v2.deal_date` (не из последнего payment).

## Этапы

### Этап 1 — Reconcile-репорт по этой сделке (read-only)

1. Сверить все 27 платежей Ларисы payments_v2 ↔ bePaid по `provider_payment_id`, выписать расхождения по: order_id, transaction_type, amount, parent_payment_id, refunded_amount.

2. По каждой sub_v2 пользователя `ceb80b6f`, `b749abfb`) построить таблицу `extended_by_orders` ↔ owning bepaid_subscription_id платежа.

3. Сохранить в `.lovable/proofs/inv_deal_linkage_lori_30_2026_05.md` (snapshot до правок).

### Этап 2 — Точечный data-repair по этой сделке (по согласованию)

1. **Перепривязать** payment `7a64cd04` (13.05 250 BYN) с `order_id = 11adac7b` на новый `orders_v2 REBILL-…` той же sbs `ceb80b6f` (создать REBILL-order по образцу апрельского `06b224ab`), `deal_date = 2026-05-13`.

2. **Перепривязать** refund `49825c85` к новому REBILL-order; проставить `meta.parent_payment_id = 7a64cd04`, `parent.refunded_amount = 250`, `orders_v2.refunded_amount = 250`, `orders_v2.status = 'refunded'`.

3. Откатить из `b749abfb.meta.extended_by_orders` запись `11adac7b` и пересчитать `access_end_at` НОВОЙ подписки от 12.05 + 30 дней (без чужого продления). Старая sub `ceb80b6f` (cancelled) трогать не нужно.

4. Аудит-логи `payment.relinked.deal_repair_2026_05`, `refund.parent_link_repaired`, `subscription.access_end_at.recompute`.

5. Verify: на карточке сделки `SUB-26-MMOP3Z026XWH` остаётся ровно одна оплата 13.03 250 BYN, заголовок «13 марта 2026», месяц «Март 2026», без 13.05 платежа и без refund-строки. Карточка REBILL-сделки за 13.05 показывает «Платёж 250 + Возврат 250 = Полный возврат».

### Этап 3 — Корневые правки кода (не data-fix)

1. `bepaid-webhook` (renewal handler): на каждый успешный autocharge старой sbs создаём `REBILL-` order через canonical write-path, привязываем платёж к нему, не к initial-order.

2. `bepaid-webhook` (refund handler): резолвим parent по `provider_payment_id` из refund payload `payment.uid` или `parent_uid`), пишем `parent.refunded_amount`, `meta.parent_payment_id`, обновляем `orders_v2.refunded_amount/status`.

3. `grant-access-for-order` (recurring path): продлеваем подписку **только** при матче `bepaid_subscription_id` платежа и подписки, плюс существующий tariff_id-match. Иначе → audit `skip_extend_bepaid_subscription_mismatch` + создаём новую sub-цепочку либо помечаем `manual_review`.

4. Duplicate Subscription Prevention Guard: при создании public-link checkout проверяем активные sbs того же `(user_id, product_id)` через `bepaid-get-subscription-details` (не только локально), блокируем дубль.

5. `DealDetailSheet`: заголовок и месяц брать только из `orders_v2.deal_date`, никогда из `max(payment_at)`.

### Этап 4 — Sweep по остальным сделкам (после verify Этапа 2)

SQL-выборка: payments_v2, у которых `transaction_type='Платеж'` И `paid_at - order.created_at > 25 дней`, И order имеет более 1 успешного «Платеж» — кандидаты на mis-linkage по сценарию №2. Отдельный план execute по итогам dry-run.

## Технические детали (для разработчика, не для пользователя)

- Затрагиваемые edge-функции: `bepaid-webhook`, `grant-access-for-order`, `admin-create-public-link`, `subscription-admin-actions` (refund-ветка уже починена в прошлой задаче, но нужно дополнить установкой `parent_payment_id` и `parent.refunded_amount += amount` в идемпотентной транзакции).

- Затрагиваемый UI: `src/components/admin/DealDetailSheet.tsx` — секции заголовка сделки и блока «Оплаты».

- Read-only БД-зависимости для verify: `orders_v2`, `payments_v2`, `subscriptions_v2`, `audit_logs`.

- Не трогаем: `entitlements`, `access_rules`, telegram grants — здесь они вне сценария.

## Definition of Done

1. По Ларисе: карточки `SUB-26-MMOP3Z026XWH` и нового `REBILL-…` соответствуют bePaid 1:1 по суммам и датам, refund отображается и считается.

2. Sweep отчёт показывает 0 новых mis-linked платежей после деплоя п.3.1–3.5.

3. `.lovable/proofs/inv_deal_linkage_lori_30_2026_05.md` содержит before/after снапшоты и checksum по `payments_v2` и `orders_v2` затронутых строк.

4. Регресс-тесты bepaid-webhook (refund + autocharge) добавлены в `supabase/functions/bepaid-webhook/*_test.ts`.

Перед запуском Этапа 2 нужно ваше «ок» — это правки данных по живому пользователю.

&nbsp;

&nbsp;

План: Diagnose desync платежей/возвратов в карточке сделки + сверка с bePaid + починка linkage и UI

## Diagnose (что я уже проверил в БД и сверил с bePaid)

Сделка `SUB-26-MMOP3Z026XWH` = `orders_v2.id = 11adac7b-3f31-4267-b8e2-da54bba4b57c`, создана 13.03.2026, продукт Gorbova Club, владелец `lori-30@tut.by` (user `e748983f-…`).

Что реально привязано к этому order_id в `payments_v2` (3 строки):

```
ID                                    paid_at              type             provider_payment_id (=bePaid uid)
52229463-188a-4d03-8983-5b584c3433c5  2026-03-13 09:31:55  Платеж           aa391ec7-218e-46ed-bafc-d01a07d7a608   ← оригинал, OK
7a64cd04-3d08-4c9f-a81b-d50b7383edf6  2026-05-13 03:00:14  Платеж           e2eedd12-f1dc-4af4-8d3a-feae6956b39c   ← чужой автоплатёж старой sbs
49825c85-07e5-4493-b086-f3cfd79b2545  2026-05-14 11:00:35  Возврат средств  6e4a67ff-f71a-4edd-9d63-89c16b44b9bf   ← refund 13.05 платежа
```

Сверка с bePaid (скрин merchant.bepaid.by, фильтр по [lori-30@tut.by](mailto:lori-30@tut.by), Gorbova Club):

```
bePaid uid                            операция         BYN    дата
6e4a67ff-…b9bf                         Возврат средств  250    14.05 14:00   ✓ совпадает (id 49825c85)
e2eedd12-…b39c                         Платёж           250    13.05 06:00   ✓ совпадает (id 7a64cd04)
e3965e9b-…f780                         Платёж           250    12.05 21:21   ✓ есть (id 421d6884, привязан к SUB-LINK-MP2YGAG4)
80010eae-…3f71                         Платёж (failed)  250    12.05 12:45   ✓ есть (id 405f1e72, без order)
49c8f8f9-…3639                         Платёж           250    14.04 06:00   ✓ есть (id 0e530a8c, REBILL-0e530a8c-3eb)
…                                      …                …      …             все 27 строк bePaid находятся в payments_v2
```

Расхождений по самим платежам с bePaid нет. Все суммы и uid сходятся. Проблема — в **linkage** (какой платёж к какому order_id и какой подписке относится) и в **UI карточки сделки**, который не показывает возврат.

### Корень «хуйни» — найдено 5 дефектов

1. **Дублирующая bePaid-подписка не была заблокирована duplicate-guard'ом.**
  На один продукт Gorbova Club у пользователя одновременно жили две bePaid-подписки:  
  - старая `sbs_d0a38a4774c31891` (sub_v2 `ceb80b6f-…`, создана 13.03.2026, отменена админом 14.05.2026 11:00),  
  - новая `sbs_e58bb848165cb713` (sub_v2 `b749abfb-…`, создана 12.05.2026 через public link `SUB-LINK-MP2YGAG4`).  
   Это нарушает Duplicate Subscription Prevention Guard.
2. **Автосписание 13.05 по СТАРОЙ sbs пристёгнуто к initial-order, а не к новому REBILL-order.**
  В апреле тот же сценарий породил отдельный `orders_v2.order_number = 'REBILL-0e530a8c-3eb'`. На майском цикле webhook привязал платёж e2eedd12 к `11adac7b` (мартовский initial-order). Регрессия в `bepaid-webhook` для sbs `sbs_d0a38a4774c31891`.
3. **Этим же чужим платежом продлили НОВУЮ подписку `b749abfb`.**
  В её `meta.extended_by_orders` лежит `[15927402-…, 11adac7b-…]`, последний extension 13.05 03:00 +30 дней. То есть `grant-access-for-order` принял платёж старой sbs и продлил новую sub. Совпали `user_id + product_id + tariff_id`, но `bepaid_subscription_id` платежа != bepaid_subscription_id подписки.
4. **Refund-row в payments_v2 не связан с parent-платежом и не уменьшает `refunded_amount` родителя.**
  - `49825c85.meta.parent_payment_id = NULL`,  
  - `49825c85.amount = +250` (а не `-250`),  
  - `7a64cd04.refunded_amount = 0`.  
   Из-за этого `DealDetailSheet` не находит refund для парного платежа и показывает обе строки как «Оплачен», без бейджа «Частичный возврат».
5. `**deal_date` сделки сдвигается под последний привязанный платёж.**
  Карточка показывает «13 мая 2026, 05:00» при «Месяц сделки: Март 2026» — заголовок берётся из последнего payment_at, а месяц — из `deal_date`. Из-за дефекта №2 чужой майский платёж переименовал заголовок мартовской сделки.

## Что должно быть (целевая модель)

- Каждое успешное автосписание bePaid создаёт **отдельный orders_v2** (`REBILL-…`) и привязывается только к нему.
- `grant-access-for-order` продлевает **только ту** subscription_v2, чей `bepaid_subscription_id` == bepaid_subscription платежа. Совпадения `product_id + tariff_id` недостаточно (актуализируем правило Extend ↔ Tariff Match).
- `bepaid-webhook.refund` пишет refund-row с:  
  - `meta.parent_payment_id = <uuid родителя>`,  
  - `amount = -X` (или строго положительный, но при этом обновлять `parent.refunded_amount += X` атомарно),  
  - проставляет `parent.refunded_amount` и `orders_v2.refunded_amount`.
- Карточка сделки показывает refund-строку под parent-платежом с бейджем «Возврат N BYN», статус сделки = `partial_refund` / `fully_refunded` по правилу `partial-refund-state`.
- Заголовок и месяц сделки берутся из `orders_v2.deal_date` (не из последнего payment).

## Этапы

### Этап 1 — Reconcile-репорт по этой сделке (read-only)

1. Сверить все 27 платежей Ларисы payments_v2 ↔ bePaid по `provider_payment_id`, выписать расхождения по: order_id, transaction_type, amount, parent_payment_id, refunded_amount.
2. По каждой sub_v2 пользователя (`ceb80b6f`, `b749abfb`) построить таблицу `extended_by_orders` ↔ owning bepaid_subscription_id платежа.
3. Сохранить в `.lovable/proofs/inv_deal_linkage_lori_30_2026_05.md` (snapshot до правок).

### Этап 2 — Точечный data-repair по этой сделке (по согласованию)

1. **Перепривязать** payment `7a64cd04` (13.05 250 BYN) с `order_id = 11adac7b` на новый `orders_v2 REBILL-…` той же sbs `ceb80b6f` (создать REBILL-order по образцу апрельского `06b224ab`), `deal_date = 2026-05-13`.
2. **Перепривязать** refund `49825c85` к новому REBILL-order; проставить `meta.parent_payment_id = 7a64cd04`, `parent.refunded_amount = 250`, `orders_v2.refunded_amount = 250`, `orders_v2.status = 'refunded'`.
3. Откатить из `b749abfb.meta.extended_by_orders` запись `11adac7b` и пересчитать `access_end_at` НОВОЙ подписки от 12.05 + 30 дней (без чужого продления). Старая sub `ceb80b6f` (cancelled) трогать не нужно.
4. Аудит-логи `payment.relinked.deal_repair_2026_05`, `refund.parent_link_repaired`, `subscription.access_end_at.recompute`.
5. Verify: на карточке сделки `SUB-26-MMOP3Z026XWH` остаётся ровно одна оплата 13.03 250 BYN, заголовок «13 марта 2026», месяц «Март 2026», без 13.05 платежа и без refund-строки. Карточка REBILL-сделки за 13.05 показывает «Платёж 250 + Возврат 250 = Полный возврат».

### Этап 3 — Корневые правки кода (не data-fix)

1. `bepaid-webhook` (renewal handler): на каждый успешный autocharge старой sbs создаём `REBILL-` order через canonical write-path, привязываем платёж к нему, не к initial-order.
2. `bepaid-webhook` (refund handler): резолвим parent по `provider_payment_id` из refund payload (`payment.uid` или `parent_uid`), пишем `parent.refunded_amount`, `meta.parent_payment_id`, обновляем `orders_v2.refunded_amount/status`.
3. `grant-access-for-order` (recurring path): продлеваем подписку **только** при матче `bepaid_subscription_id` платежа и подписки, плюс существующий tariff_id-match. Иначе → audit `skip_extend_bepaid_subscription_mismatch` + создаём новую sub-цепочку либо помечаем `manual_review`.
4. Duplicate Subscription Prevention Guard: при создании public-link checkout проверяем активные sbs того же `(user_id, product_id)` через `bepaid-get-subscription-details` (не только локально), блокируем дубль.
5. `DealDetailSheet`: заголовок и месяц брать только из `orders_v2.deal_date`, никогда из `max(payment_at)`.

### Этап 4 — Sweep по остальным сделкам (после verify Этапа 2)

SQL-выборка: payments_v2, у которых `transaction_type='Платеж'` И `paid_at - order.created_at > 25 дней`, И order имеет более 1 успешного «Платеж» — кандидаты на mis-linkage по сценарию №2. Отдельный план execute по итогам dry-run.

## Технические детали (для разработчика, не для пользователя)

- Затрагиваемые edge-функции: `bepaid-webhook`, `grant-access-for-order`, `admin-create-public-link`, `subscription-admin-actions` (refund-ветка уже починена в прошлой задаче, но нужно дополнить установкой `parent_payment_id` и `parent.refunded_amount += amount` в идемпотентной транзакции).
- Затрагиваемый UI: `src/components/admin/DealDetailSheet.tsx` — секции заголовка сделки и блока «Оплаты».
- Read-only БД-зависимости для verify: `orders_v2`, `payments_v2`, `subscriptions_v2`, `audit_logs`.
- Не трогаем: `entitlements`, `access_rules`, telegram grants — здесь они вне сценария.

## Definition of Done

1. По Ларисе: карточки `SUB-26-MMOP3Z026XWH` и нового `REBILL-…` соответствуют bePaid 1:1 по суммам и датам, refund отображается и считается.
2. Sweep отчёт показывает 0 новых mis-linked платежей после деплоя п.3.1–3.5.
3. `.lovable/proofs/inv_deal_linkage_lori_30_2026_05.md` содержит before/after снапшоты и checksum по `payments_v2` и `orders_v2` затронутых строк.
4. Регресс-тесты bepaid-webhook (refund + autocharge) добавлены в `supabase/functions/bepaid-webhook/*_test.ts`.

Перед запуском Этапа 2 нужно ваше «ок» — это правки данных по живому пользователю.