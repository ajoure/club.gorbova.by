да, согласен, с учетом правок:

1. **Статусы** `active, paid` **для** `subscriptions_v2` **проверить по enum.**  
Ранее использовались:

```text
active / trial / past_due / expired / canceled / superseded
```

Если `paid` не является статусом `subscriptions_v2`, не использовать его в SQL. Лучше:

```text
status IN ('active','trial','past_due')
```

и дальше фильтровать по смыслу.

2. `crm_routing` **не должен быть blocker для уже существующего parent-order.**  
Если у parent-order уже есть `pipeline_id` и `pipeline_stage_id`, этого достаточно.  
`manual_review:pipeline_missing` только если в самом parent-order отсутствуют `pipeline_id` / `pipeline_stage_id`.
3. **Mode** `on` **не должен блокировать discovery.**  
Если mode фактически не `on`, discovery всё равно делать, но execute потом HOLD. Формулировка правильная, оставить.
4. **Refund guard расширить по фактическому** `transaction_type`**.**  
У нас встречалось:

```text
Возврат средств
```

Добавить в refund-классификацию:

```text
transaction_type IN ('Возврат средств','refund','Refund')
```

5. `already_materialized` **разделить на** `skip_done` **и conflict.**

```text
skip_done:
REBILL существует и payment уже привязан к нему.

manual_review:already_materialized_conflict:
REBILL существует, но payment всё ещё на parent-order или данные конфликтуют.
```

6. **CSV должен содержать** `guard_status` **и** `not_green_reason`**.**  
Даже если frozen CSV только green, лучше в proof иметь отдельный full CSV или таблицу всех кандидатов. Для execute SOT — только green CSV.
7. `489f08eb` **обязательно проверить независимо от общего фильтра.**  
Даже если не проходит базовый cohort, отдельным запросом показать:
  - payment;
  - parent order;
  - почему прошёл / не прошёл.
8. **Delta vs H5.1a-R2 делать по** `payment_id`**.**  
Не по provider uid и не по order number.
9. **Checksums для** `subscriptions_v2` **/** `entitlements` **делать с** `COALESCE`**.**

```sql
sum(coalesce(extract(epoch from access_end_at),0))
count(*) filter (where access_end_at is null)
```

То же для `expires_at`.

10. **Команда на запуск:**

```text
План H5-refresh подтверждаю.

Выполни строго read-only:

- Stage 1 discovery;
- Stage 2 frozen execute proposal;
- отдельный spot-check payment 489f08eb-2541-4bd3-9ad2-18e9aa99e45a;
- delta vs H5.1a-R2 по payment_id;
- checksums baseline;
- green CSV как единственный SOT для будущего execute.

Запрещено:
- DML;
- migrations;
- provider API;
- Telegram;
- grant-access-for-order;
- изменение secrets/mode;
- любые изменения entitlements/subscriptions_v2/orders_v2/payments_v2.

Artifacts:
.lovable/proofs/h5_refresh_historical_rebill_deal_linkage_discovery_2026_05.md
.lovable/proofs/h5_refresh_frozen_candidates_2026_05.csv

Execute не запускать.
```

После отчёта смотрим `green_count` и решаем, каким batch начинать расклейку.

&nbsp;

План: H5-refresh — актуальный discovery склеенных REBILL-сделок 2026

## Цель

Заново на текущий момент (после H4.1 reflip `BEPAID_REBILL_MATERIALIZATION=on` и последующего live-трафика) пересчитать полный список 2026-платежей, приклеенных к чужому parent-order вместо собственного REBILL-order. Прошлые цифры H5.1a-R2 (72/167) и H5.1b-Jan (12 → 8 green) считаем устаревшими и не используем как финальные — пересчёт с нуля.

Тестовый webhook сегодня НЕ делаем. Возвращаемся к историческому repair.

## Жёсткие границы

- Только Stage 1 read-only discovery + Stage 2 frozen-CSV предложение.
- Manual DML = 0, migrations = 0, provider API = 0, Telegram = 0.
- `grant-access-for-order` НЕ вызывается.
- Secrets / `BEPAID_REBILL_MATERIALIZATION` не меняются (читаем только факт через `fetch_secrets`).
- `entitlements` / `subscriptions_v2` / `access_rules` / `provider_subscriptions` не трогаем.
- Refunds не чиним — только классифицируем в `manual_review:refund_present`.
- Execute НЕ запускаем без отдельного approve.

## Stage 1 — Discovery (read-only)

### 1.1 Snapshot meta

- `snapshot_at_utc` = `now()`;
- `snapshot_at_minsk` = эквивалент Europe/Minsk;
- `bepaid_rebill_materialization_mode` — фиксируем по `fetch_secrets` (значение скрыто; статус ожидаем `on` по итогу H4.1 Stage 2). Если факт ≠ `on`, discovery всё равно выполняем, но в proof — warning.

### 1.2 Базовый cohort (`payments_v2` p ⨝ `orders_v2` o, p.order_id=o.id)

- `p.provider = 'bepaid'`;
- `p.amount > 0`;
- `p.status` ∈ canonical succeeded set (`succeeded`/`successful` через нормализатор);
- `p.transaction_type` — payment-type (исключаем refund/void/auth);
- `p.paid_at` ∈ `[2026-01-01, 2027-01-01)` UTC;
- `o.order_number NOT LIKE 'REBILL-%'`;
- НЕ заведомо materialized (см. 1.5).

### 1.3 Recurring evidence (минимум один источник)

- `parent.meta` маркеры: `subscription_id`, `bepaid_subscription_id`, `is_rebill`, `parent_payment_uid`, `subscription_markers`;
- `subscriptions_v2` linkage по `(user_id, product_id, tariff_id)` со status ∈ {active, paid} и `meta.bepaid_subscription_id` ≠ NULL;
- `tariff_offers.meta.recurring.is_recurring = true` для оффера parent-order (Product Type SOT — UI-чекбокс «Подписка»);
- `payment.meta` маркеры (`parent_payment_uid`, `is_rebill`, `subscription_id`), если присутствуют.

Для каждого кандидата фиксируем массив `recurring_evidence_source`.

### 1.4 Split signal (минимум один)

- `payment_month_minsk` != `parent_order_month_minsk` (по Europe/Minsk truncate);
- ИЛИ `rn > 1` среди succeeded non-refund payments этого parent-order, отсортированных по `paid_at`.

### 1.5 Already-materialized guard

Кандидат → `skip_done` при любом из:

- существует `orders_v2` row с `order_number = 'REBILL-' || left(p.id::text, 12)`;
- ИЛИ `orders_v2.meta->>'materialized_from_payment_id' = p.id::text`;
- ИЛИ `orders_v2.meta->>'materialized_from_payment_uid' = p.provider_payment_id`;
- ИЛИ `orders_v2.provider_payment_id = p.provider_payment_id` AND `order_number LIKE 'REBILL-%'`.

Конфликт (REBILL-order существует, но `payments_v2.order_id` всё ещё указывает на parent) → `manual_review:already_materialized_conflict`.

### 1.6 Refund guard

Кандидат → `manual_review:refund_present` при любом из:

- `p.meta->>'refunded_amount'` > 0;
- ИЛИ существует payment-row с `meta->>'parent_payment_uid' = p.provider_payment_id` и refund-классификацией (через `isRefundTransactionType` / canonical `refunded`);
- ИЛИ существует payment-row с тем же `provider_payment_id` и refund tx_type.

Refunds в H5-refresh не чиним; уходят в backlog H5.2.

### 1.7 Прочие manual_review-причины

- `manual_review:sbs_unresolved` — recurring evidence есть, но `bepaid_subscription_id` нельзя извлечь ни из parent.meta, ни из `subscriptions_v2` linkage;
- `manual_review:pipeline_missing` — у parent.product_id есть воронка, но `crm_routing` для оффера отсутствует (Product → Pipeline Mapping Canon);
- `manual_review:other` — fallback с явным описанием в proof.

### 1.8 Spot-check платежа `489f08eb-2541-4bd3-9ad2-18e9aa99e45a`

Отдельный раздел в proof:

- если попал в green → подтверждаем критерии;
- если в manual_review → причина;
- если не попал ни туда, ни туда → `not_candidate_reason` с разбором (status / transaction_type / parent / materialized).

Ожидание: попадёт в кандидаты (parent `SUB-26-MMVMU7XAIA3D`, paid 2026-05-17, parent создан 2026-03-18 → split по месяцу).

### 1.9 Поля на каждого кандидата (CSV/таблица)

`email, user_id, profile_id, payment_id, provider_payment_id, parent_order_id, parent_order_number, payment_month, parent_order_month, amount, currency, paid_at_utc, product_id, product_name, tariff_id, tariff_offer_id, pipeline_id, pipeline_stage_id, sbs_source, sbs_resolved, sub_id, parent_meta_recurring, tariff_meta_recurring, tariff_installment, tariff_trial_auto, refund_check, already_materialized_check, expected_rebill_order_number = 'REBILL-' || left(payment_id::text, 12), recurring_evidence_source, guard_status`

`guard_status` ∈ {`green`, `skip_done`, `manual_review:refund_present`, `manual_review:sbs_unresolved`, `manual_review:pipeline_missing`, `manual_review:already_materialized_conflict`, `manual_review:other`}.

## Stage 2 — Frozen execute proposal (read-only артефакт)

Сводка по итогам Stage 1:

- `total_candidates`, `green_count`, `manual_review_count`, `skip_done_count`;
- `green_sum_amount`;
- разбивка green по `payment_month` (2026-01 … 2026-05);
- разбивка green по `product_id × tariff_id`;
- recommended batch strategy:
  - вариант A: по месяцам (2026-01 → 02 → 03 → 04 → 05);
  - вариант B: один batch, если объём ≤ N и риск приемлем;
  - default: помесячно, начиная с **2026-01**.

Delta vs H5.1a-R2 (frozen `h5_1a_r2_expanded_frozen_candidate_cohort_2026_05_green.csv`):

- что осталось зелёным;
- что уже materialized (`skip_done`);
- что добавилось после reflip (включая `489f08eb` и новые автосписания);
- что переехало в `manual_review` (с причинами).

Checksums baseline (snapshot, read-only) для последующего post-execute сравнения:

- `payments_v2`: count + sum(amount) по cohort 2026 succeeded bePaid + хеш по `(id, order_id, status, amount, paid_at)`;
- `orders_v2`: count `REBILL-%` + count не-REBILL paid 2026;
- `subscriptions_v2`: count active/paid + `sum(extract(epoch from access_end_at))`;
- `entitlements`: count + `sum(extract(epoch from expires_at))`.

## Артефакты

1. `.lovable/proofs/h5_refresh_historical_rebill_deal_linkage_discovery_2026_05.md` — proof:
  - snapshot meta + mode;
  - SQL / критерии discovery;
  - таблица всех кандидатов (или ссылка на CSV при > 50 строк);
  - таблица manual_review с причинами;
  - отдельный блок по `489f08eb`;
  - сравнение с H5.1a-R2 (delta-таблица);
  - checksums baseline;
  - verdict.
2. `.lovable/proofs/h5_refresh_frozen_candidates_2026_05.csv` — frozen CSV только green-строк по полям 1.9. Эта frozen CSV — единственный SOT для следующих execute-этапов H5.

## Verdict-критерии

- **GO execute (по batch)**: `green_count > 0`, checksums согласованы с прошлым snapshot (расхождения объяснены), no `already_materialized_conflict`, mode `on` подтверждён.
- **HOLD execute**: обнаружены конфликты materialized, mode факт ≠ `on`, или checksums orders_v2 уехали без объяснимой причины → разбираем blocker до approve.

## Approval gates

1. Approve этого плана → стартую Stage 1 discovery (read-only, DML=0).
2. После Stage 1+2 показываю summary + frozen CSV + verdict → ждём отдельный approve на execute-batch (скорее всего 2026-01 первым).

## Definition of Done (H5-refresh discovery)

- Proof MD создан со всеми обязательными разделами;
- Frozen CSV создан, содержит только green;
- Spot-check `489f08eb` явно разобран;
- Delta vs H5.1a-R2 явно показан;
- Checksums baseline зафиксированы;
- Никаких DML / migrations / provider calls.