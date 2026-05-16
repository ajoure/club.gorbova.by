# да, согласен, с учетом правок:

1. **Stage 0 mode check должен быть фактическим, не ручным.**  
Заменить:

```text
ручная сверка пользователем
```

на:

```text
fetch secret / runtime proof из audit, значение должно быть on
```

2. **TEMP-таблица только session/transaction.**  
Добавить явно:

```text
TEMP h5_1b_jan_frozen не persistent, не migration, не schema object.
```

3. `created_at` **для REBILL лучше как runtime.**  
Перед execute в Stage 0 проверить, что runtime REBILL пишет в `created_at`.  
Если runtime использует `payment.paid_at`, то H5 тоже должен использовать `payment.paid_at`, а не `now()`.
4. **Audit schema-check обязателен.**  
Перед Stage 3 проверить, существуют ли поля:

```text
actor
actor_subtype
entity_type
entity_id
```

Если нет — использовать фактическую схему:

```text
actor_type
actor_user_id
actor_label
action
meta
```

5. `provider_subscriptions` **checksum не использовать с** `current_period_end` **без schema-check.**  
Поле уже раньше было спорным. В Stage 2 сначала schema-check, потом checksum по фактическим полям.
6. `telegram_access_queue` **checksum scoped, не global.**  
Только по 12 users/связанным order/payment meta, иначе параллельные события могут дать ложный fail.
7. **Rollback должен проверять отсутствие дополнительных ссылок перед DELETE.**  
Добавить pre-delete guard:
  - у каждого H5 REBILL ровно 1 planned payment;
  - нет entitlements;
  - нет subscriptions_v2 references;
  - нет telegram/access references;
  - нет refund rows.
8. **Stage 3 execute пока не approve.**  
Текущий approve — только на Stage 0–2.

Команда:

```text
План H5.1b-Jan подтверждаю только на Stage 0–2.

Выполни:
- mode check;
- frozen Jan recheck;
- schema-check orders/payments/audit/provider_subscriptions;
- runtime REBILL created_at/status format check;
- preflight guards;
- scoped baselines;
- final frozen execute table;
- expected rowcounts;
- rollback preview.

DML не запускать.
Stage 3 execute — только после отдельного approve по dry-run artifact.

План: H5.1b-Jan — Historical REBILL Deal Linkage Repair 2026 / January batch
```

## Цель

Материализовать REBILL-orders для **12 green-кандидатов R2 за месяц 2026-01** и переподвязать их payments_v2.order_id на новые REBILL-orders. Остальные месяцы (02–05) — не трогаем; они пойдут отдельными H5.1b-Feb/Mar/Apr/May.

## Frozen source

- `.lovable/proofs/h5_1a_r2_expanded_frozen_candidate_cohort_2026_05_green.csv`
- Фильтр execute: `payment_month = '2026-01'` → ожидаемо **12 строк**, Σ 1 581.00 BYN, 1 currency=BYN.
- Снимок frozen-список фиксируется перед stage 1 как TEMP-таблица `h5_1b_jan_frozen` (payment_id, provider_payment_id, parent_order_id, product_id, tariff_id, pipeline_id, pipeline_stage_id, offer_id, amount, paid_at, expected_rebill_order_number).

## Scope

- DML только по 12 payment_id из frozen Jan list.
- Месяцы 02/03/04/05 — НЕ трогать (отдельные batches).
- Любая строка, прошедшая через preflight как не-green → исключается из execute, помечается `skip:<reason>`.

## Запрещено

- refunds, entitlements, subscriptions_v2, telegram_*, provider_subscriptions, access_rules
- provider API, grant-access-for-order, telegram-grant-access
- изменение secrets / `BEPAID_REBILL_MATERIALIZATION` mode
- любые payments вне frozen Jan list
- любые orders_v2 NOT REBILL (parent не трогаем)
- любые UPDATE на orders_v2 (только INSERT новых REBILL)
- любые DELETE кроме rollback по `meta.run='h5_1b_jan_2026'`

## Этапы

### Stage 0 — Mode & frozen re-check (read-only)

1. Подтвердить `BEPAID_REBILL_MATERIALIZATION=on` (env, ручная сверка пользователем перед approve execute).
2. Перечитать CSV → 12 payment_id, зафиксировать в TEMP `h5_1b_jan_frozen`.
3. Проверить, что все 12 payment_id присутствуют в `payments_v2`.
4. STOP, если mode != on или строк ≠ 12.

### Stage 1 — Preflight guard re-run (read-only, per payment)

Для каждой из 12 строк проверить:

- `payments_v2.order_id = frozen.parent_order_id` (платёж не переехал).
- `parent.order_number NOT LIKE 'REBILL-%'` (parent всё ещё initial).
- Уже-materialized guard (4 ключа):
  - `orders_v2.order_number = 'REBILL-' || first12(payment_id)` — НЕ существует
  - `orders_v2.meta->>'materialized_from_payment_id' = payment_id::text` — НЕ существует
  - `orders_v2.meta->>'materialized_from_payment_uid' = provider_payment_id` — НЕ существует
  - `(provider='bepaid', provider_payment_id=...) AND order_number LIKE 'REBILL-%'` — НЕ существует
- Refund guard clean (`refunded_amount=0`, нет refund-row по payment uid).
- В parent остаётся хотя бы один non-refund payment, который НЕ материализуется этим batch (защита от «осиротевшего» parent).
- `pipeline_id`, `pipeline_stage_id`, `tariff_id`, `product_id` — NOT NULL.
- `amount > 0`, `currency='BYN'`.

Любая нарушенная проверка → строка исключается, записывается в `skip_table` с причиной.

### Stage 2 — Baselines + dry-run final rowcount table (read-only)

1. Зафиксировать checksums:
  - `subscriptions_v2` scoped по 12 users: rows, Σepoch(access_end_at), md5(id||access_end_at||status||updated_at)
  - `entitlements` scoped по 12 users: rows, Σepoch(expires_at), md5(id||expires_at||updated_at)
  - `orders_v2` global REBILL-%: rows, md5(ids)
  - `payments_v2` scoped: md5(id||order_id||amount||provider_payment_id)
  - `provider_subscriptions` scoped по 12 users: rows, md5(ids||status||current_period_end)
  - `telegram_access_queue` rows, md5(ids)
2. Вывести **final frozen execute table** (по passed-preflight строкам):
  ```
   payment_id | provider_payment_id | parent_order_id | expected_rebill_order_number | guard_status
  ```
3. Зафиксировать `green_candidates_count = N_passed_preflight` (ожидаемо 12).
4. Зафиксировать `expected_inserts_orders_v2 = N`, `expected_updates_payments_v2 = N`, `expected_audit_rows = N + 1` (per payment + summary).
5. STOP до отдельного approve пользователя. Артефакт публикуется в `.lovable/proofs/h5_1b_jan_historical_rebill_execute_2026_05.md`.

### Stage 3 — Execute (только после approve на dry-run table)

Внутри **одной транзакции** (`BEGIN; ... COMMIT;`), per-row:

1. **INSERT `orders_v2**` (REBILL):
  - `id` = gen_random_uuid()
  - `order_number` = `'REBILL-' || first12(payment.id::text)`
  - `user_id`, `profile_id`, `product_id`, `tariff_id`, `offer_id`, `pipeline_id`, `pipeline_stage_id`, `currency` — из frozen
  - `deal_date` = `payment.paid_at`
  - `created_at` = `now()`, `updated_at` = `now()`
  - `paid_amount` = `payment.amount`
  - `final_price` = `payment.amount`
  - `provider` = `'bepaid'`
  - `provider_payment_id` = `payment.provider_payment_id`
  - `bepaid_subscription_id` = NULL (R2 — parent.bepaid_subscription_id пустой; меняем только если frozen.sbs_resolved IS NOT NULL)
  - `status` = `'paid'` (или текущий канонический статус; см. §technical)
  - `meta` = `jsonb_build_object('source','h5_historical_repair','run','h5_1b_jan_2026','materialized_from_payment_id', payment.id::text, 'materialized_from_payment_uid', payment.provider_payment_id, 'parent_order_id', parent_order_id::text, 'do_not_grant_access', true, 'recurring_evidence_source', frozen.recurring_evidence_source, 'sbs_source', frozen.sbs_source)`
  - **In-tx re-guard**: `INSERT ... WHERE NOT EXISTS (SELECT 1 FROM orders_v2 WHERE order_number = 'REBILL-' || first12(payment.id::text))` — если конфликт → транзакция ROLLBACK и STOP.
2. **UPDATE `payments_v2**`:
  - `SET order_id = <новый REBILL-order.id>`
  - `WHERE id = payment.id AND order_id = frozen.parent_order_id` (защита от гонки с runtime).
  - Если `ROW_COUNT() ≠ 1` → ROLLBACK + STOP.
3. **INSERT `audit_logs**` per payment:
  - `actor = 'system'`, `actor_subtype = 'h5_1b_jan'`
  - `action = 'h5_historical_rebill_materialized'`
  - `entity_type = 'orders_v2'`, `entity_id = new_rebill_order.id`
  - `meta` = `{payment_id, parent_order_id, provider_payment_id, expected_rebill_order_number, amount, paid_at, recurring_evidence_source}`
4. **INSERT `audit_logs` summary** (one row):
  - `action = 'h5_1b_jan_batch_completed'`
  - `meta` = `{run:'h5_1b_jan_2026', total_inserts, total_payment_updates, total_audit_rows, ts_start, ts_end, source_csv}`
5. `COMMIT;`

### Stage 4 — Post-verify (read-only)

1. Сравнить checksums из Stage 2:
  - `subscriptions_v2` scoped — **должно совпадать** (DML не трогал).
  - `entitlements` scoped — **должно совпадать**.
  - `provider_subscriptions` — **должно совпадать**.
  - `telegram_access_queue` — **должно совпадать**.
  - `orders_v2` REBILL-%: rows = old + N, новые ids — только наши с `meta.run='h5_1b_jan_2026'`.
  - `payments_v2`: точно N строк с обновлённым `order_id`, остальные — без изменений.
2. Проверить, что для каждого нового REBILL-order:
  - есть ровно один payment с `order_id = REBILL.id`
  - этот payment.id принадлежит frozen Jan list
  - parent_order (из frozen) всё ещё имеет ≥1 non-refund payment
3. STOP, если что-то расходится → перейти к Rollback.

### Stage 5 — Rollback (только при сбое post-verify или явной команде)

В одной транзакции:

1. `UPDATE payments_v2 SET order_id = <frozen.parent_order_id> WHERE id IN (<frozen Jan ids>) AND order_id IN (SELECT id FROM orders_v2 WHERE meta->>'run'='h5_1b_jan_2026');`
2. `DELETE FROM orders_v2 WHERE meta->>'run'='h5_1b_jan_2026';`
3. `INSERT INTO audit_logs (action='h5_1b_jan_rollback', meta={reverted_count, reason});`
4. `COMMIT;`
5. Re-verify checksums = baselines.

## Артефакт

`.lovable/proofs/h5_1b_jan_historical_rebill_execute_2026_05.md` содержит:

- Stage 0 mode + frozen recheck
- Stage 1 preflight результаты (passed / skipped с причинами)
- Stage 2 baselines + final frozen execute table + expected rowcounts
- Stage 3 фактические rowcounts после execute
- Stage 4 post-verify diff
- (Stage 5 при необходимости)

## Что не входит в этот план

- Месяцы 02/03/04/05 — отдельные планы H5.1b-Feb/Mar/Apr/May.
- 11 manual_review строк (10 sbs_unresolved + 1 pipeline_missing) — отдельный H5.2.
- Refund orphans (35 строк из H5 dry-run) — отдельный H5.3.

## Technical detail (для разработчика)

**Поля `orders_v2.status**` — точный enum/значение «paid» сверить в Stage 0 (`SELECT DISTINCT status FROM orders_v2 WHERE order_number LIKE 'REBILL-%' LIMIT 5`), использовать то же значение, что runtime пишет для materialized REBILL.

`**bepaid_subscription_id` на REBILL-order**: писать `frozen.sbs_resolved` если NOT NULL, иначе NULL. В январском batch почти все строки будут с NULL (`parent.bepaid_subscription_id` глобально пустой), evidence уходит в `meta.sbs_source` и `meta.recurring_evidence_source`.

`**crm_routing**`: использовать `pipeline_id`/`pipeline_stage_id` из frozen (т.е. из parent order). НЕ резолвить заново через crm_routing — этого делает grant-access-for-order, но он запрещён к вызову. Берём готовые значения.

`**do_not_grant_access=true**` — флаг для будущих nightly reconcile / `grant-access-for-order` retro: REBILL-orders из этого batch НЕ должны триггерить новые grants (отдельная безопасность).

**Mode-race**: даже при `BEPAID_REBILL_MATERIALIZATION=on` re-guard внутри транзакции (`WHERE NOT EXISTS`) защищает от runtime, успевшего материализовать платёж между Stage 2 dry-run и Stage 3 execute.

**Транзакция**: одна на весь batch (12 строк) — атомарно для Jan. Если падает 1 строка — ROLLBACK всего batch. Re-run после фикса.

## Approve gates

1. Approve **этого плана** → переход к Stage 0–2 (read-only, dry-run, frozen table).
2. Approve **dry-run артефакта** (`.lovable/proofs/h5_1b_jan_historical_rebill_execute_2026_05.md` с final frozen execute table + expected rowcounts) → переход к Stage 3 execute.
3. После Stage 4 post-verify — отчёт пользователю; approve следующего месяца (H5.1b-Feb) отдельным сообщением.