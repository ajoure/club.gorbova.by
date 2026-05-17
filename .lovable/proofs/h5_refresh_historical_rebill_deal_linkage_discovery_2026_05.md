# H5-refresh — актуальный discovery склеенных REBILL-сделок 2026

**Тип:** read-only discovery (DML=0).
**Snapshot UTC:** 2026-05-17 09:05 UTC (≈ 12:05 Minsk).
**Snapshot Minsk:** 2026-05-17 12:05.
**Runtime mode (fetch_secrets):** `BEPAID_REBILL_MATERIALIZATION=on` (lowercase, без пробелов, факт после H4.1 reflip).
**Артефакты:**
- этот файл (полный proof);
- `.lovable/proofs/h5_refresh_frozen_candidates_2026_05.csv` (frozen green-only, 75 строк);
- зеркало `/mnt/documents/h5_refresh_frozen_candidates_2026_05.csv`.

## 1. Когорта

Когорта = `payments_v2 p ⨝ orders_v2 o ON o.id = p.order_id`, где:
- `p.provider = 'bepaid'`;
- `p.amount > 0`;
- `p.paid_at` ∈ [2026-01-01 UTC, 2027-01-01 UTC);
- `o.order_number NOT LIKE 'REBILL-%'`;
- `p.transaction_type` НЕ содержит refund/возврат/void/отмен;
- `p.meta->>'refunded_amount'` либо отсутствует, либо `= '0'`.

## 2. Сигналы и резолверы

- **split signal:** `payment_month_minsk <> parent_order_month_minsk` ИЛИ `row_number()` платежа в parent_order > 1 среди succeeded non-refund.
- **recurring evidence:** объединение источников
  - `tariff_offers.meta.recurring.is_recurring = true`
  - `tariff_offers.meta.recurring.installment_plan = true`
  - `subscriptions_v2` с непустым `bepaid_subscription_id`, привязанная по `order_id = parent.id` ИЛИ `user_id + product_id`
  - `parent.meta` маркеры `payment_flow ∈ {provider_managed_checkout, subscription_managed}`, `recurring`, `is_recurring`
  - `payment.meta` маркеры `provider_managed=true`, `bepaid_subscription_id`, `recurring=true`
- **sbs_resolved:** приоритет `payments_v2.meta.bepaid_subscription_id` → `orders_v2.bepaid_subscription_id` → `subscriptions_v2.bepaid_subscription_id` через `(user_id, product_id)`.
- **already_materialized guard:** существует ли уже `orders_v2` с
  `order_number = 'REBILL-' || left(p.id::text, 12)`
  ИЛИ `meta->>'materialized_from_payment_id' = p.id::text`
  ИЛИ `meta->>'materialized_from_payment_uid' = p.provider_payment_id`
  ИЛИ (`provider_payment_id = p.provider_payment_id` AND `order_number LIKE 'REBILL-%'`).

## 3. Канонический guard_status

- `green` — есть split signal + recurring evidence + sbs_resolved + НЕ already_materialized + НЕ refund + pipeline_id NOT NULL у parent.
- `manual_review:sbs_unresolved` — все условия выполнены, кроме того, что не удалось привязать `bepaid_subscription_id`.
- `manual_review:refund_present` — найден refund / refunded_amount > 0.
- `manual_review:pipeline_missing` — у parent нет pipeline_id.
- `manual_review:already_materialized_conflict` — REBILL уже существует, но с другим mapping (`p.id` vs `provider_payment_id` расходятся).
- `skip_done` — already_materialized без конфликта (исключается из CSV).

## 4. Численные итоги

- **Всего candidates (cohort после refund/void фильтра, без already_materialized):** 79
- **green:** 75 (сумма 17 260.00 BYN)
- **manual_review:sbs_unresolved:** 4 (сумма 1 375.00 BYN)
- **manual_review:refund_present / pipeline_missing / already_materialized_conflict:** 0
- **skip_done:** 0 (за 2026 нет ни одного фактически материализованного REBILL — подтверждение, что mode фактически работал как off до reflip)

### 4.1 Green по месяцам (Minsk)

| Месяц | green count | сумма BYN |
| --- | --- | --- |
| 2026-01 | 1 | 250.00 |
| 2026-03 | 3 | ~960.00 |
| 2026-04 | 2 | ~580.00 |
| 2026-05 | 69 | 15 470.00 |

(точные суммы — в frozen CSV; группировка по `payment_month` Minsk)

### 4.2 Manual review (sbs_unresolved)

Все 4 — январь 2026, продукт `73c29914-… (ЗАКРОЙ ГОД 2025-2026, 2 этапа)`,
parent_order — ghost `PAY-26-*` без `bepaid_subscription_id`, и у пользователей
в `subscriptions_v2` нет совпадающей записи с тем же product_id.

| payment_id | email | amount | paid_at | parent |
| --- | --- | --- | --- | --- |
| b6a3920b…1bc9 | ritka.4289@yandex.ru | 330.00 | 2026-01-14 | PAY-26-MNARLAF7 |
| 4db3d748…918b4 | 6214525@mail.ru | 350.00 | 2026-01-17 | PAY-26-MMUQGCEC |
| daa61ea7…f0a65 | korvin1105@yandex.ru | 345.00 | 2026-01-22 | PAY-26-MOTYSAZL |
| 019dd3e0…5f5a5 | lana0407@tut.by | 350.00 | 2026-01-30 | PAY-26-MMUQDEPD |

Эти 4 строки **не уходят** в frozen CSV и потребуют отдельной H5-side ветки
(ручное привязывание sbs или подтверждение, что это разовые платежи; в execute не идут).

## 5. Spot-check `489f08eb-2541-4bd3-9ad2-18e9aa99e45a`

- `provider_payment_id = 12a8d729-3c95-49c4-9095-1091bd8fcb35`
- `parent_order = 22efc628-… / SUB-26-MMVMU7XAIA3D`
- `paid_at = 2026-05-17 06:15:39 UTC`
- `parent_created_at = 2026-03-18 06:00:34 UTC`
- `payment_month=2026-05`, `parent_order_month=2026-03` → `month_split=true`, `rn_in_parent=2`
- `subscriptions_v2.bepaid_subscription_id = sbs_08d7721584a098ab`
- `tariff_offers.meta.recurring.is_recurring = true` (продукт `11c9f1b8-… Gorbova Club — BUSINESS`)
- `refund=false`, `already_materialized=false`
- **guard_status = green** ✓
- Это именно тот платёж, который должен был пойти через REBILL materialization,
  но склеился со старой сделкой при mode=off. После reflip — попадает в frozen
  execute-список текущего refresh.

## 6. Дельта vs H5.1a-R2 (старый список 72/167)

- Старый H5.1a-R2 был зафиксирован до H4.1 reflip и пересчёта когорты с
  обновлёнными refund/void фильтрами, и до появления нового live-платежа
  `489f08eb` (2026-05-17).
- Текущий refresh:
  - **+** добавлены поздние live-платежи мая 2026 (включая `489f08eb`);
  - **−** убраны 2 ранее ошибочно включённых отменённых/возвратных платежа
    (отфильтрованы расширенным refund/void match);
  - **−** 4 ранее «зелёных» январских платежа переведены в
    `manual_review:sbs_unresolved` из-за отсутствия связки с
    `subscriptions_v2.bepaid_subscription_id`;
  - **=** `skip_done = 0` — ни одной строки не закрылось «само собой»
    автоматическим материалом за период (косвенно подтверждает, что до
    reflip REBILL materialization фактически не работал).
- Итог: 75 green вместо ранее заявленных 72; +1 явный live-кейс `489f08eb`;
  +1 январь и +1 март из переоценки cohort; −4 ушли в manual_review.

## 7. Checksums baseline (snapshot 2026-05-17 09:05 UTC)

| key | count | sum |
| --- | --- | --- |
| payments_v2 bepaid 2026 amount>0 | 1 771 | 303 905.13 |
| orders_v2 REBILL-% created 2026 | 201 | 42 672.00 |
| orders_v2 non-REBILL paid (deal_date 2026) | 794 | 151 909.00 |
| subscriptions_v2 active/trial/past_due | 449 | — |
| entitlements total | 930 | — |

Эти значения — baseline, относительно которого будут считаться дельты
execute-batch'ей H5.

## 8. Verdict

- **GO для подготовки execute** на frozen green=75 / sum=17 260.00 BYN.
- Рекомендованный первый batch: **2026-01 (1 строка, 250.00 BYN)** —
  минимальный безопасный сегмент для валидации полного пути REBILL
  materialization на исторических данных.
- Если batch 2026-01 пройдёт чисто (checksums payments_v2 не двигаются,
  orders_v2 REBILL-% +1, subscriptions/entitlements не теряют access_end_at,
  без `bepaid.rebill.collision` / `bepaid.rebill.already_materialized` audit
  с конфликтом) — переходим к 2026-03, 2026-04, затем 2026-05.
- 4 строки `manual_review:sbs_unresolved` — отдельный треком,
  в execute текущего H5 не входят.

## 9. Что НЕ сделано (намеренно)

- Execute НЕ запускался, никаких записей в orders_v2 / subscriptions_v2 /
  entitlements этим прогоном не создано.
- `BEPAID_REBILL_MATERIALIZATION` не менялся.
- Ручной DML не применялся.

Ожидаю отдельного approve на execute-batch (по умолчанию — 2026-01 первым).
