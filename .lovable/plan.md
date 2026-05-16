# да, согласен, с учетом правок:

1. **Strict A должен быть единственным кандидатом на execute.**  
Cohort B/C — только контрольные/диагностические, не источник execute.
2. **Для** `already_materialized` **лучше разделить** `skip_done` **и** `manual_review`**.**

```text
skip_done:
- найден ровно один корректный REBILL-order;
- payment уже привязан правильно;
- данные не конфликтуют.

manual_review:
- найдено несколько REBILL;
- REBILL есть, но payment не там;
- user/product/tariff/amount/month конфликтуют.
```

3. `parent.deal_date` **может быть NULL.**  
Для `parent_deal_month` использовать:

```sql
COALESCE(parent.deal_date, parent.created_at)
```

4. `ROW_NUMBER()` **считать только по non-refund successful payments.**  
Refund-rows не должны влиять на `rn>1`.
5. **Refund guard должен проверять не только meta-ссылки, но и** `provider_payment_id`**/uid-следы.**  
Добавить поиск refund по:

```text
meta.parent_payment_uid = payment.provider_payment_id
meta.parent_uid = payment.provider_payment_id
meta.original_payment_uid = payment.provider_payment_id
```

Если структура отличается — указать фактические поля.

6. **SBS recursive JSON scan должен быть read-only и детерминированным.**  
Если технически сложно сделать полноценный recursive scan в SQL, допустимо ограничиться известными путями и пометить:

```text
sbs_source='NONE'
manual_review:sbs_unresolved
```

Не использовать слабую эвристику.

7. `payment.meta->>'source'` **и** `payment.meta->>'payment_flow'` **проверить фактически.**  
Если в данных используются другие ключи, отразить в proof и расширить признаки только после доказательства.
8. **CSV лучше разделить на 3 файла или явно добавить** `cohort_type`**.**  
Чтобы не смешать A/B/C:

```text
cohort_type = strict | id_first | broad
```

И execute frozen list = только:

```text
cohort_type='strict' AND guard_status='green'
```

9. **Scoped baselines считать только по green Strict A users, но также сохранить count affected payments.**  
В proof добавить:

```text
green_payment_count
green_user_count
green_parent_order_count
green_sum_amount
```

10. **Добавить проверку, что** `mode=on` **не создаст новые REBILL в момент между freeze и будущим execute.**  
В H5.1a только зафиксировать риск:

```text
Before H5.1b execute нужно re-check, что каждый green payment всё ещё не materialized runtime'ом.
```

11. **В Verdict добавить рекомендацию по batch strategy.**  
Если N большой, лучше split:

```text
single batch — если N <= 100 и guards clean;
split by month — если много майских;
split by tariff — если есть разные pipeline/stage риски.
```

12. **Команда на выполнение:**

```text
План H5.1a подтверждаю.

Выполни строго read-only:
- пересобери deterministic cohorts A/B/C;
- подтверди runtime REBILL format;
- собери frozen Strict A table;
- отдели green/manual_review/skip_done;
- зафиксируй scoped baselines;
- дай verdict, можно ли готовить H5.1b execute.

Запрещено:
- DML;
- migrations;
- provider API;
- edge function calls;
- изменение secrets/mode;
- любые правки orders/payments/refunds/accesses.

Proof:
.lovable/proofs/h5_1a_rebuilt_frozen_candidate_cohort_2026_05.md

CSV:
.lovable/proofs/h5_1a_rebuilt_frozen_candidate_cohort_2026_05.csv

Execute не запускать.
```

После отчёта H5.1a уже можно будет решить, запускаем H5.1b одним батчем или дробим.

&nbsp;

План: H5.1a — Rebuild Frozen Candidate Cohort

Цель: заново детерминированно собрать frozen candidate list для Historical REBILL Deal Linkage Repair 2026, потому что прежний H5 proof не содержит ни SQL, ни id-list, и не воспроизводит ровно 72 кандидата на текущем snapshot. Без надёжного frozen списка execute H5.1b запускать нельзя.

## 0. Жёсткие правила (read-only)

- DML = 0, migrations = 0, edge-function calls = 0, provider API = 0.
- Не трогаем: `orders_v2`, `payments_v2`, `refunds`, `entitlements`, `subscriptions_v2`, `access_rules`, `provider_subscriptions`, Telegram (`telegram_access_queue`, `telegram_grant_*`).
- `BEPAID_REBILL_MATERIALIZATION` не меняем (остаётся `on`).
- Никаких persistent temp objects; только session-temp / CTE.
- 0 unrelated fixes.

## 1. Исправления контракта (фиксируются до выборки)

### 1.1 REBILL order_number — runtime format

Фиксируется как:

```
REBILL-<first12(payments_v2.id::text)>
```

Подтверждено spot-check'ом в Stage 0 H5.1 (6/6 совпадений по `payments_v2.id`, 0/6 — по `provider_payment_id`).

### 1.2 SBS resolver (без `payments_v2.bepaid_subscription_id`)

Колонки нет — ступень убрана. Порядок:

1. `payment.meta->>'bepaid_subscription_id'` → `sbs_source='payment_meta.sbs'`;
2. `payment.meta->>'subscription_id'` → `sbs_source='payment_meta.subscription_id'`;
3. `payment.meta->>'sbs'` → `sbs_source='payment_meta.sbs_short'`;
4. `payment.meta#>>'{provider_response,transaction,subscription_id}'` → `sbs_source='provider_response.transaction'`;
5. `payment.meta#>>'{provider_response,subscription_id}'` → `sbs_source='provider_response.root'`;
6. `parent.bepaid_subscription_id` — **только если** оно not null И совпадает с любым sbs-значением, найденным внутри `payment.meta` целиком (recursive JSON scan) → `sbs_source='parent_match'`;
7. иначе → `manual_review:sbs_unresolved` (`sbs_source='NONE'`).

### 1.3 Refund guard (hard)

Любое из:

- `payment.refunded_amount IS NOT NULL AND payment.refunded_amount > 0`;
- existence refund-row в `payments_v2` с `meta->>'parent_payment_id' = payment.id` ИЛИ `meta->>'parent_payment_uid' = payment.provider_payment_id`;
- existence refund в `refunds` (если таблица есть) по `payment_id` / `payment_uid`

→ `manual_review:refund_present` → H5.2. Не попадает в green.

### 1.4 Already-materialized guard

Помечать как `manual_review:already_materialized` (или `skip_done`), если найдено хотя бы одно совпадение:

- `orders_v2.order_number = 'REBILL-' || substr(payment.id::text, 1, 12)`;
- `orders_v2.meta->>'materialized_from_payment_id' = payment.id::text`;
- `orders_v2.meta->>'materialized_from_payment_uid' = payment.provider_payment_id`;
- `orders_v2.provider = 'bepaid' AND orders_v2.provider_payment_id = payment.provider_payment_id` (unique index).

Если совпадение в **двух и более** ключах указывает на разные orders — `manual_review:duplicate_rebill_collision`.

## 2. Cohort definitions (3 варианта)

Все три варианта применяются на одном snapshot. База — `payments_v2` JOIN `orders_v2` по `payment.order_id = order.id`, с предварительной фильтрацией:

- `payment.provider = 'bepaid'`;
- `payment.paid_at` ∈ `[2026-01-01, 2027-01-01)`;
- `payment.amount > 0`;
- `payment.transaction_type` не refund И `payment.meta->>'type'` ≠ `'refund'`;
- `parent.order_number NOT LIKE 'REBILL-%'`;
- `parent.meta->>'source'` ∉ `{'h5_historical_repair','rebill_materialization','rebill_materialization_repair'}`.

Все три варианта дополнительно прогоняются через **already-materialized guard** (§1.4) до подсчёта.

### 2.A Strict cohort (преимущественный кандидат для frozen)

- **Recurring evidence** — хотя бы один признак:
  - `payment.meta->>'payment_flow' = 'bepaid_subscription_charge'`;
  - `payment.meta->>'source' IN ('subscription_rebill','bepaid_rebill','bepaid_subscription_charge')`;
  - `payment.meta->>'is_rebill' = 'true'`;
  - `payment.meta->>'parent_uid' IS NOT NULL`;
  - SBS resolver (§1.2) вернул не NONE.
- **Split signal** — `payment.meta` / `parent` сигналы говорят о rebill'е, разнесённом по месяцам:
  - `to_char(payment.paid_at AT TZ 'Europe/Minsk','YYYY-MM') <> to_char(parent.deal_date AT TZ 'Europe/Minsk','YYYY-MM')`
  - ИЛИ `ROW_NUMBER() OVER (PARTITION BY parent.id ORDER BY payment.paid_at) > 1`.
- Refund guard (§1.3) — clean.
- Already-materialized guard (§1.4) — нет совпадений.

### 2.B ID-first cohort (без эвристик)

- Required: SBS resolver §1.2 вернул не NONE **И** `payment.meta` явно содержит `payment_flow='bepaid_subscription_charge'` ИЛИ `source` ∈ set из §2.A.
- Без month-split / rn эвристик: split signal не требуется. Кандидатами становятся **все** recurring bepaid payments 2026, у которых есть формальные ID-маркеры и которые ещё не материализованы.

### 2.C Broad audit cohort (с risk flags)

- Любой `payment` с месяцем-разрывом ИЛИ `rn>1` per parent (как в Stage 0 reconstruction).
- Каждому кандидату присваивается набор `risk_flags`: `no_recurring_evidence`, `sbs_unresolved`, `refund_present`, `pipeline_missing`, `already_materialized`, `duplicate_collision`, `tariff_id_null`.
- Используется для контроля: проверить, не выпадают ли строки между strict и broad из-за слабой эвристики.

## 3. Метрики и сравнение

Для каждого варианта (A/B/C) выдать в proof:

- `total_candidates`;
- `distinct_users`, `distinct_parent_orders`, `distinct_tariffs`, `distinct_products`;
- `sum_amount` (BYN);
- `months_distribution` (`YYYY-MM` → count, sum);
- `manual_review_reasons` breakdown (refund_present / sbs_unresolved / already_materialized / pipeline_missing / duplicate_collision / other);
- `green_count`.

Сравнение:

- `A ∩ B`, `A \ B`, `B \ A`;
- `A ∩ C`, `A \ C`, `C \ A`;
- комментарий на каждую заметную дельту (особенно — почему candidate из C не попал в A).

## 4. Frozen table (только Strict A green)

Артефакты:

- `.lovable/proofs/h5_1a_rebuilt_frozen_candidate_cohort_2026_05.md` (описание + summary + сравнения + spot-checks + verdict);
- `.lovable/proofs/h5_1a_rebuilt_frozen_candidate_cohort_2026_05.csv` (per-candidate строки).

Колонки CSV (одна строка на candidate payment Strict A):

```
payment_id
provider_payment_id
parent_order_id
parent_order_number
user_id
profile_id
product_id
tariff_id
amount
currency
paid_at (UTC ISO8601)
deal_month (Europe/Minsk YYYY-MM)
parent_deal_month
sbs_source
bepaid_subscription_id_resolved
pipeline_id
pipeline_stage_id
offer_id
expected_rebill_order_number   = REBILL-<first12(payment_id)>
refund_check                   = clean | parent_refunded | refund_row_found
already_materialized_check     = none | order_number_match | meta_payment_id_match | meta_payment_uid_match | provider_payment_id_match | multi_match
guard_status                   = green | manual_review:<reason>
recurring_evidence             = строка с активными признаками (payment_flow / source / is_rebill / parent_uid / sbs_resolved)
```

Включаем в CSV **все** Strict A кандидаты (green + manual_review) для прозрачности; frozen для execute = только `guard_status='green'`.

Для cohorts B и C — отдельные CSV-секции (или приложения) с теми же колонками + `risk_flags`.

## 5. Scoped baselines (для будущего execute / verify)

После заморозки green-листа, в том же proof фиксируем scoped checksums (read-only) **по users из green Strict A**:

- `payments_v2`:
  - `count`, `md5 stable` (без `order_id`, `updated_at`);
  - md5 полный (включая `order_id`, `updated_at`).
- `orders_v2`:
  - count, md5 (без будущих H5 rows — это автоматически, так как сейчас их нет).
- `subscriptions_v2`: rows, Σ epoch(access_end_at), null.
- `entitlements`: rows, Σ epoch(expires_at), null.
- `telegram_access_queue`: count по этим users + max(updated_at).
- `provider_subscriptions`: count по этим users + max(updated_at).

Эти baselines + green-листы будут source-of-truth для H5.1b execute (re-verify внутри transaction).

## 6. Spot-checks (read-only)

В proof добавить spot-check по 6 кейсам, выбранным детерминированно:

- 1 candidate из 2026-03 (если есть);
- 1 candidate из 2026-04;
- 2 candidate из 2026-05;
- 1 кейс `manual_review:refund_present`;
- 1 кейс `manual_review:sbs_unresolved`.

Для каждого — `payment_id`, `parent_order_id`, выбранный `sbs_source`, причина guard_status.

## 7. Verdict секция (обязательная)

В конце proof:

```
execute_ready_count          = N (green Strict A)
manual_review_count          = M
skipped_already_materialized = K
strict_vs_idfirst_delta      = |A \ B|, |B \ A|
strict_vs_broad_delta        = |C \ A| with reasons summary
recommended_batch_strategy   = single batch | split by month | split by tariff
can_run_h5_1b_execute        = YES (если N>0 и нет critical risks) | NO (с указанием причин)
```

Также рекомендация по дальнейшим планам:

- H5.1b — execute frozen green;
- H5.2 — orphan refunds + refund_present candidates;
- H5.3 (если нужно) — sbs_unresolved.

## 8. Что НЕ делаем в H5.1a

- Никакого DML.
- Не строим rollback SQL (это для H5.1b).
- Не запускаем `grant-access-for-order`.
- Не трогаем G25 / Alesya Khomich / Рабчевская Юлия / INV-22 phantom past_due / legacy ребиллы до 2026.
- Не пытаемся «доказать ровно 72». H5 proof признаётся как summary, но не как авторитативный список; новый frozen строится с нуля.

## 9. Deliverable

- `.lovable/proofs/h5_1a_rebuilt_frozen_candidate_cohort_2026_05.md` — полный отчёт со SQL всех трёх вариантов (inline-блоками), summary, сравнениями, spot-checks, scoped baselines, verdict.
- `.lovable/proofs/h5_1a_rebuilt_frozen_candidate_cohort_2026_05.csv` — frozen list Strict A + опционально B/C приложениями.

## 10. Следующий шаг после H5.1a

После approve этого плана и публикации proof:

- если verdict = YES — отдельным заходом готовится **H5.1b** (execute план на основании зафиксированного green list, scoped baselines, runtime REBILL format, корректного SBS resolver);
- если verdict = NO — фиксируются открытые риски и переход в H5.2/H5.3 либо в backlog.

**Approve на execute (H5.1b) — только отдельным сообщением после публикации frozen cohort.**
---

# Отчет о выполнении: H5.1a-R2 — Expanded Frozen Cohort (parent subscription + Product Type SOT)

**Snapshot:** 2026-05-16. Read-only. DML=0, migrations=0, edge calls=0, provider API=0, secrets/mode не трогали.

## Контракт R2
Recurring evidence без echo-проверки: `parent.bepaid_subscription_id` ИЛИ `parent.meta` (subscription/rebill/payment_flow markers) ИЛИ `subscriptions_v2.link` (order_id / initial_order_id / checkout_order_id / extended_by_orders) ИЛИ Product Type SOT (`tariff_offers.meta.recurring.is_recurring=true` ИЛИ `is_installment` ИЛИ `auto_charge_after_trial`).

SBS resolver R2: payment.meta пути → `parent.bepaid_subscription_id` (без echo) → NONE.

`expected_rebill_order_number = 'REBILL-' || first12(payments_v2.id::text)`.

## Результаты

| метрика | значение |
|---|---|
| Base bepaid 2026 | 934 / 206 users / 762 parents / Σ 201 981 BYN |
| **R2 green** | **167 / 91 users / 117 parents / 4 products / 6 tariffs / Σ 37 192 BYN** |
| manual_review:sbs_unresolved | 10 / Σ 1 134 BYN |
| manual_review:pipeline_missing | 1 / Σ 345 BYN |
| skip_no_split | 756 |
| refund_present / already_materialized / tariff_id_null / not_recurring_product | 0 |

R2 GREEN по месяцам: 2026-01: 12, 2026-02: 3, 2026-03: 25, 2026-04: 51, 2026-05: 76.

## Сравнение когорт

| set | n |
|---|---|
| Strict A green | 4 |
| R2 green | 167 |
| Broad C candidate | 178 |
| R2 ∩ C | 167 |
| Strict A \ R2 | 0 (Strict A полностью внутри R2) |
| C \ R2 | 11 (10 sbs_unresolved + 1 pipeline_missing — без recurring-доказательств) |

## Источники evidence (167 green, multi-source ok)
- `parent.bepaid_subscription_id`: **0** (колонка глобально почти пуста — 2/3375 orders с 2025).
- `parent.meta` subscription markers: 161
- `subscriptions_v2.link`: 148
- `tariff_offer.meta.recurring`: 162
- `tariff_offer.auto_charge_after_trial`: 123
- `sbs_source != NONE` (payment.meta path): 4

## Scoped baselines (91 R2-green user)
- payments_v2: 1 998 rows / md5_stable `b1636582eb56c8c02211bea25f5a0d0a`
- orders_v2: 1 802 rows / md5_ids `ba70618941f94d8ec26ef68175562f6d`
- subscriptions_v2: 620 rows / Σepoch 1 055 372 396 047
- entitlements: 554 rows / Σepoch 986 868 153 034
- global REBILL-%: 201 rows / md5 `f4b7f8055f48b17ab34ba383128622d6`

**Mode check:** `system_settings` table отсутствует — режим в env (`BEPAID_REBILL_MATERIALIZATION=on` по слову пользователя). Перед H5.1b execute обязательна ручная сверка значения переменной.

## Артефакты
- `.lovable/proofs/h5_1a_r2_expanded_frozen_candidate_cohort_2026_05.md`
- `.lovable/proofs/h5_1a_r2_expanded_frozen_candidate_cohort_2026_05.csv` (934 rows со статусом)
- `.lovable/proofs/h5_1a_r2_expanded_frozen_candidate_cohort_2026_05_green.csv` (167 frozen GREEN)
- `.lovable/proofs/h5_1a_r2_expanded_frozen_candidate_cohort_2026_05.sql`

## Verdict
```
execute_ready_count          = 167
manual_review_count          = 11
skip_done_count              = 0
sum_amount                   = 37 192 BYN
months                       = 01:12 / 02:3 / 03:25 / 04:51 / 05:76
recommended_batch_strategy   = split by month (5 batches; меньший blast radius при mode-race с runtime)
                               ALT: split by tariff (2 крупных тарифа = 137/167, 4 хвоста)
can_run_h5_1b_execute        = WAITING_APPROVE — execute не запускать
```

Execute не запускать. Перед H5.1b approve пользователь должен подтвердить: (а) принять R2 frozen list 167, либо (б) ужесточить контракт (требовать пересечение `subscriptions_v2.link AND tariff_offer.meta.recurring`).
