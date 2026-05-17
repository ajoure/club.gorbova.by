да, согласен, с учетом правок:

1. **Везде различать profile_id и user_id.**  
Для entitlements, subscriptions_v2, grant-access-for-order ключом должен быть фактический user_id.  
profile_id использовать только для UI/контакта, если это отдельное поле.
2. **Поля subscriptions_v2.provider_subscription_id и current_period_start/end не считать гарантированными.**  
Проверять фактическую схему. Если этих колонок нет, брать связь через:

provider_subscriptions.subscription_v2_id

provider_subscriptions.provider_subscription_id

subscriptions_v2.meta.bepaid_subscription_id

subscriptions_v2.access_start_at / access_end_at / next_charge_at

3. **Idempotency check расширить.**  
Проверять не только:

meta.rebill.source_payment_id

meta.rebill.provider_payment_id

но и все уже используемые форматы:

order_number = REBILL-<first12(payment_id)>

meta.materialized_from_payment_id = payment_id

meta.materialized_from_payment_uid = provider_payment_id

provider_payment_id = provider_payment_id AND order_number LIKE 'REBILL-%'

meta.source = 'h5_historical_repair' / 'rebill_materialization'

4. **grant-access-for-order rollback убрать из rollback-plan.**  
Доступы вручную не откатываются. Если needs_grant_access_call=true, это должен быть отдельный approve или отдельный подэтап с idempotency-check. В RB2 dry-run только определить, нужен grant или нет.
5. **Для historical repair по умолчанию считать financial_only_repair=true, если доступ уже покрыт.**  
То есть REBILL-order + payment rebind, без повторного grant, если:

subscription.access_end_at уже >= ожидаемого срока

entitlement.expires_at уже >= subscription.access_end_at

6. **По Юлии Смолик сделать ID-first уточнение.**  
Если 113f7667… не находится в payments_v2, dry-run обязан не гадать, а вывести все candidate payments Юлии за период и дать точный payment_id/provider_payment_id, который предлагается к repair.
7. **audit_logs INSERT: 2 — только для будущего execute.**  
В текущем dry-run audit_logs не писать. В proof явно указать: expected execute audit rows = 2, actual dry-run audit rows = 0.
8. **Добавить общий verdict по каждому кейсу:**

ready_for_execute_financial_only

ready_for_execute_with_grant_proposal

manual_review_orphan_parent_missing

manual_review_uid_mismatch

manual_review_already_materialized

manual_review_sbs_mismatch

manual_review_access_state_unknown

9. **Команда на запуск:**

План PATCH-RB2 dry-run подтверждаю с правками.

&nbsp;

Выполни строго read-only:

- проверить 3 historical REBILL-кейса;

- по каждому доказать payment → parent → subscription/provider chain;

- проверить already_materialized по всем форматам;

- проверить access_extended_legacy;

- определить financial_only_repair / needs_grant_access_call;

- по Юлии Смолик зафиксировать точный payment_id/provider_payment_id или manual_review;

- подготовить rollback-plan только для финансового repair;

- создать proof.

&nbsp;

Запрещено:

- DML;

- audit_logs INSERT;

- grant-access-for-order;

- Telegram;

- provider API;

- изменения subscriptions_v2 / entitlements / payments_v2 / orders_v2;

- secrets/mode changes.

&nbsp;

Proof:

.lovable/proofs/rebill_materialization_three_cases_dryrun_2026_[05.md](http://05.md)

&nbsp;

Execute RB2 — только после отдельного approve.

Суть: план правильный, но dry-run должен доказать, **нужен ли только финансовый repair или ещё продление доступа**. Исторические кейсы нельзя автоматически прогонять через grant, если доступ уже был продлён legacy-веткой.

План: PATCH-RB2 dry-run по 3 historical REBILL-кейсам

## Контекст

PATCH-RB1.1 закрыт условно успешно. `BEPAID_REBILL_MATERIALIZATION=on` оставлен. Параллельно ждём следующий live repeat payment как runtime proof новой ветки. В этом плане — отдельный read-only dry-run RB2 для трёх historical платежей, которые уже приклеились к parent-сделке и должны быть переразложены на REBILL-orders.

## Scope — 3 кейса


| #   | Клиент                                               | provider_payment_id                                                                                                                                                                                                                                                             | payment_id                             | parent order                                                 | сумма   |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ | ------- |
| 1   | Юлия Смолик (`sm_ulik@mail.ru`, profile `00339a5f…`) | `ee00714f-cb58-4630-a931-d1e065249d54` (последний repeat; uid `113f7667…` из переписки в `payments_v2`/`orders_v2` не находится — dry-run обязан зафиксировать фактический uid через provider-журнал/audit_logs и подтвердить, что речь именно об этом repeat-кейсе на 100 BYN) | `9dfdd0ac-b04b-4dd7-b182-635f5ff4ab9b` | `166aa9d2-00d1-4114-952f-93b354b8cac1` (PAY-26-MOGE0XXG)     | 100 BYN |
| 2   | Ольга Черкашина (profile `6112b4d0…`)                | `21613f63-dc85-406f-a8dd-34a936bc0784`                                                                                                                                                                                                                                          | `4a9288d3-d2b1-4bc0-984a-8900d1664da3` | `57fcc9d8-a665-48a6-9fba-312c535be5a8` (SUB-26-MO2YQLGECQ2J) | 250 BYN |
| 3   | Live-fail из PATCH-RB1.1 (profile `2a4b26b1…`)       | `6f9b0b83-aa67-416e-9461-72b84b68a3cb`                                                                                                                                                                                                                                          | `94a8dc74-888d-4352-b769-7a9c0e35a4ab` | `a27a8b74-89cf-44c6-b7df-9cf4aeb1384b` (SUB-LINK-MLP7MKV3)   | 250 BYN |


Все три — продукт Gorbova Club (`11c9f1b8…`), тариф `7c748940…` / `31f75673…`, `payment_flow=provider_managed_checkout`. Ни у одного `meta.rebill` не выставлен, что подтверждает приклейку.

## Жёсткие запреты в этом патче

Запрещено выполнять любые из нижеперечисленных действий:

- любой DML (INSERT/UPDATE/DELETE) в `orders_v2`, `payments_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `telegram_*`, `audit_logs`;
- вызов `grant-access-for-order`, `telegram-grant-access`, `subscription-actions`, `bepaid-*` против реальных данных;
- любые provider API (bePaid);
- любые изменения secrets / mode / cron;
- любые ручные правки `subscriptions_v2.meta`.

Patch — **read-only**: только SELECT-запросы + write одного proof-файла.

## Что dry-run должен зафиксировать по каждому из 3 кейсов

Для каждого кейса в proof-файле — отдельный блок со следующими полями (значения, не план получения):

1. **Identification**
  - `payment_id`, `provider_payment_id`, `amount`, `currency`, `status`, `created_at`;
  - `profile_id` + email/имя;
  - `product_id`, `tariff_id`, отображаемое product_name;
  - текущий `payments_v2.order_id` (= parent_order_id, который и есть аномалия);
  - parent `orders_v2` snapshot: `id`, `order_number`, `final_price`, `paid_amount`, `status`, `created_at`, `meta.payment_flow`, `meta.order_kind`, `meta.rebill`.
2. **Subscription chain**
  - `subscriptions_v2` строка(и), связанные с этим profile+product+tariff: `id`, `status`, `billing_type`, `provider_subscription_id`, `meta.model`, `meta.paid_billing_cycles`, `current_period_start/end`;
  - подтверждение, что parent — это первичная сделка той же `subscriptions_v2`;
  - `paid_billing_cycles` на момент платежа (должен быть ≥ 2 — иначе это не REBILL и кейс выпадает).
3. **Idempotency / уже-материализован?**
  - есть ли в `orders_v2` запись с `order_number ILIKE 'REBILL-%' AND meta->'rebill'->>'source_payment_id' = <payment_id>`;
  - есть ли любая запись `orders_v2` с `meta.rebill.provider_payment_id = <provider_payment_id>`;
  - результат: `already_materialized=true/false`. Если true — кейс выпадает из repair, отмечается как no-action.
4. **Access already extended legacy-путём?**
  - выборка `audit_logs` вокруг времени платежа (±10 мин) по action `grant-access-for-order.*`, `subscription.renew*`, `bepaid.webhook.*`, `entitlement.*` для данного `profile_id`/`subscription_id`;
  - `entitlements` строка для (profile, product): `expires_at`, `meta.last_extended_at`, `meta.source_order_id`;
  - `subscriptions_v2.current_period_end` до и после момента платежа (по логам);
  - вывод: `access_extended_legacy = true/false/unknown`.
5. **Planned REBILL-order (shape only, БЕЗ insert)**
  - planned `order_number` = `REBILL-<payment_id_first_12>`;
  - planned поля: `profile_id`, `product_id`, `tariff_id`, `base_price=amount`, `final_price=amount`, `paid_amount=amount`, `status='paid'`, `meta.payment_flow='provider_managed_checkout'`, `meta.rebill={ source_payment_id, provider_payment_id, parent_order_id, materialized_by:'patch_rb2', cycle_index }`;
  - planned `payments_v2.order_id` update: `<current parent>` → `<new REBILL order>`;
  - planned audit: `bepaid.rebill.materialized` + `patch_rb2.repair`.
6. **Decision**
  - `needs_rebill_insert: true/false`;
  - `needs_payment_rebind: true/false`;
  - `needs_grant_access_call: true/false` (true только если `access_extended_legacy=false`);
  - `financial_only_repair: true/false` (true если доступ уже корректно продлён, и нужна только финансовая перекладка денег в REBILL);
  - `rollback_plan`: точный набор обратных операций (UPDATE `payments_v2.order_id` обратно на parent, DELETE REBILL-order, при необходимости — `grant-access-for-order` rollback стандартным путём; без ручных правок entitlements).
7. **Expected rowcounts execute-фазы**
  - `orders_v2 INSERT`: 1
  - `payments_v2 UPDATE`: 1 (только колонка `order_id`)
  - `audit_logs INSERT`: 2 (`materialized` + `repair`)
  - `subscriptions_v2 UPDATE`: 0
  - `entitlements UPDATE/INSERT`: 0 (если `needs_grant_access_call=false`); иначе делегируется `grant-access-for-order` с idempotency
  - любые расхождения с этими цифрами в фактическом execute = немедленный rollback.
8. **Risk flags**
  - SBS mismatch (по аналогии с RB1 pre-check) — read-only сравнение `subscriptions_v2.provider_subscription_id` vs `provider_response.transaction.parent_uid`/sbs кейса;
  - duplicate `REBILL-` ордер с этим же `source_payment_id` (см. п.3);
  - parent_order в финальном статусе, конфликтующем с переразложением (refunded/cancelled);
  - `paid_billing_cycles < 2` (значит вообще не REBILL).

## Технические детали

- Используем только `supabase--read_query` для всех выборок.
- Один write-операция за весь патч: `.lovable/proofs/rebill_materialization_three_cases_dryrun_2026_05.md` (новый файл).
- Структура proof: вступление (контекст RB1.1 → RB2), затем 3 секции по одному кейсу в формате выше, затем сводная таблица решений и rollback-стратегия, затем явный блок «Что НЕ сделано» и «Что требует approve до execute».
- Если по Юлии фактический uid в БД не совпадёт с `113f7667…` (как уже видно из read-query), proof обязан явно зафиксировать факт расхождения, перечислить все candidate-платежи Юлии за апрель–май 2026 со статусом succeeded и предложить, какой именно кейс пойдёт в repair. Без approve — никакого execute по Юлии.

## DoD

- Proof-файл создан, содержит все 8 блоков по каждому из 3 кейсов.
- Для каждого кейса однозначно зафиксированы `already_materialized`, `access_extended_legacy`, `needs_grant_access_call`, `financial_only_repair`, `rollback_plan`, `expected rowcounts`.
- Кейс Юлии либо подтверждён конкретным `payment_id`, либо явно помечен как «требует уточнения до execute».
- В БД и провайдере 0 изменений; в `audit_logs` 0 новых записей; secrets/mode не трогались.
- Параллельный runtime-watch следующего live repeat payment по PATCH-RB1.1 продолжается отдельно — этот патч его не дублирует и не блокирует.

## Что НЕ входит в этот патч

- Сам execute RB2 (insert REBILL-orders, rebind payments, опциональный `grant-access-for-order`). Только после отдельного approve по результатам этого dry-run.
- Любая работа с подписками, доступом, Telegram, провайдером.
- Любые правки кода `bepaid-webhook` / `rebill_*`.
- Любой откат `BEPAID_REBILL_MATERIALIZATION` — остаётся `on`.