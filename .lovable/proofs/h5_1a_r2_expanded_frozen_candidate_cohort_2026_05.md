# H5.1a-R2 — Expanded Frozen Cohort using Parent Subscription + Product Type SOT

**Snapshot:** 2026-05-16 / Минск 2026-05-17. **Read-only. DML=0, migrations=0, edge calls=0, provider API=0, secrets unchanged. `BEPAID_REBILL_MATERIALIZATION` не трогали.**

Полный SQL — `.lovable/proofs/h5_1a_r2_expanded_frozen_candidate_cohort_2026_05.sql`.

---

## 1. Контракт R2 (изменения относительно Strict A)

R2 признаёт recurring-связь без обязательного echo на уровне `payment.meta`. Источниками доказательства считаются:

1. **`parent.bepaid_subscription_id IS NOT NULL`** (без echo-проверки).
2. **`parent.meta` recurring markers** — содержит `subscription` / `rebill` / `payment_flow` (case-insensitive ILIKE по тексту JSON).
3. **`subscriptions_v2` linkage** — есть подписка, где
   - `s.order_id = parent.id`
   - ИЛИ `s.meta->>'initial_order_id' = parent.id`
   - ИЛИ `s.meta->>'checkout_order_id' = parent.id`
   - ИЛИ `parent.id ∈ s.meta->'extended_by_orders'`.
4. **Product Type SOT (tariff_offers)** — у тарифа parent.tariff_id есть хотя бы один tariff_offer с recurring-признаком:
   - `meta->'recurring'->>'is_recurring' = true`
   - ИЛИ `is_installment = true`
   - ИЛИ `requires_card_tokenization = true`
   - ИЛИ `auto_charge_after_trial = true`.

Гард-логика R2 (по порядку проверок):

```
1. NOT split_signal                                  → skip_no_split
2. refund_check != clean                             → manual_review:refund_present
3. distinct_match_count > 1                          → manual_review:already_materialized_conflict
4. already_matched (and not yet linked)              → manual_review:already_materialized_conflict
5. already_matched AND linked_to_rebill              → skip_done
6. pipeline_id IS NULL or stage_id IS NULL           → manual_review:pipeline_missing
7. tariff_id IS NULL                                 → manual_review:tariff_id_null
8. sbs_source='NONE' AND no parent_recurring_evid    → manual_review:sbs_unresolved
9. NOT parent_recurring_evidence                     → manual_review:no_parent_recurring_evidence
10. NOT product_sot_recurring (tariff не recurring)  → manual_review:not_recurring_product
11. otherwise                                        → green
```

`expected_rebill_order_number = 'REBILL-' || first12(payments_v2.id::text)` (runtime-формат, подтверждён в H5.1 Stage 0).

SBS resolver R2: `payment.meta.bepaid_subscription_id → payment.meta.subscription_id → payment.meta.sbs → provider_response.transaction.subscription_id → provider_response.subscription_id → parent.bepaid_subscription_id → NONE`. Парент-уровень принимается напрямую (без echo).

---

## 2. Base + R2 cohort

Base = bePaid 2026 payments, amount>0, non-refund, parent order ≠ REBILL, parent не source-of-repair:

| Метрика | Значение |
|---|---|
| rows | 934 |
| distinct users | 206 |
| distinct parent orders | 762 |
| Σ amount | 201 981.00 BYN |

R2 guard_status:

| status | n | sum BYN |
|---|---|---|
| `skip_no_split` | 756 | 163 310.00 |
| **`green`** | **167** | **37 192.00** |
| `manual_review:sbs_unresolved` | 10 | 1 134.00 |
| `manual_review:pipeline_missing` | 1 | 345.00 |

`manual_review:refund_present` = 0 · `manual_review:already_materialized_conflict` = 0 · `skip_done` = 0 · `manual_review:tariff_id_null` = 0 · `manual_review:no_parent_recurring_evidence` = 0 · `manual_review:not_recurring_product` = 0.

---

## 3. R2 GREEN — распределение

**По месяцам:**

| pay_month | n | sum BYN |
|---|---|---|
| 2026-01 | 12 | 1 581.00 |
| 2026-02 | 3 | 201.00 |
| 2026-03 | 25 | 6 195.00 |
| 2026-04 | 51 | 11 925.00 |
| 2026-05 | 76 | 17 290.00 |

**По продукту / тарифу:**

| product_id | tariff_id | n | sum BYN |
|---|---|---|---|
| `11c9f1b8-…3616` | `7c748940-…22d3` | 98 | 23 578.00 |
| `85046734-…bc2b` | `c5981337-…ac13e` | 39 | 9 580.00 |
| `11c9f1b8-…3616` | `31f75673-…cbf84` | 14 | 958.00 |
| `11c9f1b8-…3616` | `b276d8a5-…22d6c` | 11 | 1 501.00 |
| `de36a695-…eabc` | `0fb3db55-…ab01a` | 4 | 1 245.00 |
| `73c29914-…8696` | `56c35e86-…b5f7b` | 1 | 330.00 |

Distinct: users=91, parents=117, products=4, tariffs=6.

**Источники доказательств (multi-source допустим):**

| источник | n из 167 |
|---|---|
| `parent.bepaid_subscription_id` | **0** |
| `parent.meta.subscription_markers` | 161 |
| `subscriptions_v2.link` (s.order_id / initial / checkout / extended_by) | 148 |
| `tariff_offer.meta.recurring` | 162 |
| `tariff_offer.is_installment` | 0 |
| `tariff_offer.auto_charge_after_trial` | 123 |
| `sbs_source != NONE` (любой SBS уровень) | 4 |

**Важное наблюдение:** колонка `orders_v2.bepaid_subscription_id` в принципе пуста — глобально 2/3 375 orders с 2025 года имеют непустое значение. Реальные signals — `parent.meta` + `subscriptions_v2.link` + `tariff_offer.meta.recurring`.

---

## 4. Сравнение Strict A vs R2 vs Broad C

| set | n |
|---|---|
| Strict A green (по приближённой реконструкции — SBS только из payment.meta) | 4 |
| **R2 green** | **167** |
| Broad C candidate (любой split signal, без других гардов) | 178 |
| `R2 ∩ C` | 167 (R2 полностью внутри C) |
| `C \ R2` | 11 |
| `R2 \ C` | 0 |
| `Strict A \ R2` | 0 (все strict-green попали в R2) |

**Объяснение `C \ R2` (11 строк):**

| причина (guard_status R2) | n |
|---|---|
| `manual_review:sbs_unresolved` | 10 |
| `manual_review:pipeline_missing` | 1 |

10 split-payments не имеют ни одного recurring-доказательства (нет parent.meta marker, нет subscriptions_v2.link, нет recurring tariff_offer), и SBS не резолвится. Это либо one-time платежи, которые формально «двусегментны» в parent order (rn>1) по нестандартной причине, либо это первые платежи где split не подразумевает rebill. **Не включаются в R2 по соображениям защиты от лишних REBILL-orders.**

1 строка отсеяна по `pipeline_missing` — отсутствует pipeline/stage, без них grant-access-for-order не сможет корректно создать REBILL-deal.

---

## 5. Scoped baselines (по 91 R2-green user) — для будущего H5.1b

| Object | Метрика | Значение |
|---|---|---|
| `payments_v2` (scoped) | rows | 1 998 |
| `payments_v2` (scoped) | md5 stable (id\|amount\|provider_payment_id\|transaction_type) | `b1636582eb56c8c02211bea25f5a0d0a` |
| `orders_v2` (scoped) | rows | 1 802 |
| `orders_v2` (scoped) | md5 ids | `ba70618941f94d8ec26ef68175562f6d` |
| `subscriptions_v2` (scoped) | rows / Σepoch | 620 / 1 055 372 396 047 |
| `entitlements` (scoped) | rows / Σepoch | 554 / 986 868 153 034 |

**Global REBILL baseline:**

| Метрика | Значение |
|---|---|
| `orders_v2` где `order_number LIKE 'REBILL-%'` rows | 201 |
| md5(ids) | `f4b7f8055f48b17ab34ba383128622d6` |

**Mode check:** таблица `system_settings` отсутствует — режим управляется через env (BEPAID_REBILL_MATERIALIZATION). Перед execute обязательна ручная сверка значения переменной (пользователь сообщал `=on`).

---

## 6. Артефакты

- `.lovable/proofs/h5_1a_r2_expanded_frozen_candidate_cohort_2026_05.md` — этот файл.
- `.lovable/proofs/h5_1a_r2_expanded_frozen_candidate_cohort_2026_05.csv` — **все 934 строки R2** (`guard_status` per row).
- `.lovable/proofs/h5_1a_r2_expanded_frozen_candidate_cohort_2026_05_green.csv` — **167 GREEN** (frozen execute list).
- `.lovable/proofs/h5_1a_r2_expanded_frozen_candidate_cohort_2026_05.sql` — полный SQL.

CSV колонки: `email, payment_id, provider_payment_id, parent_order_id, parent_order_number, payment_month, parent_order_month, amount, currency, paid_at, product_id, tariff_id, pipeline_id, pipeline_stage_id, offer_id, sbs_source, sbs_resolved, sub_id, parent_meta_recurring, tariff_meta_recurring, tariff_installment, tariff_trial_auto, refund_check, already_materialized_check, expected_rebill_order_number, recurring_evidence_source` (+`guard_status` в *_all*).

---

## 7. Verdict

```
execute_ready_count          = 167   (R2 green, 91 users, 117 parents, 4 products, 6 tariffs)
manual_review_count          = 11    (10 sbs_unresolved + 1 pipeline_missing)
skip_done_count              = 0
sum_amount                   = 37 192.00 BYN
months_distribution          = 2026-01: 12 / 2026-02: 3 / 2026-03: 25 / 2026-04: 51 / 2026-05: 76
strict_A_inside_R2           = 4/4 (Strict A полностью покрыт R2)
broad_C_outside_R2           = 11 (объяснены: sbs_unresolved+pipeline_missing)
recommended_execute_strategy = split by month (январь→февраль→март→апрель→май), внутри каждого месяца можно идти одним batch
                               ALT: split by tariff (2 крупных tariff'а = 137/167, остальные 4 хвоста по 30)
                               причина: меньший batch = меньший blast radius при mode-race с runtime
```

**Mode-race risk:** `BEPAID_REBILL_MATERIALIZATION=on` — execute должен внутри транзакции повторить already-materialized guard перед каждым INSERT, чтобы не создать дубликат REBILL-order, если runtime успел материализовать платёж между frozen snapshot и execute. Это уже заложено в скоупе H5.1b.

---

## 8. Execute НЕ запускать

H5.1b execute требует отдельного approve пользователя. Текущий артефакт — read-only frozen cohort. DML = 0.

Перед approve ожидается решение:
- принять R2 frozen list (167) и идти в H5.1b execute, либо
- ещё ужесточить контракт (например, требовать одновременно `subscriptions_v2.link AND tariff_offer.meta.recurring` — тогда уйдёт ~14 строк, останется ~143; точная цифра по запросу).
