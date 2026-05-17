да, согласен, с учетом правок:

1. `profile_id` **не должен быть hard STOP.**  
У тебя уже есть 2 кейса `no profile`. Если `user_id` существует и подписка валидна, отсутствие `profile_id` не должно автоматически блокировать восстановление доступа.

Заменить STOP:

```text
нет user_id / profile_id
```

на:

```text
нет user_id или user_id не существует в auth/profiles-связке → STOP
profile_id отсутствует → warning no_profile, но не blocker, если canonical writer принимает user_id/orderId
```

2. **Source order не обязательно** `sub_order_id`**.**  
Если `subscriptions_v2.sub_order_id` нет или поле называется иначе, искать order через:

```text
initial_order_id
checkout_order_id
origin_order_id
meta.initial_order_id
meta.checkout_order_id
meta.extended_by_orders
order_id
```

Иначе часть строк уйдёт в manual_review ошибочно.

3. **Refund guard проверять по конкретному source_order/payment, не по клиенту вообще.**  
Refund по другому заказу не должен блокировать восстановление доступа.
4. **Для** `grant_access_for_order_needed` **добавить проверку** `do_not_grant_access`**.**  
Если source_order имеет:

```text
meta.do_not_grant_access=true
```

то не вызывать writer, строка → `manual_review_do_not_grant_access`.

5. **Если source_order — H5 REBILL-order, не использовать его для выдачи доступа.**  
H5 REBILL-orders специально имеют `do_not_grant_access=true`. Для доступа искать original/source paid order.
6. `entitlement_restore_needed` **лучше не делать через ручную реактивацию.**  
В dry-run можно пометить, но execute должен быть только:

```text
сначала grant-access-for-order
если writer не применим — manual_review
```

Никаких прямых восстановлений entitlements в ACCESS-FIX-1.

7. **Добавить проверку access_rules.**  
Для каждой строки указать:

```text
primary entitlement expected by access_rules / product entitlement_mode / tariff_offer
```

Чтобы не создавать доступ там, где продукт не должен выдавать platform access.

8. **Команда на запуск:**

```text
План ACCESS-FIX-1 dry-run подтверждаю с правками.

Выполни строго read-only:
- прочитать 6 critical missing_primary_entitlement;
- собрать row-карту;
- найти корректный source_order через все возможные поля subscription/meta;
- проверить do_not_grant_access;
- проверить refund только по конкретному source_order/payment;
- проверить access_rules / entitlement_mode;
- классифицировать planned_action;
- создать proof + CSV.

Запрещено:
- DML;
- grant-access-for-order;
- Telegram;
- provider API;
- любые изменения subscriptions_v2 / entitlements / orders_v2 / payments_v2 / secrets.

Proof:
.lovable/proofs/access_fix_1_missing_primary_entitlement_dryrun_2026_05.md
CSV:
.lovable/proofs/access_fix_1_missing_primary_entitlement_dryrun_2026_05.csv

После dry-run остановиться и ждать approve execute.

План: ACCESS-FIX-1 — critical missing primary entitlement repair (dry-run)
```

## Цель

Подготовить read-only dry-run отчёт по 6 critical-кейсам `gap_class=missing_primary_entitlement` из аудита `.lovable/proofs/h5_access_consistency_audit_after_2026_05_17.csv`. Никаких DML, никаких вызовов `grant-access-for-order`, никаких Telegram/provider действий. Execute — отдельным approve следующим патчем.

## Scope (точный)

Source: `.lovable/proofs/h5_access_consistency_audit_after_2026_05_17.csv`
Filter: `severity=critical AND gap_class=missing_primary_entitlement`
Ожидание: 6 строк.

Контрольный список (из status board / audit md):

1. ЗАКРОЙ ГОД — `alexasermyazhko@gmail.com`, sub `405faf46…`, access_end_at 2026-05-31
2. Gorbova Club — `elena.platonova-fedyakova@yandex.ru`, sub `f2901cfc…`, 2026-05-21
3. Gorbova Club — `natapono2018@mail.ru`, sub `08363441…`, 2026-05-30
4. Gorbova Club — `trofimova.ulia@tut.by`, sub `de75db3a…`, 2026-05-19
5. ЗАКРОЙ ГОД — user `17b35d62…` (no profile), sub `0c999415…`, 2026-05-31
6. Ценный бухгалтер 2 ступень / 3 поток — user `539ea1b3…` (no profile), sub `be19fa2e…`, 2026-08-30

Если CSV даст не ровно 6 строк или иной состав — STOP, отчёт о расхождении, дальше не идти.

## Stage 1 — read-only dry-run

Для каждой из 6 строк собрать row-карту (read-only SQL по subscriptions_v2, orders_v2, payments_v2, profiles, tariff_offers, entitlements, access_rules, product_fulfillment):

- customer (имя), email
- `user_id`, `profile_id` (если есть)
- `product_id`, product_name
- `tariff_id`, tariff name
- `subscription_id`, sub status, `access_start_at`, `access_end_at`, `auto_renew`, `sub_order_id`
- `source_order` = `subscriptions_v2.sub_order_id`: id, public_id, status, paid_amount, final_price, refunded?
- `latest_payment`: id, status, amount, captured_at, refund flag
- текущий entitlement по `(user_id, product_id)` — есть/нет/superseded/expired
- ожидаемое окно primary entitlement (на основе sub.access_start_at/access_end_at и tariff access_days)
- `planned_action` (см. ниже)
- `stop_guard` (см. ниже) — null если можно чинить canonical writer'ом

### Классификация `planned_action`

- `grant_access_for_order_needed` — есть `sub_order_id` с `status='paid'`, без refund, продукт/тариф консистентны, entitlement по (user_id, product_id) реально отсутствует → execute-стадия позже вызовет `grant-access-for-order({orderId: sub_order_id, source: 'access_fix_1_missing_primary_entitlement_2026_05'})`.
- `entitlement_restore_needed` — есть прошлый entitlement в `superseded/expired/canceled` строго того же `(user_id, product_id, tariff_id)`, который перекрывает ожидаемое окно, и canonical writer не сможет его реактивировать (например, нет «свежего» paid-заказа). Помечается, но в execute-стадии всё равно сначала пробуется canonical writer.
- `manual_review_no_order` — `sub.sub_order_id IS NULL` или соответствующий `orders_v2` не найден / не `paid`.
- `manual_review_no_user` — `subscriptions_v2.user_id IS NULL` или user не существует в profiles.
- `manual_review_tariff_mismatch` — `sub.product_id ≠ order.product_id` или `sub.tariff_id ≠ order.tariff_id`, либо ни один tariff_offer не подтверждает продуктовую связь.
- `skip_already_fixed` — entitlement на `(user_id, product_id)` уже active с `expires_at > now()` (если успели починить между snapshot'ом и dry-run'ом).

### STOP-guards (per-row)

Любой триггерит `manual_review_*` и блокирует canonical writer:

- нет `user_id` / `profile_id`;
- нет `product_id` / `tariff_id` на subscription;
- `source_order.status ≠ 'paid'`;
- есть refund по source_order или его последнему payment;
- product_id / tariff_id у subscription не совпадает с order;
- `sub.access_end_at <= now()`;
- найден active entitlement того же `product_id` у другого `user_id`, перекрывающий ожидаемое окно (потенциальная коллизия).

### Глобальные STOP-guards (отчёт целиком)

- CSV не существует / parse error → STOP;
- строк severity=critical/missing_primary_entitlement ≠ 6 → STOP с diff;
- любой из контрольных sub_id отсутствует в БД → STOP.

## Stage 2 — proposal (только текст, без execute)

В конце dry-run отчёта:

- таблица `planned_action × count`;
- список строк, которые в execute-фазе пойдут через `grant-access-for-order` (с конкретными `orderId`);
- список строк, которые уйдут в `manual_review_*` с причиной;
- предложение execute-патча: одна цепочка вызовов `grant-access-for-order`, последовательно, с capture результата (`entitlement.action`, `accessEndAt`, `primary_entitlement_verified`).

Никакой DML, никакого invoke в этом патче.

## Запреты (жёсткие)

- Никаких INSERT/UPDATE/DELETE по `entitlements`, `subscriptions_v2`, `orders_v2`, `payments_v2`, `access_rules`, `telegram_*`, `provider_subscriptions`.
- Никаких вызовов `grant-access-for-order`, `telegram-grant-access`, `telegram-process-access-queue`, `bepaid-*`.
- Никаких H5 REBILL-операций.
- Никаких изменений secrets / mode / cron.
- Никаких массовых ручных правок entitlements — только canonical writer на execute-стадии.
- Telegram-кейсы (9 шт.) НЕ трогать в этом патче — это ACCESS-FIX-2.
- 40 sub_without_ent по «Учет у ИП» НЕ трогать.

## Артефакты

- `.lovable/proofs/access_fix_1_missing_primary_entitlement_dryrun_2026_05.md` — методология, 6 row-карт, planned_action, stop_guards, proposal execute.
- `.lovable/proofs/access_fix_1_missing_primary_entitlement_dryrun_2026_05.csv` — per-row машинно-читаемый дамп (user_id, product_id, tariff_id, sub_id, sub_order_id, planned_action, stop_guard, sub_access_end_at, ожидаемый expires_at).

## DoD

- CSV прочитан, ровно 6 строк severity=critical/missing_primary_entitlement.
- По каждой строке заполнена row-карта со всеми полями выше.
- `planned_action` проставлен из фиксированного словаря.
- Все STOP-guards проверены, расхождения зафиксированы.
- Proof md + CSV созданы.
- БД не менялась (0 DML, 0 invoke writer-функций).
- Явно перечислено, какие строки в execute-фазе пойдут через canonical writer и какие — в manual_review.
- Остановка после dry-run; ждать approve на execute.

## Дальше (вне этого патча)

- ACCESS-FIX-1 execute — после approve, отдельным сообщением.
- ACCESS-FIX-2 — Telegram (9 шт.), только после закрытия ACCESS-FIX-1.
- «Учет у ИП» grace cohort — отдельный dry-run с product owner'ом.