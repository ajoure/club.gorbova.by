да, согласен, с учетом правок:

1. **План оформлен правильно**
  - Scope read-only соблюден.
  - Никаких repair/retry/revoke/grant сейчас не делать.
  - Постоянные view/RPC/table не создавать.
2. **Добавить в начало proof явный executive summary**  
В `.lovable/proofs/recurring_diagnosis_2026_05.md` первым блоком:
  - есть ли подтвержденный инцидент;
  - сколько пользователей затронуто;
  - какие домены затронуты: `subscriptions_v2`, `entitlements`, `telegram_access`;
  - главный предполагаемый root cause;
  - что точно не менялось.
3. **Не использовать bePaid** `active_to` **как единственный SOT**  
В отчете явно разделить:
  - `provider_active_to` / bePaid date;
  - `expected_min_end` по внутренней логике платформы;
  - `local_subscription_access_end_at`;
  - `entitlement_expires_at`;
  - `telegram_access_active_until`.
  Вывод делать не «bePaid прав», а «расхождение между provider и локальными источниками».
4. **Для recurring и installment разделить классификацию**  
Даже если выборка сейчас `is_recurring=true`, в отчете явно отметить:
  - recurring payment;
  - installment/рассрочка;
  - обычная разовая оплата.
  Если installment попали в выборку — вынести отдельным bucket и не смешивать с recurring.
5. **Добавить проверку staff-исключений**  
В report и proposed repair обязательно исключить / пометить staff-аккаунты:
  - Анна Бруйло;
  - Никита Рохмистров;
  - Катерина Горбова;
  - Ирина Гаринова.
  Их доступы не трогать даже в будущем repair.
6. **Audit actor proof**  
Для событий, которые будут признаны значимыми (`overshoot`, `skip_already_fulfilled`, `telegram.access_expired`, revoke), показать:
  - `actor_type`;
  - `actor_user_id`;
  - `actor_label`;
  - `target_user_id`.
  Это нужно, чтобы понять, кто/что инициировал revoke или skip.
7. **Timeline делать не только по** `order_id`  
Некоторые события могут быть связаны не через `order_id`, а через:
  - `payment_id`;
  - `provider_payment_id`;
  - `subscription_id`;
  - `target_user_id`;
  - `telegram_user_id`;
  - `club_id`.
  Для проблемных строк собрать timeline по всем доступным ключам, иначе можно пропустить причину.
8. **Telegram risk bucket разделить**  
В `valid_sub_but_tg_bad` отдельно классифицировать:
  - `no_telegram_access_row`;
  - `active_until_expired`;
  - `state_chat_revoked`;
  - `state_channel_revoked`;
  - `not_in_chat`;
  - `not_in_channel`;
  - `invite_pending`.
  Не смешивать отсутствие строки и реальный revoke.
9. **Добавить bucket “access source mismatch”**  
Отдельно показать случаи:
  - subscription валидна, entitlement истёк;
  - entitlement валиден, subscription истекла;
  - telegram_access валиден, entitlement истёк;
  - telegram_access revoked, entitlement валиден.
  Это важно, потому что source of truth доступа — `entitlements`, а Telegram не является source of truth.
10. **Proposed repair plan пока только в виде вариантов**  
В proof не писать финальное «надо сделать так». Писать:

- Вариант A: repair по internal expected_min_end.
- Вариант B: repair по provider_active_to.
- Вариант C: repair только Telegram после восстановления subscription/entitlement.

Финальный repair выбрать только после review отчета.

11. **Добавить строгий вывод по безопасности**  
В конце отчета:

- какие операции безопасны для следующего controlled repair;
- какие операции запрещены до фикса webhook/idempotency;
- какие пользователи требуют ручной проверки.

Можно выполнять read-only диагностику.

&nbsp;

План: диагностический mini-sprint по recurring-платежам, продлению подписок и Telegram-доступам (read-only)

## 1. Проблема

Пользователи сообщают: bePaid списывает деньги по автосписанию, но доступ не продлевается, а к концу дня отзывается. Случай не единичный.

Цель этого спринта — read-only диагностика без правок доступов: понять масштаб, классифицировать причины, подготовить отдельный repair-план.

Никаких UPDATE / grant / revoke / delete / manual repair в этом спринте.

## 2. Что уже подтверждено диагностикой

- За 7 дней: 55 успешных recurring bePaid-платежей.
- Из них:
  - `sub_not_extended_to_expected`: 10
  - `entitlement_not_extended_to_expected`: 12
  - `no_entitlement_by_product`: 2
  - `subscription_v2.status=expired` после успешного списания: подтверждено на 6+ примерах (Королёва, Монич, Шидловская, Жарко, Чистякова, Криштопик и др.).
- В audit за 3 дня:
  - `bepaid.webhook.link_order_processed`: 21
  - `bepaid.webhook.link_order_dates_updated`: 19
  - `grant-access-for-order.skip_already_fulfilled`: 23
  - `bepaid.webhook.access_end_at_skipped_overshoot`: 6 (overshoot 59–117 дней при tolerance 45)
- Подозрительная связка:
  - subscription имеет stale `access_end_at` (например 2026-02-12) после прошлых backfill;
  - bePaid возвращает `active_to` = 2026-06-03 (нормальное окно от paid_at);
  - overshoot-guard в `bepaid-webhook` считает разницу > tolerance и отказывается перезаписывать `access_end_at`;
  - в результате `subscriptions_v2.access_end_at` остается старый, `entitlements.expires_at` старый, `telegram_access.active_until` тоже не продлевается;
  - cron `telegram-check-expired` отзывает Telegram-доступ.

Эти данные уже собраны read-only и используются дальше как baseline.

## 3. Scope (что делаем сейчас, read-only)

### 3.1. Reconciliation report за 7 дней

Собрать в proof-файле `.lovable/proofs/recurring_diagnosis_2026_05.md` отчёт по всем `payments_v2` где:

- `provider = 'bepaid'`
- `status = 'succeeded'`
- `is_recurring = true`
- `paid_at >= now() - interval '7 days'`

Поля строки отчета:

- `payment_id`, `provider_payment_id`, `paid_at`, `amount`
- `order_id`, `order_number`
- `user_id`, `email`, `full_name`
- `product_id`, `product_name`
- `tariff_id`, `tariff_name`, `access_days`
- `expected_min_end` = endOfDay(`Europe/Minsk`, `paid_at + access_days`)
- `subscription_id`, `subscription_status`, `subscription.access_end_at`, `subscription.next_charge_at`, `subscription.billing_type`, `subscription.auto_renew`
- `entitlement_id`, `entitlement.expires_at`, `entitlement.status`
- `telegram_access.id`, `telegram_access.active_until`, `state_chat`, `state_channel`
- последний relevant `audit_logs` action для этого order/sub
- флаги:
  - `no_order`
  - `no_subscription_same_pair`
  - `sub_end_before_payment`
  - `sub_not_extended_to_expected`
  - `no_entitlement_by_product`
  - `entitlement_not_extended_to_expected`
  - `no_telegram_access_row`
  - `telegram_access_expired_now`
  - `telegram_access_revoked_state`
  - `valid_sub_but_tg_bad`
  - `webhook_overshoot_skipped`
  - `grant_skipped_already_fulfilled`

Это read-only выборка. Никаких permanent SQL view не создаём.

### 3.2. Агрегаты

В тот же proof добавить агрегаты за 7 дней:

- `total_successful_recurring`
- `no_order`
- `no_subscription_same_pair`
- `sub_end_before_payment`
- `sub_not_extended_to_expected`
- `no_entitlement_by_product`
- `entitlement_not_extended_to_expected`
- `no_telegram_access_row`
- `telegram_access_expired_now`
- `telegram_access_revoked_state`
- `valid_sub_but_tg_bad`
- `webhook_overshoot_skipped_count`
- `grant_access_skip_already_fulfilled_count`
- `webhook_link_order_processed_count`
- `webhook_link_order_dates_updated_count`

И отдельно — список проблемных строк, `LIMIT 50`, отсортированный по `paid_at DESC`, с явной причиной для каждой.

### 3.3. Overshoot guard report

По `audit_logs.action = 'bepaid.webhook.access_end_at_skipped_overshoot'` за 7 дней:

- `created_at`
- `order_id`, `subscription_id`
- `expected_end`, `bepaid_active_to`
- `overshoot_days`, `tolerance_days`
- `target_user_id`, `email`, `full_name`
- факт: что произошло после этого audit'а с `subscriptions_v2.access_end_at` и `entitlements.expires_at` (изменилось / не изменилось).

Цель: подтвердить или опровергнуть гипотезу, что overshoot guard блокирует нормальное продление при stale локальной дате.

### 3.4. Webhook retry / idempotency report

Для каждого проблемного `order_id` собрать timeline audit-событий:

- `bepaid.webhook.link_order_processed`
- `bepaid.webhook.link_order_dates_updated`
- `bepaid.webhook.link_order_fallback_access_days`
- `bepaid.webhook.access_end_at_skipped_overshoot`
- `bepaid.webhook.grant_access_failed`
- `grant-access-for-order.skip_already_fulfilled`
- `grant-access-for-order.skip_extend_tariff_mismatch`
- любые `failed`, `not_found`, `ambiguous`, `unresolved`
- повторные `webhook_events` по одному `transaction_uid` / `provider_payment_id`
- наличие `payments_v2.provider_payment_id` уникального ключа, который блокирует повторную обработку

Этот раздел — read-only. Никакие retry / replay не запускаем.

### 3.5. Telegram revoke risk report

Отдельный список пользователей, у которых одновременно:

- активная `subscriptions_v2` (`status IN ('active','trial','past_due')` и `access_end_at > now()`)
и/или активный `entitlement` (`status='active'` и `expires_at > now()`),
- но `telegram_access` либо отсутствует, либо `active_until < now()`, либо `state_chat='revoked'`, либо `state_channel='revoked'`.

Поля:

- `user_id`, `email`, `full_name`
- `product_id`, `product_name`
- `club_id` (через `access_rules` `grant_target_type='club'`)
- `subscription_id`, `subscription.access_end_at`
- `entitlement_id`, `entitlement.expires_at`
- `telegram_access.id`, `active_until`, `state_chat`, `state_channel`, `last_sync_at`
- последнее `audit_logs.action LIKE 'telegram.access_expired%'` или `telegram.revoke%` для этого user/club
- последнее `subscriptions-reconcile`/`telegram-check-expired` событие, инициировавшее revoke (если есть в audit/ledger)

Никаких grant/revoke сейчас не выполняем.

### 3.6. Monitoring proposal (только описание, без execute)

В отдельной секции proof'а описать предлагаемые алерты:

- successful recurring payment без extension `subscriptions_v2.access_end_at` за +30 минут после `paid_at`;
- entitlement не продлён до `expected_min_end` за +30 минут после `paid_at`;
- валидная subscription/entitlement, но `telegram_access` revoked/expired в окне 24 часа;
- сработал overshoot-guard;
- сработал `grant-access skip_already_fulfilled`, но при этом `subscriptions_v2.access_end_at < expected_min_end`.

Реализацию мониторинга НЕ внедряем в этом спринте.

## 4. Изменяемые компоненты

В этом спринте:

- создаётся ТОЛЬКО proof-файл `.lovable/proofs/recurring_diagnosis_2026_05.md`.

Read-only источники:

- `payments_v2`
- `orders_v2`
- `subscriptions_v2`
- `entitlements`
- `telegram_access`
- `access_rules`
- `audit_logs`
- `webhook_events`
- `provider_webhook_orphans`
- `payment_reconcile_queue`
- `profiles`
- `products_v2`, `tariffs`

## 5. Что не будет изменено

- Не трогаем `subscriptions_v2`, `entitlements`, `telegram_access`, `payments_v2`, `orders_v2`.
- Не запускаем retry / replay webhook'ов.
- Не вызываем `grant-access-for-order`, `telegram-grant-access`, `telegram-revoke-access`.
- Не правим код edge-функций `bepaid-webhook`, `grant-access-for-order`, `telegram-check-expired`.
- Не создаём новые таблицы / views / RPC / cron / triggers.
- Не делаем DELETE.
- Не показываем raw данные карт/PII в отчёте сверх того, что уже есть в audit_logs.

## 6. Dry-run

Все запросы из 3.1–3.5 — это и есть dry-run. Перед публикацией отчёта показать:

- размер выборки за 7 дней;
- сколько строк в каждом флаге;
- 5 примеров до сохранения proof-файла, чтобы убедиться, что классификация корректна.

## 7. Execute

«Execute» в этом спринте означает только:

- написать SQL-запросы и выполнить их через `supabase--read_query`;
- собрать результаты в proof-файл;
- агрегировать и классифицировать.

Никаких write-операций в БД и edge-функциях.

## 8. STOP-guards

Остановиться и не двигаться к repair-патчу, если:

- найден хотя бы один пользователь с валидной подпиской/entitlement, но revoked Telegram → не запускать `telegram-revoke-access`/`telegram-check-expired` коррекции до отдельного repair-плана;
- найден idempotency bug в webhook → не запускать массовый retry/replay;
- найден overshoot bug → сначала отдельный proof, потом patch логики `bepaid-webhook`, потом controlled retry, и только тогда repair данных;
- любая выборка превышает 500 строк — переходить на агрегаты и samples, не вываливать всё в proof целиком;
- встречаются заказы без `user_id`/`product_id`/`tariff_id` — фиксируем как отдельный bucket, не трогаем.

## 9. DoD

Спринт считается выполненным, если в `.lovable/proofs/recurring_diagnosis_2026_05.md` есть:

1. Агрегаты за 7 дней по всем флагам из 3.2.
2. Список проблемных строк (LIMIT 50) с явной причиной по каждой.
3. Полный список overshoot-skip кейсов (3.3) с фактическим состоянием подписки/entitlement после события.
4. Audit-timeline для каждого проблемного `order_id` (3.4).
5. Отдельный Telegram revoke risk список (3.5).
6. Классификация по причинам:
  - A. всё корректно;
  - B. subscription не создана / не найдена;
  - C. subscription есть, но не продлена;
  - D. entitlement отсутствует / истёк;
  - E. Telegram access плохой при валидном доступе;
  - F. webhook overshoot guard заблокировал ожидаемое обновление;
  - G. idempotency / skip сработал неверно (skip_already_fulfilled при stale access_end_at).
7. Отдельный список строк, которые требуют repair, без выполнения repair'а.
8. Раздел «Proposed repair plan» — только текстом, на отдельный approve:
  - patch `bepaid-webhook` (overshoot guard не должен блокировать stale local end);
  - controlled repair `subscriptions_v2.access_end_at`, `entitlements.expires_at`, `telegram_access.active_until` с GREATEST и UUID-matching;
  - правила для recurring vs installment;
  - явное исключение staff-аккаунтов.
9. Раздел «Proposed monitoring» (3.6) — только описание, без внедрения.

## 10. Риски и зависимости

- Read-only диагностика безопасна. Главный риск — пропустить какой-то канал revoke (cron `subscriptions-reconcile`, `bepaid-subscription-audit-cron`, ручные действия). Поэтому в 3.5 явно ищем последнее audit-событие revoke и его источник.
- Возможен скрытый дефект: overshoot guard сравнивает с локальной `access_end_at`, которая ранее была приведена backfill'ом к стабильному значению и теперь воспринимается как «expected». Это нужно подтвердить отдельным разделом 3.3, прежде чем менять код.
- Нельзя одновременно фиксить код и данные — сначала диагностический отчёт, потом отдельный patch для логики webhook, потом отдельный repair для данных.

## 11. Требуется дополнительная информация

Для repair-плана (следующий спринт, не сейчас) понадобится подтверждение:

- какое окно мы готовы откатывать назад (7 / 14 / 30 дней);
- считаем ли финальной truth bePaid `active_to` или собственный SOT (`grant-access-for-order` calendar-month) при их расхождении;
- допускаем ли авто-репeйр Telegram-доступов без подтверждения админом, или только в режиме «список + ручной grant».

Эти вопросы поднимем после публикации отчёта, не сейчас.