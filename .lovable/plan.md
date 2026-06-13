да, согласен, с учетом правок:

1. План правильный по направлению: текущий доступ Вероники не трогать, чинить нужно queue/materialization и parser `subv2:*`.

&nbsp;

2. Но data repair старых queue-строк не должен называться “materialized”, если соответствующий платеж уже давно был обработан вручную/другим путем.

Статус лучше:

- `materialized` — если есть точный `payments_v2` + order + profile + product match;

- либо `resolved_existing_payment` / meta.resolution='existing_payment_found', если status enum позволяет;

- если enum не позволяет — `materialized` допустим, но в meta обязательно указать:

  `resolution_reason='existing_payment_already_exists'`.

&nbsp;

3. Перед закрытием старых queue-строк обязательно проверить, что это не вызовет повторную обработку:

- не создаст новый order;

- не вызовет `grant-access-for-order`;

- не изменит `subscriptions_v2.access_end_at`;

- не изменит `entitlements.expires_at`.

&nbsp;

4. В `bepaid-fetch-transactions` parser добавить общий shared parser, если такой уже есть в `bepaid-webhook`.

Не плодить две разные реализации `subv2:*`.

Если уже есть helper — вынести/переиспользовать.

&nbsp;

5. В webhook fix обязательно закрывать queue row только после полной успешной цепочки:

- payment создан/найден;

- order найден/создан;

- если access writer вызывался — завершился без error/manual_review;

- audit записан.

Если writer вернул error — queue должна остаться error/pending, а не materialized.

&nbsp;

6. Для legacy `subv2:{sub_id}` без `order:{order_id}`:

- lookup через `subscriptions_v2.order_id` допустим только если order_id не null и order belongs to same user/product/tariff;

- если order_id null или неоднозначность — не матчить, отправлять в manual_review.

&nbsp;

7. Proof должен отдельно показать:

- старые orphan/canceled provider_subscriptions Вероники не трогались;

- текущий active `sbs_411...` остался active;

- следующий цикл должен пойти по новому tracking_id `subv2:0396...:order:7a7f...`.

&nbsp;

8. Добавить future-root guard:

если webhook видит tracking_id с `subv2:{missing_sub_id}`, но по provider_subscription есть current active subscription_v2_id, он не должен silently fail.

Он должен:

- записать audit `bepaid.webhook.tracking_subscription_missing`;

- попытаться fallback через provider_subscriptions.provider_subscription_id / user / active state;

- если fallback однозначный — materialize;

- если нет — queue manual_review.

Итоговая команда:

План принимаю с правками.

&nbsp;

Approve на PATCH-VERONIKA-MATUK-GORBOVA-CLUB-REPAIR.

&nbsp;

Scope:

1. Код:

- `bepaid-webhook/index.ts`;

- `bepaid-fetch-transactions/index.ts`;

- общий parser `subv2:{sub_id}:order:{order_id}` и legacy `subv2:{sub_id}`.

&nbsp;

2. Data repair:

- только `payment_reconcile_queue`;

- только строки Вероники;

- только если существует matching `payments_v2.provider_payment_id = queue.bepaid_uid`;

- только если order/product/profile = Gorbova Club + Вероника;

- не менять access/subscriptions/entitlements/orders/payments.

&nbsp;

3. Verify:

- текущая subscription `0396c3d9...` active до 2026-07-12;

- provider `sbs_411...` active;

- entitlement unchanged;

- старые queue строки закрыты как resolved/materialized with existing payment;

- новые successful provider-managed webhook больше не оставляет queue pending.

&nbsp;

Запрещено:

- ручное продление доступа;

- изменение subscriptions_v2;

- изменение entitlements;

- изменение orders_v2/payments_v2;

- удаление старых provider_subscriptions;

- bePaid API;

- Stripe.

&nbsp;

Proof:

`.lovable/proofs/veronika_matuk_gorbova_club_repair.md`

Коротко: чинить нужно **reconcile queue + parser**, а не доступ Вероники. Текущая подписка и доступ уже правильные.

&nbsp;

План:

## 1. Проблема

У Вероники Матук (`nika.1900735@mail.ru`, Telegram ID из скриншота `1337365629`) регулярно ломался сценарий Gorbova Club: автосписание/оплата либо не попадала корректно в журнал платежей, либо подписка/доступ не продлевались без ручного вмешательства.

## 2. Диагностика

Фактическое состояние по read-only SQL:

- Контакт найден один:
  - `profiles.id = 4e8834a5-0f6a-44d6-b05a-8d7ec3b4d6e9`
  - `user_id = 341e6f46-79dd-4920-b500-da78e3574aab`
  - email `nika.1900735@mail.ru`
- Продукт Gorbova Club:
  - `products_v2.id = 11c9f1b8-0355-4753-bd74-40b42aa53616`
- История Club BUSINESS:
  - 2026-02-11: оплата `PAY-26-MLP8XY2S`, 250 BYN.
  - 2026-03-12: rebill `REBILL-23a5fe7f-813`, 250 BYN.
  - 2026-04-11: rebill `REBILL-3ef6feed-a9e`, 250 BYN.
  - 2026-05-11: оплата `PAY-26-MP5R5Z6S`, 250 BYN.
  - 2026-06-12: новая subscription-link оплата `SUB-LINK-MQAM6G4O`, 250 BYN.
- Текущий доступ сейчас корректный:
  - `subscriptions_v2.id = 0396c3d9-a469-4124-b8c9-9b50228b66b6`
  - `status = active`
  - `auto_renew = true`
  - `billing_type = provider_managed`
  - `access_end_at = 2026-07-12 20:59:59+00`
  - `provider_subscriptions.provider_subscription_id = sbs_411b4b1b3a9c96a4`
  - `tracking_id = subv2:0396c3d9-a469-4124-b8c9-9b50228b66b6:order:7a7f4595-8b64-43fe-adaf-f543d423ebe4`
- Root cause старых ежемесячных сбоев:
  - В `payment_reconcile_queue` автосписания за март/апрель/май висели как `pending` с `last_error = Could not match to order`.
  - Их `tracking_id = subv2:b3fd405f-bd62-4e5a-b44f-ad1f0de71fc6`.
  - Такой `subscriptions_v2.id` сейчас не существует, поэтому webhook/backfill не мог однозначно связать provider payment с канонической подпиской/заказом.
  - Старые `provider_subscriptions` по Веронике содержат несколько orphan/canceled/expired provider-subscriptions без `subscription_v2_id`; это объясняет «каждый месяц что-то не так».
- Дополнительный текущий дефект:
  - Даже по новой корректной подписке июньский webhook создал `payments_v2` и продлил доступ, но строка `payment_reconcile_queue` по `provider_payment_id = 6a508de5-aa8d-4f6a-8fa1-712733dc147f` осталась `pending` с `Could not match to order`.
  - В коде `bepaid-webhook` provider-managed ветка пишет `payments_v2`, audit и доступ через `grant-access-for-order`, но не закрывает исходную строку `payment_reconcile_queue` как `materialized`.
- Подтверждение по коду:
  - `supabase/functions/bepaid-webhook/index.ts` уже умеет парсить `subv2:{subscription_v2_id}:order:{order_id}` и legacy `subv2:{subscription_v2_id}`.
  - `supabase/functions/bepaid-fetch-transactions/index.ts` использует более старый `parseTrackingId`, который понимает только `order_uuid` / `order_uuid_offer_uuid` и не понимает `subv2:*`; поэтому backfill/reconcile по provider-managed подпискам может продолжать складывать платежи в queue как unmatched.

## 3. Предлагаемое решение

Сделать минимальный repair-патч без изменения бизнес-архитектуры:

1. Исправить `bepaid-webhook` provider-managed ветку:
  - после успешной обработки subscription webhook и записи/обновления `payments_v2` закрывать соответствующую строку `payment_reconcile_queue` по `bepaid_uid = transactionUid`;
  - проставлять `status = materialized`, `processed_at`, `processed_order_id`, `matched_order_id`, `matched_profile_id`, `matched_product_id`, `matched_tariff_id`, `last_error = null`;
  - не менять `orders_v2`, `subscriptions_v2`, `entitlements` напрямую — доступ по-прежнему только через `grant-access-for-order`.
2. Исправить `bepaid-fetch-transactions` parser/recovery:
  - добавить поддержку `subv2:{subscription_v2_id}:order:{order_id}`;
  - добавить поддержку legacy `subv2:{subscription_v2_id}` с lookup в `subscriptions_v2.order_id`;
  - для provider-managed платежей не создавать параллельный доступ и не писать entitlement напрямую.
3. Выполнить точечный data repair только по уже доказанным строкам Вероники:
  - dry-run SELECT покажет строки `payment_reconcile_queue`, где есть соответствующий `payments_v2.provider_payment_id` и `orders_v2.product_id = Gorbova Club`;
  - только эти строки будут переведены из `pending` в `materialized` с привязкой к уже существующим платежам/заказам;
  - не продлевать доступ задним числом вручную, потому что текущий доступ уже корректен до 2026-07-12 и ручной доступ нарушит canonical write-path.
4. Зафиксировать proof-файл:
  - `.lovable/proofs/veronika_matuk_gorbova_club_repair.md`
  - с timeline, root cause, SQL before/after, rowcount, тестами, deploy version и STOP-guards.

## 4. Изменяемые компоненты

### Файлы

- `supabase/functions/bepaid-webhook/index.ts`
- `supabase/functions/bepaid-fetch-transactions/index.ts`
- существующие/новые Deno tests рядом с этими функциями, если в текущем наборе есть подходящий тестовый harness
- `.lovable/proofs/veronika_matuk_gorbova_club_repair.md`

### Таблицы данных

Только точечное обновление существующих строк:

- `payment_reconcile_queue`

Только read-only verification:

- `profiles`
- `orders_v2`
- `payments_v2`
- `subscriptions_v2`
- `provider_subscriptions`
- `entitlements`
- `access_grant_ledger`
- `audit_logs`

### Edge functions

- `bepaid-webhook` — код + controlled deploy после тестов.
- `bepaid-fetch-transactions` — код + deploy только если реально изменён.

## 5. Что не будет изменено

- Не трогать `stripe-webhook`.
- Не трогать Stripe-логику.
- Не менять `grant-access-for-order`.
- Не создавать новые таблицы/RPC/enum/status-machine.
- Не менять `orders_v2`, `subscriptions_v2`, `entitlements` вручную без отдельного proof, потому что текущий доступ уже активен.
- Не удалять старые provider-subscriptions; максимум read-only классификация как historical orphan/canceled/expired.
- Не использовать product code/slug в новой логике; только UUID и отображаемое имя.

## 6. Dry-run

Перед любым UPDATE выполнить:

1. SELECT по Веронике:
  - все Club orders/payments/subscriptions/provider_subscriptions;
  - текущий entitlement;
  - queue-строки с `pending`/`error` и `bepaid_uid`.
2. SELECT candidate rows для repair:
  - `payment_reconcile_queue.status in ('pending','error')`;
  - есть `payments_v2.provider = 'bepaid'` и `payments_v2.provider_payment_id = payment_reconcile_queue.bepaid_uid`;
  - платеж связан с `orders_v2.product_id = 11c9f1b8-0355-4753-bd74-40b42aa53616`;
  - профиль/пользователь соответствует Веронике.
3. Expected rowcount: небольшой точечный набор по Веронике; если rowcount больше ожидаемого или выходит за профиль Вероники — STOP.

## 7. Execute

После одобрения:

1. Внести кодовые правки в `bepaid-webhook` и `bepaid-fetch-transactions`.
2. Добавить/обновить тесты на:
  - `subv2:{sub_id}:order:{order_id}`;
  - legacy `subv2:{sub_id}`;
  - materialization queue row после successful provider-managed subscription webhook;
  - запрет прямых access writes в webhook.
3. Запустить релевантные Deno tests для изменённых функций.
4. Выполнить controlled deploy только изменённых bePaid functions.
5. Выполнить точечный data repair через safe UPDATE с WHERE по dry-run candidate IDs.
6. Повторить SQL after:
  - текущая подписка active;
  - entitlement unchanged/active until 2026-07-12;
  - queue rows materialized;
  - 0 прямых изменений access вне canonical path;
  - webhook versions только для разрешённых функций.

## 8. STOP-guards

Остановиться без UPDATE/deploy, если:

- dry-run находит больше строк, чем точечный набор Вероники;
- candidate row не имеет соответствующего `payments_v2.provider_payment_id`;
- payment/order не относится к `Gorbova Club` UUID;
- найдено расхождение `user_id/profile_id` не в пользу Вероники;
- текущая active subscription исчезла или стала не `provider_managed`;
- тесты `bepaid-webhook` или `bepaid-fetch-transactions` падают;
- требуется изменение `grant-access-for-order` или manual entitlement extension — это отдельный PATCH.

## 9. DoD

Задача считается выполненной, если:

- причина задокументирована: старые provider-managed webhooks приходили с orphan `subv2:b3fd...`, который не существовал в `subscriptions_v2`, поэтому queue/reconcile не мог матчить платежи;
- новая активная подписка Вероники подтверждена и остаётся активной до 2026-07-12;
- `bepaid-webhook` больше не оставляет successful provider-managed webhook в `payment_reconcile_queue.pending` после успешной materialization;
- `bepaid-fetch-transactions` понимает `subv2:*` tracking IDs;
- точечные старые queue-строки Вероники закрыты как `materialized` только при наличии уже существующего `payments_v2`;
- нет ручных изменений `orders_v2/subscriptions_v2/entitlements` вне канонического writer-path;
- тесты PASS;
- proof-файл создан с SQL before/after и rowcount.

## 10. Риски и зависимости

- `bepaid-webhook` — production public webhook; deploy только controlled, без затрагивания Stripe.
- Исторические orphan provider-subscriptions нельзя безопасно «склеивать» задним числом без отдельного repair-патча, если не доказан единственный SOT; в этом патче они остаются историческим объяснением.
- Если bePaid на следующем цикле пришлёт новый формат payload без `transaction.uid`, понадобится отдельный webhook replay/debug patch.

## 11. Требуется дополнительная информация

Дополнительная информация от пользователя не требуется. Для выполнения нужен переход из plan mode в build mode/approval плана.