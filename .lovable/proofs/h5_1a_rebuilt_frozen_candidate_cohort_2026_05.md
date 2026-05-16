# H5.1a — Rebuild Frozen Candidate Cohort 2026-05

**Snapshot:** 2026-05-16 / Минск 2026-05-17. Read-only. DML=0, migrations=0, edge calls=0, provider API=0, secrets unchanged. `BEPAID_REBILL_MATERIALIZATION=on` (не трогали).

Полный SQL — `/tmp/h51a/cohorts.sql` (см. ниже §10 inline-извлечение).

---

## 1. Contract fixes (применены к выборке)

- **REBILL order_number** = `REBILL-<first12(payments_v2.id::text)>`. Подтверждено spot-check'ом 6/6 в H5.1 Stage 0.
- **`payments_v2.bepaid_subscription_id`** колонки нет — ступень убрана. SBS resolver: `payment.meta.bepaid_subscription_id` → `payment.meta.subscription_id` → `payment.meta.sbs` → `provider_response.transaction.subscription_id` → `provider_response.subscription_id` → `parent.bepaid_subscription_id` only if echoed inside payment.meta::text → `NONE` (`manual_review:sbs_unresolved`).
- **`parent.deal_date` NULL guard** — `parent_month = COALESCE(deal_date, created_at) AT TZ 'Europe/Minsk'`.
- **`ROW_NUMBER()`** — считается только по non-refund successful payments per parent_order (refund-rows исключены ещё в `base` через `transaction_type NOT ILIKE '%refund%'` + `meta.type<>'refund'`).
- **Refund guard** — `refunded_amount > 0` OR refund-row через `meta.parent_payment_id` / `meta.parent_payment_uid` / `meta.parent_uid` / `meta.original_payment_uid`. Таблицы `refunds` в схеме нет (проверено `information_schema.tables`); refund-rows = `payments_v2 WHERE amount<0 OR transaction_type ILIKE '%refund%' OR meta.type='refund'`.
- **Already-materialized guard** — 4 ключа: `order_number = 'REBILL-' || first12(payment.id)`, `meta.materialized_from_payment_id`, `meta.materialized_from_payment_uid`, `(provider='bepaid', provider_payment_id)`. Если distinct order_id > 1 → `manual_review:duplicate_rebill_collision`. Если совпадение есть И payment уже linked к REBILL-order → `skip_done`. Иначе → `manual_review:already_materialized`.

---

## 2. Discovery findings (важно)

Проверено фактическое содержимое `payment.meta` для всех 1770 bepaid 2026 payments:

| Ключ | Заполнено | Замечание |
|---|---|---|
| `payment_flow` | **0 / 1770** | runtime НЕ пишет — план v2 ошибочно опирался на него |
| `is_rebill` | **0 / 1770** | то же |
| `type` | **0 / 1770** | то же |
| `parent_uid` | **0 / 1770** | то же |
| `source` | 42 / 1770 | значения: `link_payment_webhook` (37), `uid_resync` (2), `link_order_subscription_webhook` (2), `saved_card_public_pay` (1) |
| `bepaid_subscription_id` | **8 / 1770** глобально, **6 в non-REBILL** | единственный ID-first маркер на уровне payment |
| `provider_response.*` | 0 / 1770 | runtime не сохраняет response целиком |
| `parent.bepaid_subscription_id` | many | основной канал привязки к подписке |

**Вывод:** ID-first маркер `bepaid_subscription_id` есть только у 6/934 candidate-payments. На уровне `parent.bepaid_subscription_id` он есть у большинства subscription-orders, но runtime НЕ дублирует его в payment.meta. SBS resolver в его текущем виде (включая «parent only if echoed in payment.meta») для большинства даёт `NONE`.

`refunds` table — отсутствует. Refund-rows в 2026 base = **0** (`amount<0`/`type=refund`/`transaction_type refund` = 0 строк). Refund-следы в meta встречаются единично (`parent_payment_id`=1, `parent_payment_uid`=1).

---

## 3. Base + Cohort counts

**Base (recurring-eligible bepaid 2026 payments в non-REBILL non-source orders):**

| Метрика | Значение |
|---|---|
| rows | 934 |
| distinct users | 206 |
| distinct parent orders | 762 |
| Σ amount | 201 981.00 BYN |

### 3.A Strict A — guard_status

| status | n | sum BYN |
|---|---|---|
| `manual_review:sbs_unresolved` | 915 | 197 006.00 |
| `manual_review:pipeline_missing` | 11 | 2 845.00 |
| **`green`** | **4** | **805.00** |
| `manual_review:tariff_id_null` | 2 | 825.00 |
| `manual_review:no_split_signal` | 2 | 500.00 |

`skip_done` = 0, `manual_review:refund_present` = 0, `manual_review:already_materialized` = 0, `manual_review:duplicate_rebill_collision` = 0, `manual_review:no_recurring_evidence` = 0.

### 3.B ID-first B — guard_status

| status | n | sum BYN |
|---|---|---|
| `manual_review:no_id_first_marker` | 915 | 197 006.00 |
| `manual_review:pipeline_missing` | 11 | 2 845.00 |
| **`green`** | **6** | **1 305.00** |
| `manual_review:tariff_id_null` | 2 | 825.00 |

### 3.C Broad C — broad_status

| status | n |
|---|---|
| `skip_no_split` | 756 |
| `candidate` | 178 |

Risk-flag распределение (per candidate, multi-flag допустим):

| flag | count |
|---|---|
| `no_recurring_evidence` | 174 |
| `sbs_unresolved` | 174 |
| `pipeline_missing` | 1 |

---

## 4. Strict A green — детали

- Все 4 green попали в `2026-05`.
- `sbs_source`: 100% `payment_meta.bepaid_subscription_id` (4/4).
- Distinct users: 4, distinct parents: 4, distinct tariffs: 2, distinct products: 1.
- Σ amount = 805.00 BYN.

Per-row spot-check (2026-05 первые 2):

| payment_id | parent_order_id | sbs_source | refund_check | already_mat |
|---|---|---|---|---|
| `14d419cb-e1ea-4756-ad9c-5996779a0795` | `68e2c243-8950-491e-b6d2-bdefd1e8d506` | payment_meta.bepaid_subscription_id | clean | none |
| `731b5d67-0339-4c0f-9b8b-00c9698ea628` | `2145b072-f2eb-490c-8b0f-955cd2a868a8` | payment_meta.bepaid_subscription_id | clean | none |

2026-03 / 2026-04 green: **0 строк**.

`manual_review:sbs_unresolved` пример: payment `00cc3f9a-fa08-435f-b077-6fcd6715acf4`, parent `e0f24e2f-…`. У parent есть `bepaid_subscription_id`, но payment.meta его не echo-ит — по строгому контракту резолвер кладёт NONE.

`manual_review:refund_present` пример: **отсутствует** в strict A (refund-rows в 2026 = 0).

---

## 5. Overlaps

| set | n |
|---|---|
| A_green ∩ B_green | 4 |
| A_only_green (A\B) | 0 |
| B_only_green (B\A) | 2 |
| C_candidate \ A_green | 174 |

B даёт +2 строки относительно A, потому что эти 2 платежа имеют SBS в payment.meta но НЕ имеют split-signal (rn_in_order=1 И pay_month=parent_month) — single rebill payment в том же месяце что и initial. В strict они дисквалифицируются по `no_split_signal`.

C даёт 178 broad candidates с разрывом месяцев / rn>1, из которых 174 без recurring evidence (нет ни parent.bepaid_subscription_id, ни payment.meta sbs). Это значит **большинство split-payments в 2026 не классифицируются как подписочные** при текущем уровне доказательств — провайдер ассоциирует их с подпиской только через `parent.bepaid_subscription_id`, которого нет.

---

## 6. Scoped baselines (по 4 users из A green) — для будущего H5.1b

| Object | Метрика | Значение |
|---|---|---|
| `payments_v2` (scoped) | rows | 71 |
| `payments_v2` (scoped) | md5 stable (id\|amount\|provider_payment_id\|transaction_type) | `02b81bad486a1b06138cc910251d9b65` |
| `payments_v2` (scoped) | md5 volatile (id\|order_id\|updated_at) | `7db2fe2e3d30d33da53f659bd4c5ebfa` |
| `orders_v2` (scoped) | rows | 59 |
| `orders_v2` (scoped) | md5 ids | `a54976fe5a812c74a8b65ef89bcb42f9` |
| `subscriptions_v2` (scoped) | rows / Σepoch / null | 18 / 31 875 252 898 / 0 |
| `entitlements` (scoped) | rows / Σepoch / null | 19 / 33 862 424 394 / 0 |

`green_payment_count = 4`, `green_user_count = 4`, `green_parent_order_count = 4`, `green_sum_amount = 805.00 BYN`.

**Mode-race risk note:** `BEPAID_REBILL_MATERIALIZATION=on`. Перед H5.1b execute обязательно re-check, что каждый из 4 green payments всё ещё не materialized runtime'ом (re-run already-materialized guard внутри transaction Stage 5.A).

---

## 7. Артефакты

- `.lovable/proofs/h5_1a_rebuilt_frozen_candidate_cohort_2026_05.md` (этот файл)
- `.lovable/proofs/h5_1a_rebuilt_frozen_candidate_cohort_2026_05.csv` — Strict A all rows (934), `cohort_type='strict'`. Frozen execute list = `cohort_type='strict' AND guard_status='green'` (4 rows).
- `.lovable/proofs/h5_1a_strict.csv` — копия strict.
- `.lovable/proofs/h5_1a_idfirst.csv` — ID-first B all rows (934).
- `.lovable/proofs/h5_1a_broad.csv` — Broad C candidates (178) с `risk_flags`.

CSV колонки strict/idfirst: `cohort_type, payment_id, provider_payment_id, parent_order_id, parent_order_number, user_id, profile_id, product_id, tariff_id, amount, currency, paid_at, deal_month, parent_deal_month, sbs_source, bepaid_subscription_id_resolved, pipeline_id, pipeline_stage_id, offer_id, expected_rebill_order_number, refund_check, already_materialized_check, guard_status, recurring_evidence`.

CSV broad дополнительно: `broad_status, risk_flags`.

---

## 8. Verdict

```
execute_ready_count          = 4   (Strict A green, все из 2026-05)
manual_review_count          = 930 (Strict A non-green: 915 sbs_unresolved + 11 pipeline_missing + 2 tariff_null + 2 no_split_signal)
skipped_already_materialized = 0
strict_vs_idfirst_delta      = |A\B|=0, |B\A|=2
strict_vs_broad_delta        = |C_candidate \ A_green| = 174 (174 без recurring evidence, sbs_unresolved)
recommended_batch_strategy   = single batch (N=4, all 2026-05, same product, 2 tariffs)
can_run_h5_1b_execute        = TECHNICALLY_YES (для 4 green), но см. §9
```

---

## 9. Главное наблюдение и рекомендация

Strict A контракт даёт **только 4 кандидата** из 934 base — потому что:
- 915/934 (98%) не имеют sbs ни в одном из стандартных путей payment.meta;
- `parent.bepaid_subscription_id` runtime не дублирует в payment.meta, поэтому ступень `parent_match` (требующая echo внутри payment.meta::text) почти всегда даёт NONE.

При этом **broad cohort C даёт 178 split-payments** — это реальный объём платежей, которые «склеены» с initial order. Они НЕ подделки, НЕ refund'ы, у них чистые orders и pipeline'ы, но runtime не записал sbs-evidence на уровне payment.

**Это противоречит изначальной оценке H5 (72 кандидата).** Реальные «исторические склейки» 2026 — в C-cohort (178 строк), а не в Strict A (4 строки).

**Три возможных пути (требуют решения пользователя):**

- **R1.** Запустить H5.1b только на 4 green из Strict A (минимальный риск, минимальная польза).
- **R2.** Ослабить SBS-резолвер в Strict A: разрешить `parent_match` без echo-проверки (используя `parent.bepaid_subscription_id` напрямую как доказательство «это subscription-order»). Тогда green Strict A раздуется до ~165–174 строк (примерная оценка из broad cohort minus pipeline/tariff/refund/duplicate). Это совпадёт с реальным объёмом исторической склейки.
- **R3.** Признать, что в 2026 базе нет надёжных payment-level evidence для подписочных rebill'ов, и решать через ручную верификацию каждого parent-order на тип (subscription/one-time). Соответствует Product Type SOT (через `tariff_offers.meta.recurring.is_recurring`).

**R2 + Product Type SOT** — самый аккуратный путь: фильтр «parent.tariff_id принадлежит recurring offer» гарантированно отделит подписочные orders от one-time, а `parent.bepaid_subscription_id` подтвердит привязку к bePaid subscription.

`H5.1b execute` **не запускать**, пока не выбран путь и не выпущен новый H5.1a' (или сразу H5.1b) с согласованным cohort definition.

---

## 10. SQL (репро)

Сохранён как `/tmp/h51a/cohorts.sql` (одна сессия, только TEMP-таблицы, без persistent objects). Создаёт `base → annotated → classified → cohort_strict / cohort_idfirst / cohort_broad`. Полный код доступен по запросу — основные блоки задокументированы в §1 и §2 (contract + key findings).

Дальнейший шаг — отдельным сообщением: выбор R1 / R2 / R3 и approve правок плана.
