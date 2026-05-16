# да, согласен.

Запускать только текущий шаг:

```text
Stage 0 + Stage 0.5 — frozen execute table
```

Без DML.

## **Команда Lovable**

```text
План H5.1 v2 подтверждаю.

Выполни только Stage 0 + Stage 0.5:

1. Schema-check.
2. REBILL number format verify.
3. Mode check: BEPAID_REBILL_MATERIALIZATION=on.
4. Baseline stable checksums.
5. Frozen execute table по кандидатам:
   - green;
   - manual_review;
   - skipped.
6. Expected rowcounts:
   - INSERT orders_v2 = green_candidates_count;
   - UPDATE payments_v2 = green_candidates_count;
   - INSERT audit_logs = green_candidates_count + 1.
7. Rollback SQL preview.
8. Proof + CSV:
   - .lovable/proofs/h5_1_frozen_execute_table_2026_05.md
   - .lovable/proofs/h5_1_frozen_execute_table_2026_05.csv

Запрещено:
- DML;
- создание REBILL-orders;
- UPDATE payments_v2;
- любые changes в orders_v2;
- entitlements;
- subscriptions_v2;
- Telegram;
- provider_subscriptions;
- provider API;
- secrets/mode changes;
- migrations;
- persistent temp tables.

После frozen table остановиться и ждать отдельного approve на execute.
```

После отчёта по frozen table можно будет принимать решение: запускать весь green batch или делить на подбатчи.

&nbsp;

План: H5.1 — Historical REBILL Deal Linkage Repair 2026 execute (v2, frozen-table-gated)

Execute-фаза для кандидатов из H5 dry-run. **DML не запускается до отдельного approve по frozen execute table.** Текущий шаг — построить frozen table; всё ниже — контракт того, что войдёт в execute после approve.

## 0. Изменения относительно v1

- Введён обязательный **Stage 0.5 — Frozen Execute Table** как gate перед approve.
- `expected rowcounts = green_candidates_count` (не «72» захардкоженных).
- `bepaid_subscription_id` для REBILL берётся из доказуемого источника на уровне payment, не слепо от parent.
- Добавлен **Stage 0.A schema-check** для всех колонок, которые мы пишем/читаем.
- Подтверждён формат `REBILL-<first12(provider_payment_id)>` сверкой с runtime materialization.
- Жёсткий **refund-guard**: любой payment с refund-следом → `manual_review` / H5.2.
- Введены **stable checksums** (без `order_id`/`updated_at` для payments_v2, без будущих H5 rows для orders_v2).
- Расширен **rollback guard** (entitlements/subs/payments/Telegram refs = 0).
- Запрет на persistent temp objects: только session-temp / CTE.
- Final STOP по `BEPAID_REBILL_MATERIALIZATION = on` перед DML.

## 1. Scope

- Кандидаты — строго из H5 dry-run snapshot (62 users, 71 parent orders, 4 tariffs, ≤72 payments, Σ ≤16 410.00 BYN).
- 35 orphan refund-rows + 1 canonical refund → **H5.2** (не сюда).
- Hold: G25 / Alesya Khomich, Рабчевская Юлия, INV-22 phantom past_due, legacy ребиллы до 2026.

## 2. Stage 0 — Pre-flight (read-only)

### 2.A Schema-check (hard STOP при отсутствии)

Подтвердить через `information_schema.columns`:

```
orders_v2.provider
orders_v2.provider_payment_id
orders_v2.bepaid_subscription_id
orders_v2.pipeline_id
orders_v2.pipeline_stage_id
orders_v2.offer_id
orders_v2.order_number
orders_v2.deal_date
orders_v2.paid_amount
orders_v2.final_price
orders_v2.currency
orders_v2.product_id
orders_v2.tariff_id
orders_v2.user_id
orders_v2.profile_id
orders_v2.status
orders_v2.meta
payments_v2.id
payments_v2.order_id
payments_v2.profile_id
payments_v2.user_id
payments_v2.paid_at
payments_v2.provider_payment_id
payments_v2.amount
payments_v2.refunded_amount
payments_v2.transaction_type
payments_v2.meta
payments_v2.updated_at
```

Любого поля нет / тип не совпадает → STOP, без DML.

### 2.B REBILL number format verify

В Stage 0 проверить, что runtime canonical materialization (bepaid-webhook / rebill writer) формирует `order_number` как `REBILL-<first12(provider_payment_id)>`. Источник истины:

- последние `audit_logs.action='bepaid.rebill.materialized'`, поле `new_order_number`;
- spot-check `orders_v2.order_number LIKE 'REBILL-%'` за последние 30d → confirm format.

Если runtime использует `payments_v2.id` или иной ключ — H5.1 **обязан** использовать тот же формат. Зафиксировать решение в proof.

### 2.C Mode check (hard STOP)

`BEPAID_REBILL_MATERIALIZATION` должен быть `on` (сейчас on, подтверждено H4.1). Если != on — STOP.

### 2.D Baseline checksums (по 62 users из H5 snapshot)

Зафиксировать в proof:

**Full baselines (для информации, из H5):**

- `payments_v2` md5 = `8435bb6cb4cc737e90fe3cc50860af47`
- `orders_v2` md5 = `e2e15331c9eab49e27f0269249a4d9d5`
- `subscriptions_v2`: rows=456, Σepoch=787 775 646 072, null=11
- `entitlements`: rows=405, Σepoch=721 480 200 523, null=0

**Stable checksums (для post-state verify, обязательны):**

- `payments_v2_stable_md5` = md5 по rows кандидатов, **исключая** колонки `order_id`, `updated_at`. После execute должен **совпасть** с pre-state (мы трогаем только order_id / updated_at).
- `orders_v2_stable_md5` = md5 по `orders_v2` rows **существующих** на момент Stage 0 (без будущих H5 REBILL-orders). После execute должен **совпасть** с pre-state. Новые H5 REBILL rows считаются отдельно.
- `subscriptions_v2_stable_md5` + rows/Σepoch/null — без изменений.
- `entitlements_stable_md5` + rows/Σepoch/null — без изменений.

## 3. Stage 0.5 — FROZEN EXECUTE TABLE (gate для approve)

**Это текущий deliverable.** Без одобрения этой таблицы никакой DML не запускается.

Артефакт: `.lovable/proofs/h5_1_frozen_execute_table_2026_05.md` + CSV `.lovable/proofs/h5_1_frozen_execute_table_2026_05.csv`.

Колонки таблицы (одна строка на candidate payment):

```
payment_id
provider_payment_id
parent_order_id
parent_order_number
user_id
product_id
tariff_id
amount
currency
paid_at
deal_month                       (Europe/Minsk, YYYY-MM)
sbs_source                       (payment_field | payment_meta | parent_match | NONE)
bepaid_subscription_id_resolved  (NULL если sbs_source=NONE)
pipeline_id (from parent)
pipeline_stage_id (from parent)
offer_id (from parent)
expected_rebill_order_number     (REBILL-<first12(provider_payment_id)>)
expected_rebill_order_id         (deterministic uuid5 OR 'gen_at_execute' marker)
refund_check                     (clean | parent_refunded | refund_row_found)
guard_status                     (green | manual_review:<reason>)
```

### 3.A Summary в proof:

- `total_dryrun_candidates` (≤72)
- `green_candidates_count` (X)
- `manual_review_count` (Y)
- `skipped_count` (Z)
- `green_sum_amount`
- `green_distinct_users`
- `green_distinct_parents`
- `expected_INSERT_orders_v2 = X`
- `expected_UPDATE_payments_v2 = X`
- `expected_INSERT_audit_logs = X + 1` (per-candidate + summary)

**Никаких «72 заранее».** Если X < 72 — execute идёт по X, остаток едет в manual_review/H5.2.

## 4. Per-candidate guards (для попадания в green)

Все условия обязательны. Любое нарушение → `manual_review:<reason>`, кандидат не идёт в execute.

1. `payments_v2.provider_payment_id IS NOT NULL`.
2. `payments_v2.order_id = parent_order_id` snapshot.
3. `payments_v2.amount > 0`, `transaction_type` не refund, `meta.type` не refund.
4. **Refund-guard (hard):**
  - `payments_v2.refunded_amount IS NULL OR refunded_amount = 0`;
  - НЕТ refund-row, ссылающейся на этот payment через `meta.parent_payment_id = payment.id` ИЛИ `meta.parent_payment_uid = payment.provider_payment_id`.
  - Любое нарушение → `manual_review:refund_present` → H5.2.
5. Нет `orders_v2 WHERE provider='bepaid' AND provider_payment_id = payment.provider_payment_id` (no duplicate REBILL).
6. После переноса у parent останется ≥1 non-refund payment (initial rn=1).
7. `parent.user_id = payment.user_id`, `parent.profile_id = payment.profile_id` (если payment.profile_id IS NOT NULL).
8. `parent.tariff_id`, `parent.product_id`, `parent.currency` существуют (наследуются REBILL-order).
9. `parent.pipeline_id IS NOT NULL` И `parent.pipeline_stage_id IS NOT NULL` (Product → Pipeline Mapping Canon). Иначе → `manual_review:pipeline_missing`.
10. `payment.paid_at` ∈ `[2026-01-01; 2027-01-01)`.
11. **SBS resolution (без слепого parent fallback):**
  - `payment.bepaid_subscription_id` (если поле существует и not null) →
    - иначе `payment.meta->>'bepaid_subscription_id'` →
    - иначе `parent.bepaid_subscription_id` **только если** оно not null И совпадает с любым доказательством на payment (например, `payment.meta` упоминает тот же sbs ИЛИ provider_response в payment.meta содержит sbs == parent.bepaid_subscription_id) →
    - иначе → `manual_review:sbs_unresolved`.
    - Поле `sbs_source` фиксирует выбранный путь.

## 5. Stage 2 — Atomic DML (после approve frozen table)

Все шаги — одна транзакция. Любая ошибка → ROLLBACK всего батча.

### 5.A Final guards внутри transaction

- Re-check `BEPAID_REBILL_MATERIALIZATION = on`.
- Re-check schema-check (2.A).
- Re-check stable checksums (`payments_v2_stable_md5`, `orders_v2_stable_md5`) против Stage 0 baseline.
- Re-resolve candidates ровно по frozen table (id-list, без re-query из dry-run).
- Если набор изменился (drift) — ROLLBACK, не выполняем.

### 5.B INSERT orders_v2 (×X = green_candidates_count)

```
INSERT INTO orders_v2 (
  id, order_number, user_id, profile_id, product_id, tariff_id, currency,
  status, paid_amount, final_price,
  provider, provider_payment_id, bepaid_subscription_id,
  deal_date, created_at, updated_at,
  pipeline_id, pipeline_stage_id, offer_id, meta
) VALUES (
  gen_random_uuid(),
  'REBILL-' || substr(payment.provider_payment_id, 1, 12),
  parent.user_id, parent.profile_id, parent.product_id, parent.tariff_id, parent.currency,
  'paid',
  payment.amount, payment.amount,
  'bepaid', payment.provider_payment_id, <sbs_resolved_per_payment>,
  payment.paid_at, payment.paid_at, now(),
  parent.pipeline_id, parent.pipeline_stage_id, parent.offer_id,
  jsonb_build_object(
    'source','h5_historical_repair',
    'run','h5_1_historical_rebill_deal_linkage_2026_05',
    'materialized_from_payment_id', payment.id,
    'materialized_from_payment_uid', payment.provider_payment_id,
    'parent_order_id', parent.id,
    'parent_order_number', parent.order_number,
    'deal_month', to_char(payment.paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM'),
    'payment_flow','bepaid_subscription_charge',
    'sbs_source', <sbs_source>,
    'do_not_grant_access', true
  )
);
```

Уникальный indx `(provider='bepaid', provider_payment_id)` гарантирует, что повтор не пройдёт.

### 5.C UPDATE payments_v2.order_id (×X)

```
UPDATE payments_v2
SET order_id = <new_rebill_id>, updated_at = now()
WHERE id = <payment.id> AND order_id = <expected_parent_id>;
```

`affected_rows ≠ 1` → ROLLBACK.

### 5.D audit_logs (×X + 1)

Per-candidate: `action='orders.h5_historical_rebill_repaired'`, `actor_type='system'`, `actor_label='h5_1_historical_rebill_deal_linkage_2026_05'`, meta = {payment_id, payment_uid, parent_order_id, new_rebill_order_id, amount, deal_month, sbs_source}.

Summary: `action='orders.h5_historical_rebill_summary'`, meta = {run, total_inserted=X, total_repointed_payments=X, manual_review_count=Y, skipped=Z, sum_amount, distinct_users, distinct_parents, mode='on'}.

### 5.E Запрещено

- INSERT/UPDATE/DELETE: `entitlements`, `subscriptions_v2`, `access_rules`, `provider_subscriptions`, `telegram_access_queue`, `telegram_grant_*`.
- Любые edge-function вызовы (`grant-access-for-order`, `bepaid-*`, `telegram-*`).
- Provider API.
- Изменения `secrets` / `BEPAID_REBILL_MATERIALIZATION`.
- Orphan refund-rows.
- Payments/orders вне frozen table.
- Persistent temp objects (только session-temp / CTE; никаких migration / постоянных таблиц).

## 6. Stage 3 — Post-state verify

1. **Rowcounts:**
  - inserted orders_v2 = X;
  - updated payments_v2 = X;
  - audit_logs per-candidate = X, summary = 1.
2. **Stable checksums:**
  - `payments_v2_stable_md5` (без `order_id`, `updated_at`) = baseline → **PASS**.
  - `orders_v2_stable_md5` (rows existing at Stage 0, исключая новые H5 REBILL) = baseline → **PASS**.
  - `subscriptions_v2` checksum/rows/Σepoch/null = baseline → **PASS**.
  - `entitlements` checksum/rows/Σepoch/null = baseline → **PASS**.
3. **Новые H5 REBILL rows** считаются отдельно: count=X, Σ paid_amount = green_sum_amount, все имеют `meta.source='h5_historical_repair'`, `meta.run='h5_1_…'`.
4. **Telegram / provider_subscriptions** по 62 users: count + max(updated_at) — без изменений.
5. **Spot-check 3 кейсов** (по 1 на каждый месяц 03/04/05): открыть карточку сделки → `deal_date`, `order_number REBILL-*`, `paid_amount`, привязка payment корректные.

## 7. Stage 4 — Rollback (extended guard)

Rollback SQL генерируется и кладётся в `.lovable/proofs/h5_1_rollback_2026_05.sql` **до** Stage 2.

**Pre-rollback guard (hard):**

- Все H5 REBILL-orders (`meta.run='h5_1_…'`):
  - 0 `entitlements` ссылок (`meta.order_id` / `source_order_id` / linkage column);
  - 0 `subscriptions_v2` ссылок (`order_id`);
  - 0 дополнительных `payments_v2` сверх X plan (т.е. payments_v2 c order_id=rebill_id ровно 1 на rebill);
  - 0 Telegram / access ссылок (`telegram_access_queue.meta.order_id`, `access_rules.meta.order_id`).
- Любое нарушение → STOP rollback, переход в manual investigation.

**Rollback SQL:**

```
BEGIN;
-- 1) Вернуть payments
UPDATE payments_v2 p
SET order_id = orig.parent_order_id::uuid, updated_at = now()
FROM (VALUES <X пар (payment_id, original_parent_id)>) AS orig(payment_id, parent_order_id)
WHERE p.id = orig.payment_id::uuid;
-- 2) Удалить H5 REBILL-orders
DELETE FROM orders_v2
 WHERE meta->>'source'='h5_historical_repair'
   AND meta->>'run'='h5_1_historical_rebill_deal_linkage_2026_05';
-- 3) Audit
INSERT INTO audit_logs(action,actor_type,actor_label,meta)
VALUES('orders.h5_historical_rebill_rollback','system','h5_1_rollback',
       jsonb_build_object('reverted_payments',X,'deleted_rebill_orders',X));
COMMIT;
```

## 8. DoD

- Frozen execute table опубликована и approved.
- X recurring payment'ов перепривязаны к REBILL-сделкам своего месяца (X = green_candidates_count, не «72»).
- `subscriptions_v2` / `entitlements` / Telegram / provider_subscriptions — без изменений.
- Stable checksums payments_v2 / orders_v2 — совпали.
- audit_logs полны (per-candidate + summary).
- Rollback SQL приложен и rollback-guard проверен.
- 3 spot-check карточки сделок показывают корректный месяц.
- Proof: `.lovable/proofs/h5_1_historical_rebill_deal_linkage_execute_2026_05.md` + frozen table CSV.

## 9. Out of scope

- 35 orphan refund-rows + любые payments с refund-следом → H5.2.
- G25 / Alesya Khomich; Рабчевская Юлия; INV-22 phantom past_due; legacy ребиллы до 2026.

## 10. Команда на текущий шаг

1. Построить `.lovable/proofs/h5_1_frozen_execute_table_2026_05.md` + CSV (Stage 0 + 0.5):
  - schema-check OK/FAIL;
  - REBILL format verify;
  - mode=on verify;
  - baseline stable checksums;
  - frozen execute table (per-candidate с guard_status);
  - summary (green/manual_review/skipped, expected rowcounts);
  - rollback SQL preview.
2. **DML не запускать.** Ожидать отдельного approve по frozen table.