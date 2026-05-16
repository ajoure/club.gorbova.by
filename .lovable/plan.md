да, согласен, с учетом правок:

1. **Сейчас разрешать только Этап 1 — dry-run read-only.**  
Execute из Этапа 2 не запускать до отдельного approve по dry-run таблице.
2. **В Этапе 5.3 убрать отдельную ручную запись** `inv_group_a_canonical_regrant.execute` **из обязательного execute.**  
Если задача принципиально “только через canonical writer”, то достаточно audit самого `grant-access-for-order` + proof-файл.  
Отдельный batch audit можно делать только если это уже предусмотрено безопасным system-audit механизмом и не является ручным DML.
3. **Whitelist для Telegram source не фиксировать заранее.**  
Сначала в dry-run/proof показать реальные canonical `source` значения Telegram path. Формулировку заменить на:  
`подтвердить, что Telegram был создан через grant-access-for-order canonical path, а не прямым UI-вызовом`.
4. **Добавить в dry-run проверку refund/cancel факта по payments.**  
Для каждого order:
  - `status='paid'`;
  - сумма платежей > сумма возвратов;
  - нет полного возврата;
  - если full refund/cancel найден — `stop_status_changed` или `manual_review`.
5. **Добавить проверку already active access по тому же order_id.**  
Если уже есть entitlement/subscription, связанная именно с этим order_id — `skip_already_fulfilled`, не extend.
6. **Добавить проверку active access по тому же product/tariff от другого order.**  
В dry-run явно показать:
  - это дубль;
  - это легитимное продление;
  - или нужен `manual_review`.
7. **Для GIFT-orders добавить отдельный флаг.**  
В dry-run показать:
  - получатель подарка;
  - кто выдал;
  - не был ли подарок уже реализован;
  - не создаст ли re-grant второй доступ.
8. **DoD разделить на два блока.**

```text
DoD Dry-run:
- proof-файл создан;
- все 9 order проверены;
- planned_action/stop_reason заполнены;
- DML=0;
- execute не запускался.

DoD Execute:
- только после отдельного approve;
- grant-access-for-order вызван сериально;
- before/after по каждому order;
- manual_review отдельно;
- прямых DML нет.
```

9. **Команда на текущий шаг:**

```text
Выполни только Этап 1 — dry-run read-only по 9 кандидатам Group A.

Запрещено:
- вызывать grant-access-for-order;
- писать audit;
- делать DML;
- менять entitlements/subscriptions_v2/telegram;
- выполнять execute.

После dry-run дай таблицу по 9 order_id:
order_id, user_id, product_id, tariff_id, current entitlement/subscription, refund/cancel status, planned_action, stop_reason, expected access window, Telegram action.

Execute не запускать без отдельного approve.

План: PATCH E — canonical re-grant Group A (9 кандидатов)
```

## 1. Цель

Восстановить платформенный доступ по 9 paid-сделкам из Group A (proof `.lovable/proofs/payment_to_access_chain_revision_2026_05.md`), которые были созданы UI-flows до PATCH A и остались без активного entitlement/subscription. Repair выполняется **только** через canonical writer `grant-access-for-order(orderId)`. Никаких прямых DML в `entitlements`, `subscriptions_v2`, `telegram_*`.

## 2. Scope (фиксированный)

Ровно 9 order_id из Group A:

```text
2da906f1-7957-4461-a7a1-8b977f30bf09  GIFT-26-MOCVYPNO  admin_grant         2026-04-24
d0a995aa-887f-469b-8329-804fa9f40072  PAY-26-MNRI13HN   admin_from_payment  2026-04-09
6914c44e-f174-4da4-a831-c47da13ab36e  GIFT-26-MNM0A0PG  admin_grant         2026-04-05
df4f2c36-2184-48ae-bd40-cfb35b73c2e2  GIFT-26-MNM09LJN  admin_grant         2026-04-05
3a748fd9-e8dc-407a-9b67-866664cfa105  GIFT-26-MNM099PF  admin_grant         2026-04-05
d3c5070c-c182-44b4-aac0-21634595f233  GIFT-26-MNM08XKV  admin_grant         2026-04-05
b170b768-aaeb-4749-8071-20258b908dd8  PAY-26-MN1G0JZJ   admin_from_payment  2026-03-21
85a99b74-c545-4600-b7c8-382a37e9f118  PAY-26-MM4P1ZYR   admin_from_payment  2026-02-27
bddd5a41-8338-4bbe-86a7-9a1db69ba5cd  PAY-26-MN1G057Z   admin_from_payment  2026-02-19
```

Скоуп жёстко зафиксирован: новые order_id не добавляются без отдельного approve. Если в pre-flight выяснится, что чей-то статус уже стал `cancelled/refunded` — кандидат исключается с пометкой `precheck_status_changed`.

## 3. Этап 1 — Dry-run (read-only)

### 3.1 Pre-flight SELECT

Для каждого order_id собрать:

- `orders_v2.{id, order_number, status, user_id, product_id, tariff_id, final_price, created_at, meta.source}`;
- `entitlements` по `(user_id, product_id)`: id, expires_at, order_id, meta.tariff_id;
- `subscriptions_v2` по `(user_id, product_id)`: id, tariff_id, status, access_start_at, access_end_at, auto_renew;
- `products_v2.{name, telegram_club_id, requires_telegram}` и `access_rules` для (product_id, tariff_id);
- `tariffs.{name, access_days}`;
- `audit_logs` фильтр `action LIKE 'grant-access-for-order%' AND meta->>'order_id'=<id>` за всё время.

### 3.2 Классификация (per-order)


| planned_action                                                 | условие                                                                                                                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_primary_entitlement_and_subscription`                  | нет entitlement и нет active subscription по (user_id, product_id)                                                                                                    |
| `extend_active_subscription`                                   | есть active subscription с **тем же** `tariff_id`; `grant-access-for-order` выполнит idempotent extend                                                                |
| `create_new_subscription_tariff_change`                        | есть active subscription, но `tariff_id` отличается (см. mem://commercial-logic/access/extend-tariff-match-required) — будет создана новая, существующая не трогается |
| `skip_already_fulfilled`                                       | guard `grant-access-for-order` уже считает order fulfilled (entitlement по order_id есть, даты не stale) — фактически no-op                                           |
| `stop_no_user_id` / `stop_no_product_id` / `stop_no_tariff_id` | данных не хватает (по proof все 9 имеют все три, но re-check обязателен)                                                                                              |
| `stop_status_changed`                                          | order.status != 'paid'                                                                                                                                                |
| `stop_foreign_user_collision`                                  | order_id уже привязан к entitlement другого user_id (hard-stop в writer)                                                                                              |


### 3.3 Ожидаемый `access_end_at`

- `extend_active_subscription`: `GREATEST(current_access_end_at, access_start_resolved + tariff.access_days)` — расчёт canonical writer, не предсказываем сами; в dry-run выводим текущий `access_end_at` и `+access_days` как «планируемая нижняя граница».
- `create_primary_*` / `create_new_*`: `paid_at_or_created_at + tariff.access_days` (canonical writer пересчитает по своему `calcCalendarMonthEnd` для club).

### 3.4 Telegram action

- Для `product.telegram_club_id IS NOT NULL` и `access_rules` с Telegram fulfillment: planned `telegram-grant-access` через canonical (writer вызовет сам).
- Для остальных: `none`.
- Прямой Telegram-вызов исключён.

### 3.5 Dry-run артефакт

`.lovable/proofs/inv_group_a_canonical_regrant_dry_run_2026_05.md` с таблицей по каждому order:

```text
order_id | order_number | source | user_id | product_name | tariff_name |
current_ent.expires_at | current_sub.status/end | planned_action |
expected_access_end_at_lower_bound | telegram_action | stop_reason
```

И сводка: счётчики по planned_action, список stop, общий go/no-go.

### 3.6 Что НЕ делаем в dry-run

- Не вызываем `grant-access-for-order` даже в `dry_run` mode (этот writer не имеет dry-режима).
- Не пишем в audit.
- Не меняем БД.

## 4. STOP-guards (между dry-run и execute)

Execute блокируется (waiting for approve), если хотя бы одно:

- любой кандидат с `stop_*` reason;
- любой кандидат с `foreign_user_collision`;
- любой кандидат, где `product_id` или `tariff_id` пустые;
- любой кандидат, где `user_id` пуст (ghost);
- кандидатов >9 (значит scope расползся);
- кандидатов <1 (нечего чинить — фиксируем и закрываем).

При срабатывании STOP — отчёт с причиной, без execute.

## 5. Этап 2 — Execute (только после approve dry-run)

### 5.1 Контракт вызова

Для каждого order последовательно (НЕ параллельно):

```ts
supabase.functions.invoke('grant-access-for-order', {
  body: { orderId, source: 'inv_group_a_canonical_regrant_2026_05' }
})
```

- `orderId` — canonical.
- Никаких `customAccessDays/customAccessStartAt/customAccessEndAt` — writer считает SOT-окно сам.
- `extendFromCurrent: true` по умолчанию.
- `grantTelegram: true` — Telegram идёт canonical path через `access_rules`.
- Сериально (1 за раз), таймаут 30s, без ретраев на 4xx; на 5xx — 1 повтор через 5s.

### 5.2 Per-order ветвление по ответу


| ответ writer'а                                                             | действие                                              |
| -------------------------------------------------------------------------- | ----------------------------------------------------- |
| `success: true` + `subscription_id`/`entitlement_id`                       | записать before/after в proof, статус `done`          |
| `skip_already_fulfilled`                                                   | статус `idempotent_skip`, считается успехом           |
| `error: 'order_id_collision_foreign_user'`                                 | статус `manual_review`, не чинить, в отдельный список |
| `error: 'sbs_mismatch'` / `manual_review` / `primary_entitlement_*_failed` | статус `manual_review`, в отдельный список            |
| HTTP 4xx (валидация)                                                       | статус `precheck_failed`, в отдельный список          |
| HTTP 5xx / exception после 1 ретрая                                        | статус `dispatcher_error`, в отдельный список         |


### 5.3 Audit

Дополнительно к audit writer'а — отдельная запись в `audit_logs`:

```text
action: 'inv_group_a_canonical_regrant.execute'
actor_type: 'system'
meta: { order_id, planned_action, result_status, before, after, writer_response }
```

## 6. Этап 3 — Post-execute proof

`.lovable/proofs/inv_group_a_canonical_regrant_execute_2026_05.md` с разделами:

1. Before/after таблица по 9 order'ам:
  - `entitlement.id`, `entitlement.expires_at` до и после;
  - `subscription.id`, `subscription.status`, `access_end_at` до и после;
  - Telegram: создан/продлён/none.
2. Audit-выборка по `action LIKE 'grant-access-for-order%'` за окно execute (с фильтром по order_id).
3. Список `manual_review` с конкретным error-кодом writer'а и причиной.
4. Подтверждение, что прямых DML в `entitlements`, `subscriptions_v2`, `telegram_*` не было (по audit и по count delta вне canonical path).
5. Подтверждение, что Telegram везде создан через canonical path (нет записей в `telegram_access_queue` со `source` вне whitelist `{reinvite, manual_bulk, repair, admin_backfill}`).
6. DoD-чеклист (см. §10).

## 7. Что НЕ меняем

- `BEPAID_REBILL_MATERIALIZATION` — не трогаем.
- `bepaid-webhook` — не трогаем.
- Schema/RLS — не меняем.
- Group D (51 кандидат) — отдельным планом «Subscription/Entitlement Date Alignment — read-only first», вне PATCH E.
- Group B/C — отдельным планом после TG-schema sweep.
- Никаких manual fix для `manual_review` ветки — только список и причина.

## 8. Изменяемые файлы

Только proof'ы:

- `.lovable/proofs/inv_group_a_canonical_regrant_dry_run_2026_05.md`
- `.lovable/proofs/inv_group_a_canonical_regrant_execute_2026_05.md`

Код не меняется. Тестов не добавляем — `grant-access-for-order` уже покрыт 9 unit-тестами (зелёные после PATCH A).

## 9. Риски

- `admin_grant` GIFT-orders могли быть подарками: возможно, у пользователя уже есть активная подписка по другому `tariff_id` → ветка `create_new_subscription_tariff_change`. Это легитимный исход, не ошибка.
- Старые `PAY-*` orders (2026-02/03) — пользователь мог за 2-3 месяца получить доступ другим путём (новый order, ручной grant). Тогда writer вернёт `skip_already_fulfilled`. Это тоже легитимно.
- `order_id_collision_foreign_user` маловероятен (proof фильтрует `user_id IS NOT NULL`), но guard оставлен.

## 10. DoD

- Dry-run артефакт с таблицей по 9 order'ам и сводкой создан.
- Approve dry-run получен явно.
- Execute прогнан сериально через `grant-access-for-order(orderId)`.
- Post-execute proof содержит before/after по всем 9.
- Прямых DML в entitlements/subscriptions_v2/telegram_* нет.
- Telegram только canonical path.
- `manual_review`/`dispatcher_error` вынесены в отдельный список с error-кодами.
- `BEPAID_REBILL_MATERIALIZATION=on` не включался.

## 11. Следующий план (отдельно, не часть PATCH E)

«План: Subscription/Entitlement Date Alignment — read-only first» — для Group D (51 кандидат): сначала read-only классификация причин расхождения дат (renewal mis-alignment / partial extend / legacy import), потом отдельный repair по подгруппам через canonical writer. Подготовлю отдельным сообщением после approve этого плана.