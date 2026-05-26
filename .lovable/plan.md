да, согласен, с учетом правок:

1. План правильный: сначала discovery, без cleanup и без отмены bePaid.

&nbsp;

2. Важно: в этом discovery нельзя выводить “64 подписки надо отменить” или “64 надо оставить”.

Нужно только классифицировать, что это:

- legacy_recurring_real;

- subscription_product_mismatch;

- ui_join_wrong;

- entitlement_product_mismatch;

- phantom_no_provider;

- manual_review.

&nbsp;

3. Добавить обязательную проверку по суммам:

- 55 BYN → должно маппиться на Gorbova Club / CHAT;

- 250 BYN → должно маппиться на Gorbova Club / BUSINESS;

- 230/250/900 BYN по ЗАКРОЙ ГОД не считать автоматически правильным без tariff_offer/order evidence.

&nbsp;

4. По Ирине Гайдук отдельно доказать:

- provider amount = 55 BYN;

- последние orders/payments = Gorbova Club / CHAT;

- какая конкретно subscriptions_v2.product_id/tariff_id стоит сейчас;

- какой entitlement.product_id стоит сейчас;

- откуда UI берёт “ЗАКРОЙ ГОД”.

Это контрольный кейс на B или C, а не на D/E.

&nbsp;

5. По Ольге Дещене отдельно доказать:

- provider subscription живой или нет;

- почему карточка доступа пишет “не продлевается”;

- есть ли active provider_subscriptions, связанный с её BUSINESS;

- есть ли active subscriptions_v2 с auto_renew=true;

- есть ли [entitlement.business](http://entitlement.business)_subscription_id.

Не делать вывод “provider dead” без доказательства.

&nbsp;

6. По Елизавете отдельно разделить:

- что реально phantom_no_provider;

- что может быть legacy_recurring_real;

- что связано с ошибкой product mapping.

Не смешивать с решением 2a/2b/2c/2d.

&nbsp;

7. Добавить поиск системного источника ошибки:

- последние патчи/миграции, которые могли переписать product_id/tariff_id;

- batch_id / audit_logs / [meta.repair](http://meta.repair)_batch / meta.source;

- совпадения по `phantom_recurring_cleanup`, `split_brain_repair`, `rebill_materialization`, `access_cleanup`.

Нужно понять, это UI join bug или реально данные были переписаны.

&nbsp;

8. Добавить анти-дубли:

если у одного provider_subscription есть больше одной subscriptions_v2 или у одной subscriptions_v2 больше одного provider_subscriptions — категория F manual_review_split_brain.

&nbsp;

9. В CSV добавить поля:

- ui_product_name_rendered;

- ui_tariff_name_rendered;

- ui_source_guess;

- provider_amount_match_offer_ids;

- last_order_product_name;

- sub_product_name;

- entitlement_product_name;

- suspected_repair_batch.

&nbsp;

10. В proof отдельно дать итог:

- сколько случаев можно чинить только UI;

- сколько случаев требуют relink subscriptions_v2;

- сколько случаев требуют correction entitlement;

- сколько случаев являются реальными legacy recurring;

- сколько случаев являются phantom без provider;

- сколько manual_review/split-brain.

Итоговая команда:

План PATCH-SUBSCRIPTION-PRODUCT-MAPPING-DISCOVERY-2026-05 принимаю.

&nbsp;

Запускать только read-only discovery.

&nbsp;

Запрещено:

- cleanup eligible-25;

- отмена bePaid;

- SQL UPDATE/INSERT/DELETE;

- правка UI;

- provider API;

- изменение subscriptions/entitlements/orders/payments.

&nbsp;

Обязательно разобрать 3 контрольных кейса:

- Ирина Гайдук — почему 55 BYN / Gorbova Club CHAT отображается как ЗАКРОЙ ГОД.

- Ольга Дещеня — почему BUSINESS-сделки есть, а доступ “не продлевается”.

- Елизавета Андреева — что phantom, что legacy, что mapping.

&nbsp;

Главный результат:

не исправлять сейчас, а разделить будущие repair-треки:

1. UI join fix;

2. subscriptions_v2 product/tariff relink;

3. entitlement product/tariff correction;

4. phantom cleanup без provider;

5. legacy recurring decision;

6. manual_review split-brain.

&nbsp;

Proof:

.lovable/proofs/subscription_product_mapping_discovery_2026_[05.md](http://05.md)

&nbsp;

CSV:

/mnt/documents/subscription_product_mapping_discovery_2026_05.csv

# План: PATCH-SUBSCRIPTION-PRODUCT-MAPPING-DISCOVERY-2026-05

## Статус предыдущего плана

STOP. Trek 1 (phantom_recurring_v1 cleanup, в т.ч. eligible-25) **замораживается полностью** до закрытия этого discovery. Никаких UPDATE/INSERT/DELETE/cancel/provider-вызовов. Backup-таблица не создаётся, миграция не подаётся.

Trek 2 (Елизавета 2a/2b/2c/2d) тоже ставится на паузу — её кейс входит в контрольные этого discovery.

## Цель

Read-only. Найти и классифицировать все случаи, где живая bePaid `provider_subscriptions` фактически относится к одному продукту/тарифу (по сумме / orders / payments), а локальная `subscriptions_v2` / `entitlements` / UI `ContactDetailSheet` показывают другой продукт/тариф/доступ.

Никаких изменений данных. Только сбор фактов, классификация, разделение «UI bug / linkage bug / entitlement bug / legacy recurring real / phantom без provider / manual_review».

## Запреты (жёсткие)

- Не вызывать bePaid API (никаких `bepaid-get-subscription-details`, `subscription-actions cancel/resume`, и т.п.).
- Не выполнять SQL `UPDATE/INSERT/DELETE` ни в одной таблице.
- Не трогать `subscriptions_v2`, `entitlements`, `access_rules`, `orders_v2`, `payments_v2`, `provider_subscriptions`, `telegram_access_queue`, `payment_methods`.
- Не выполнять Trek 1 cleanup (даже eligible-25).
- Не менять UI-код, edge functions, миграции.
- Не отменять, не «чинить» и не «гасить» ни одну живую bePaid-подписку.

## Scope (что разбираем)

Все строки из `provider_subscriptions` с `provider='bepaid'` и `state IN ('active','trial','past_due','pending')`. Для каждой — полный срез по 6 слоям ниже.

Обязательные контрольные кейсы (всегда в выборке, отдельной секцией в proof):

- Ирина Гайдук — `irina.borodzko@tut.by`
- Ольга Дещеня — `strekhao@yandex.ru`
- Елизавета Андреева — `elizaveta.andreeva.15@yandex.by`

## 6 слоёв на каждую provider_subscription

### 1. provider_subscriptions

`id, provider, provider_subscription_id, state, amount, currency, next_charge_at, last_charge_at, card_last4, subscription_v2_id, user_id, profile_id, meta.tracking_id`.

### 2. subscriptions_v2 (по `subscription_v2_id`)

`id, user_id, product_id, tariff_id, status, auto_renew, billing_type, access_start_at, access_end_at, order_id, cancel_at, meta` (выделить `meta.recurring_snapshot`, `meta.tracking_id`, `meta.bepaid_subscription_id`, `meta.model`).

### 3. orders_v2 + payments_v2

Все `orders_v2` пользователя по этой подписке (через `order_id` и через `payments_v2.provider_payment_id` linked к provider subscription / parent_subscription_id):
`order.id, order_number, product_id, tariff_id, offer_id, final_price, status, deal_date, paid_at, meta.payment_flow, meta.tracking_id`.
`payments_v2: id, order_id, amount, currency, status, provider, provider_payment_id, paid_at, meta.parent_subscription_id`.

Сравнить:

- `provider_subscriptions.amount` ↔ последние успешные `payments_v2.amount` ↔ `orders_v2.final_price`.
- `orders_v2.product_id/tariff_id` ↔ `subscriptions_v2.product_id/tariff_id`.

### 4. tariff_offers (резолв «правильного» продукта/тарифа по сумме)

Найти `tariff_offers` где `meta.recurring.is_recurring=true` и `amount == provider_subscriptions.amount` (с учётом валюты). Сопоставить с `product_id/tariff_id` из payments. Записать `expected_product_id`, `expected_tariff_id`, `expected_offer_id`.

### 5. entitlements

Все entitlements пользователя по затронутым продуктам: `id, user_id, product_id, status, source, source_order_id, access_end_at, meta.tariff_id, meta.business_subscription_id, meta.source_rule_id, meta.scope`.

Сравнить: `entitlement.product_id` ↔ `orders.product_id` ↔ `subscriptions_v2.product_id` ↔ `expected_product_id`.

### 6. UI source (read-only код-обзор, без правок)

Открыть `src/components/.../ContactDetailSheet*.tsx` и связанные хуки. Зафиксировать:

- Откуда подтягивается **название** продукта/тарифа в блоке «Подписки» (join на `subscriptions_v2` или `entitlements` или `orders_v2`?).
- Откуда подтягивается флаг «Автопродление включено / не продлевается» (`subscriptions_v2.auto_renew`? `provider_subscriptions.state`? `entitlements.meta`?).
- Где может произойти подмена `product_name` из-за неправильного join (например, join `entitlements → products` вместо `subscriptions_v2 → tariff → product`).

Результат — карта «UI поле → источник данных» в proof.

## Классификация (для каждой найденной аномалии)

- **A. `ui_join_wrong**` — provider+sub+orders+entitlement согласованы, но UI рендерит чужое имя продукта/тарифа или чужой auto-renew. Чинится только во фронте.
- **B. `subscription_product_mismatch**` — provider живой, payments/orders указывают на продукт X, а `subscriptions_v2.product_id/tariff_id` = продукт Y. (Гипотеза по Ирине.)
- **C. `entitlement_product_mismatch**` — orders/payments/sub правильные, но `entitlements` выдан не на тот продукт / не тот tariff_id в meta. (Гипотеза по «не продлевается» у Ольги, если entitlement привязан к другой sub.)
- **D. `legacy_recurring_real**` — продукт сейчас one-time по SOT (`tariff_offers.meta.recurring.is_recurring=false`), но bePaid subscription реально живая и ранее продавалась как recurring. **Не трогать.** Требует отдельного бизнес-решения (обновлять SOT / останавливать через support / оставлять).
- **E. `phantom_no_provider**` — `subscriptions_v2` recurring без живой `provider_subscriptions`. Только эта категория является кандидатом на будущий cleanup (но и он — отдельным патчем после approve).
- **F. `manual_review**` — несколько одновременных аномалий, конфликтующие данные, split-brain, дубли provider_subscription.

## Контрольные кейсы — обязательный ответ в DoD

1. **Ирина Гайдук** (`irina.borodzko@tut.by`): почему 55 BYN / Gorbova Club CHAT в сделках отображается как «ЗАКРОЙ ГОД» в блоках Подписки и Доступы. Указать конкретный source: подмена в `subscriptions_v2.product_id`, или подмена в `entitlements.product_id`, или UI join. Категория A/B/C.
2. **Ольга Дещеня** (`strekhao@yandex.ru`): почему BUSINESS-сделки идут и списания живые, а доступ «не продлевается». Указать, какое поле даёт «не продлевается» (`subscriptions_v2.auto_renew=false`? отсутствует sub? entitlement без `business_subscription_id`?). Категория A/B/C.
3. **Елизавета Андреева** (`elizaveta.andreeva.15@yandex.by`): для каждой её recurring-строки — категория (E phantom vs D legacy vs B mismatch). Без действий.

## Артефакты (только файлы, без миграций)

- `.lovable/proofs/subscription_product_mapping_discovery_2026_05.md` — нарратив: методология, SQL-выборки, карта «UI поле → источник», 3 контрольных кейса с разбором по 6 слоям, агрегированная таблица категорий A–F с количествами, итоговое разделение «что чинить в UI / что в subscriptions_v2 / что в entitlements / что реально phantom / что D legacy / что manual_review».
- `/mnt/documents/subscription_product_mapping_discovery_2026_05.csv` — построчно: `user_email, provider_subscription_id, provider_state, provider_amount, sub_v2_id, sub_product_id, sub_tariff_id, sub_auto_renew, last_payment_order_id, order_product_id, order_tariff_id, order_amount, expected_product_id_by_amount, entitlement_product_id, entitlement_tariff_id_meta, category(A|B|C|D|E|F), notes`.

## DoD

1. Все три контрольных кейса разобраны и классифицированы с конкретным root cause (поле + источник).
2. CSV сформирован по всем active/past_due/pending/trial provider_subscriptions bePaid.
3. Proof содержит карту «UI поле → источник данных» для блока «Подписки» и «Доступы» в `ContactDetailSheet`.
4. Явно разделены 4 будущих repair-трека (UI fix / subscriptions_v2 linkage fix / entitlements fix / phantom cleanup) — **без execute**.
5. Подтверждено в proof: ни одна bePaid-подписка не отменена, ни одна строка БД не изменена, Trek 1 cleanup не запускался.
6. Repair-plan по каждой категории — отдельным следующим патчем после approve этого discovery.

## Что НЕ входит

- Любой execute / repair / cleanup.
- Изменение SOT по recurring (`tariff_offers.meta.recurring.is_recurring`).
- Изменение UI-кода (только чтение и описание источников).
- bePaid API вызовы.
- Решение по Елизавете 2a/2b/2c/2d — переносится в следующий патч после classification.