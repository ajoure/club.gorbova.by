# да, согласен, с учетом правок:

1. **Stage 1 запускать только read-only dry-run.**  
Execute не выполнять. H5.1 — отдельный план после таблицы кандидатов.
2. **Критично: не использовать** `provider_payment_id` **/** `payment_id` **неоднозначно.**  
В proof для каждого платежа явно разделить:

```text
payments_v2.id
payments_v2.provider_payment_id / bePaid uid
orders_v2.provider_payment_id
```

И `REBILL-<first12>` строить строго по тому идентификатору, который уже принят в текущем коде materialization. Не смешивать UUID строки payment и bePaid uid.

3. **Уточнить признак refund.**  
Ранее в базе встречалось `transaction_type='Возврат средств'` и refund amount может быть положительным. Поэтому фильтр должен учитывать фактические варианты:

```text
transaction_type IN ('Возврат средств','refund','Refund')
OR meta->>'type'='refund'
OR refunded_amount > 0 на parent
```

Не полагаться только на `amount<0`.

4. **Кандидат** `rn>1` **считать только среди успешных non-refund платежей.**  
Refund-rows не должны делать initial-order кандидатом по `rn>1`.
5. **STOP-guard “initial остался бы без платежей” уточнить.**  
Initial-order может остаться с initial payment. Если после переноса rebill-платежей initial-order остаётся без non-refund payment — это manual_review.
6. **Сверку с** `rebill_orders_audit_2026.md` **делать как reference, не как source of truth.**  
SOT — текущие `orders_v2/payments_v2`. Старый audit мог устареть после repair Ларисы и включения mode=on.
7. **Spot-check по Веронике Матук уточнить.**  
У Вероники часть проблем была zombie provider subscriptions, не обязательно deal-linkage. Если она не попадёт в H5 candidates — это не ошибка, но нужно указать: `not_candidate_reason`.
8. **Pre-state checksums через** `sum(epoch)` **могут ломаться на NULL.**  
Использовать `COALESCE` и отдельно count NULL:

```text
sum(coalesce(extract(epoch from access_end_at),0))
count(*) filter where access_end_at is null
```

То же для `entitlements.expires_at`.

9. **Stage 2 не фиксировать** `do_not_grant_access=true` **как окончательное решение в Stage 1.**  
Для dry-run указать как proposed guard. В H5.1 отдельно подтвердить, что это не сломает отчёты/карточку сделки.
10. **Добавить явную проверку уже существующих REBILL-orders.**  
Для каждого candidate проверить:

```text
orders_v2.provider_payment_id = payment.provider_payment_id
OR orders_v2.meta->>'materialized_from_payment_uid' = payment.provider_payment_id
OR orders_v2.meta->>'source_payment_uid' = payment.provider_payment_id
OR order_number = 'REBILL-...'
```

Если найдено несколько — `manual_review`.

11. **Добавить проверку deal_date.**  
Для expected REBILL:

```text
deal_date = payment.paid_at
deal_month = payment_month_minsk
```

Initial-order `deal_date` не менять.

12. **В dry-run добавить итоговый executive summary.**

```text
total_candidates
create_rebill_order
relink_to_existing_rebill
refund_repairs
manual_review
skip_already_correct
affected_users
affected_parent_orders
```

13. **Запретить любые изменения доступа ещё раз в Stage 2.**  
В H5.1 checksums должны доказать:

```text
subscriptions_v2 unchanged
entitlements unchanged
telegram unchanged
provider_subscriptions unchanged
```

14. **Команда на выполнение:**

```text
План H5 подтверждаю только для Stage 1 read-only dry-run.

Выполни:
- поиск всех исторически склеенных REBILL-платежей за 2026;
- refund resolution;
- planned_action classification;
- manual_review список;
- checksums;
- spot-check Лариса + Вероника с not_candidate_reason при необходимости.

Запрещено:
- DML;
- создание orders;
- relink payments;
- изменение refunds;
- изменение entitlements/subscriptions_v2/Telegram/provider_subscriptions;
- provider API;
- secrets/mode changes.

Proof:
.lovable/proofs/h5_historical_rebill_deal_linkage_dryrun_2026_05.md

Execute не запускать без отдельного H5.1 approve.
```

После dry-run уже решим, делать один execute или разбивать по группам риска.

&nbsp;

План: H5 — Historical REBILL Deal Linkage Repair 2026

## Цель

Привести в порядок финансовую привязку **уже существующих** сделок за 2026 год: каждый recurring/autocharge bePaid платёж должен лежать в отдельной REBILL-сделке своего месяца, а не висеть на initial-order. Refunds — на правильном parent payment / REBILL-order.

**Не цель**: трогать доступы. Entitlements / subscriptions_v2 / Telegram / access_rules / provider_subscriptions — read-only.

## Контекст и почему сейчас

- H4 mode=on включён → новые rebills с 2026-05-17 материализуются канонически.
- Историческая склейка осталась с до-H4 периода (см. кейс Ларисы Конобеевой — `inv_deal_linkage_lori_30_2026_05.md`, и ранний аудит `rebill_orders_audit_2026.md` — 200 кандидатов на материализацию).
- Без H5 финансовая история сделок в админке остаётся кривой по месяцам, даже если новые платежи дальше идут правильно.
- H5 ортогонален H4: mode=on отвечает за будущее, H5 — за уборку 2026.

## Scope (жёсткий)

Включено:

- `payments_v2`: provider=`bepaid`, успешные (`status ∈ {paid, succeeded, refunded}`), `paid_at` в `[2026-01-01; 2027-01-01)`.
- Recurring/autocharge признаки: `bepaid_subscription_id IS NOT NULL` ИЛИ `meta.payment_flow='bepaid_subscription_charge'` ИЛИ `meta.is_recurring=true` ИЛИ `meta.parent_uid IS NOT NULL`.
- `orders_v2`: linkage / `order_number` / `status` / `paid_amount` / `meta`.
- Refund rows (`transaction_type='refund'` ИЛИ `amount<0` ИЛИ `meta.type='refund'`) — переезжают вместе с parent payment.

Исключено (read-only):

- `entitlements`, `subscriptions_v2` (включая `access_end_at`, `extended_by_orders`), `access_rules`, `provider_subscriptions`, Telegram, любые grant-функции.
- Любой provider API (bePaid write).
- Любые изменения `BEPAID_REBILL_MATERIALIZATION` или других secrets.
- Synthetic orders (`source='rule_engine'`).

## Stage 1 — Read-only dry-run

### 1.1 Идентификация кандидатов

Для каждого `payments_v2` в скоупе:

- Найти текущий `order_id` (parent).
- Определить `payment_month_minsk = to_char(paid_at AT TIME ZONE 'Europe/Minsk', 'YYYY-MM')`.
- Определить `order_month_minsk = to_char(COALESCE(order.deal_date, order.created_at) AT TIME ZONE 'Europe/Minsk', 'YYYY-MM')`.
- Ранг платежа внутри order по `paid_at, id` (только успешные, non-refund).

Кандидат на материализацию = `rn>1` ИЛИ `payment_month_minsk <> order_month_minsk` И `order.order_number NOT LIKE 'REBILL-%'`.

### 1.2 Классификация planned_action

- `skip_already_correct` — `rn=1` И месяцы совпадают.
- `skip_already_materialized` — order уже REBILL-* по этому `provider_payment_id`.
- `repair_existing_rebill_linkage` — REBILL-order для этого pid существует, но payment всё ещё пристёгнут к initial-order.
- `create_rebill_order` — REBILL-order не существует, нужно создать.
- `relink_payment_to_existing_rebill` — REBILL по pid существует, перепривязать payment.
- `relink_refund_to_rebill` — refund-row должен переехать к новому/существующему REBILL parent.
- `update_parent_refunded_amount` — у parent payment `refunded_amount` рассинхрон с refund-rows.
- `mark_rebill_refunded` — у REBILL refunded_sum ≥ paid → status=`refunded` (или partial).
- `manual_review` — попал в STOP-guard.

### 1.3 Refunds resolve

Для каждой refund-row в скоупе:

- Резолв parent через `meta.parent_payment_id` → `meta.parent_payment_uid` → match по `(bepaid_subscription_id, amount, time-window)`.
- Если parent найден и parent переезжает в REBILL → refund-row тоже переезжает, `order_id` = REBILL-order, `meta.parent_payment_id` гарантированно заполнен.
- Если parent НЕ найден → `manual_review` (не угадывать).

### 1.4 Dry-run отчёт (таблица)

Колонки: `customer | email | current_order | current_order_month | payment_uid | payment_paid_at_minsk | payment_month_minsk | amount | is_refund | expected_rebill_order | expected_deal_month | planned_action | risk | stop_reason`.

Агрегаты:

- total candidates, distinct users, distinct parents.
- разбивка по `planned_action`.
- разбивка по месяцу.
- сверка с `rebill_orders_audit_2026.md` (200 кандидатов) — разница объясняется (что уже материализовано после mode=on, что ушло в STOP).

### 1.5 STOP-guards (→ `manual_review`, не блок репорта)

- Payment не recurring/rebill по нашим признакам.
- Не определён parent subscription/order.
- REBILL-order существует, но `tariff_id` / `user_id` / `currency` конфликтуют.
- Refund parent не найден.
- `Σ|refund.amount| > parent.amount`.
- Перепривязка снизит `initial_order.paid_amount` некорректно (initial остался бы без платежей).
- Кандидат вне 2026.
- `provider_payment_id` пустой.
- Payment.user_id ≠ Order.user_id.
- Кандидат затронул бы entitlements/subscriptions_v2/Telegram (по теории не должен — guard на случай дрейфа).

### 1.6 Запрещено в Stage 1

DML, INSERT orders, UPDATE payments/refunds/orders, изменения entitlements/subscriptions_v2/Telegram/access_rules/provider_subscriptions, любые provider API, изменения secrets/mode.

### 1.7 Pre-state checksums (для верификации в Stage 2)

```
-- по скоупу пользователей-кандидатов
md5(payments_v2: id|order_id|amount|refunded_amount|transaction_type)
md5(orders_v2:   id|status|paid_amount|order_number|meta->>deal_month)
sum(subscriptions_v2.access_end_at::epoch)   -- должно быть неизменным
sum(entitlements.expires_at::epoch)          -- должно быть неизменным
```

### 1.8 Proof

`.lovable/proofs/h5_historical_rebill_deal_linkage_dryrun_2026_05.md`

### DoD Stage 1

- Полный список склеенных сделок 2026 с planned_action.
- manual_review список с причинами.
- Pre-state checksums зафиксированы.
- DML = 0, migrations = 0, provider API = 0.
- Proof создан.

---

## Stage 2 — Execute (только после approve dry-run отдельным сообщением)

Не выполняется в этом плане. Требует отдельный H5.1 plan с фиксированным snapshot из Stage 1.

Разрешённый DML (предварительно):

- INSERT недостающих `orders_v2` REBILL-* (формат `REBILL-<first12chars(payment_id)>`, `meta.source='h5_historical_repair'`, `do_not_grant_access=true`, `deal_date=payment.paid_at`).
- UPDATE `payments_v2.order_id` (relink).
- UPDATE refund-rows: `order_id`, `meta.parent_payment_id`.
- UPDATE parent payment `refunded_amount` если был рассинхрон.
- UPDATE REBILL-order `status` / `paid_amount` / `meta` (paid/partial_refund/refunded).
- INSERT `audit_logs` action=`orders.h5_historical_rebill_repaired` по каждой записи + один summary-row.

Запрещено в execute:

- entitlements, subscriptions_v2, Telegram, provider_subscriptions, access_rules.
- Provider API.
- BEPAID_REBILL_MATERIALIZATION.
- Любые unrelated fixes.

Rollback: SQL-скрипт прилагается к H5.1, восстанавливает прежние `order_id` payments/refunds и удаляет созданные REBILL-orders с `meta.source='h5_historical_repair'` (нет ссылок на entitlements → безопасно).

### DoD Stage 2

- Каждая recurring оплата 2026 — в REBILL-сделке своего месяца.
- Initial-order содержит только initial payment.
- Refunds на правильном parent + правильном order.
- Карточки сделок в админке показывают корректный месяц (`getEffectiveDealDate` уже SOT = `deal_date`).
- Post-state checksums: `subscriptions_v2.access_end_at` и `entitlements.expires_at` — без изменений.
- Audit по каждому изменению + summary.
- Rollback SQL приложен и проверен.

---

## Технические детали

- Часовой пояс месяца: `Europe/Minsk` (как в `rebill_orders_audit_2026.md`).
- `order_number` REBILL: `'REBILL-' || substr(payment_id::text, 1, 12)` — совместимо с `idx_orders_v2_provider_payment_unique`.
- `meta.do_not_grant_access=true` — защита от случайного вызова `grant-access-for-order` любым другим процессом.
- Pipeline/stage у REBILL = pipeline/stage parent-order.
- Spot-check кейсов в Stage 1: Лариса Конобеева (`lori-30@tut.by`), Вероника Матук (`014f5822…`) — должны быть в кандидатах с понятным planned_action.

## Out of scope (явно)

- G25 / Alesya Khomich — hold.
- Рабчевская Юлия — отдельный repair.
- Wave 2 phantom past_due (51) — не linkage, не сюда.
- Future-sprint «1 платёж = 1 сделка» для legacy ребиллов до 2026 — отдельный план.