# H5-refresh v2 — discovery склеенных REBILL-сделок 2026 с усиленными guards

**Тип:** read-only discovery (DML=0, ROLLBACK).
**Snapshot UTC:** 2026-05-17 09:35 UTC (≈ 12:35 Minsk).
**Mode (fetch_secrets):** `BEPAID_REBILL_MATERIALIZATION=on` (без изменений).
**Артефакты:**
- этот файл (полный proof);
- `.lovable/proofs/h5_refresh_v2_frozen_candidates_2026_05.csv` (frozen green-only, 73 строки);
- зеркало `/mnt/documents/h5_refresh_v2_frozen_candidates_2026_05.csv`.

## 1. Что изменилось vs v1

К существующим v1-фильтрам (provider=bepaid, 2026, amount>0, status=succeeded, parent NOT REBILL, no refund/void, split signal `rn>1 OR month_split`, NOT already_materialized) добавлены **два обязательных guard'а**:

### Guard 1 — `parent_initial_payment_preserved`
Parent-order после переноса target payment должен сохранить **≥1 non-refund succeeded payment**. Операционно: `count(non_refund_succeeded payments_v2 WHERE order_id=parent) >= 2`. Если target — единственный платёж в parent → `manual_review:parent_would_be_orphaned`, в green не идёт.

### Guard 2 — `recurring_offer_sot` (по Product Type SOT)
Recurring подтверждается через хотя бы один из источников:
- `tariff_offers.meta.recurring.is_recurring=true` на активном offer тарифа (Product Type SOT);
- `payments_v2.meta.bepaid_subscription_id` присутствует на target payment;
- `orders_v2.meta.payment_flow ∈ {provider_managed_checkout, subscription_managed}` на parent;
- `subscriptions_v2` с непустым `meta.bepaid_subscription_id`, привязанная по `order_id = parent.id`;
- `subscriptions_v2` (user_id, product_id) с `auto_renew=true` и `status ∈ {active, trial, past_due}`.

`installment_count` сам по себе как recurring доказательство **не принимается** (Auto-Renewals Cohort SOT). Если ни один источник не выполнен → `manual_review:weak_recurring_evidence`.

При совпадении обоих негативов: `manual_review:parent_would_be_orphaned+weak_recurring_evidence`.

## 2. Counts (v2)

Cohort (после v1 фильтров) = **79**.

| guard_status_v2 | count | sum (BYN) |
| --- | ---:| ---:|
| **green** | **73** | **16 660.00** |
| manual_review:parent_would_be_orphaned | 2 | 600.00 |
| manual_review:sbs_unresolved | 4 | 1 375.00 |
| manual_review:weak_recurring_evidence | 0 | 0.00 |
| manual_review:parent_would_be_orphaned+weak_recurring_evidence | 0 | 0.00 |
| manual_review:refund_present | 0 | 0.00 |
| manual_review:already_materialized_conflict | 0 | 0.00 |
| skip_done (already_materialized clean) | 0 | 0.00 |

**Дельта vs v1:** green 75 → 73 (−2 ушли в `parent_would_be_orphaned`). Остальные категории без изменений.

### 2.1 Green по месяцам (Minsk)

| Месяц | green count | сумма BYN |
| --- | ---:| ---:|
| 2026-01 | 0 | 0.00 |
| 2026-03 | 2 | 500.00 |
| 2026-04 | 2 | 350.00 |
| 2026-05 | 69 | 15 810.00 |

## 3. Manual review — orphan_on_move

| payment_id | parent | month | amount | non_refund_succ | recurring_sot_signals |
| --- | --- | --- | ---:| ---:| --- |
| `6bfead3b-1365-4306-9f96-abaf66a7011e` | PAY-26-MMUQOBC8 | 2026-01 | 350.00 | 1 | все 5 источников = false |
| `ab0ffa83-ebf6-416b-a835-2dd0fa3d6a9a` | SUB-LINK-MLP7MKV3 | 2026-05 | 250.00 | 1 | sot_recurring=true, parent_flow_recurring=true, sub_linked_by_order=true, sub_active_autorenew=true |

Январский `6bfead3b-…` проваливает ОБА guard'а (orphan + weak recurring SOT — даже несмотря на наличие sbs в subscriptions_v2, subv2.status=canceled / provider_subscriptions.state=expired, recurring offer SOT=false). Майский `ab0ffa83-…` recurring подтверждён, но единственный платёж в parent — в green не идёт, отдельный manual edge case.

## 4. Manual review — sbs_unresolved (без изменений с v1)

4 январских ghost-parent'a PAY-26-* (продукт ЗАКРОЙ ГОД 2025-2026), сумма 1 375.00, sbs не резолвится ни через payment.meta, ни через parent.meta, ни через subscriptions_v2.

## 5. Baselines (snapshot 2026-05-17 09:35 UTC)

| key | count | sum |
| --- | ---:| ---:|
| `payments_v2` bepaid 2026 amount>0 succeeded | 1 771 | 303 905.13 |
| `orders_v2` REBILL-% created 2026 | 201 | 42 672.00 |
| `subscriptions_v2` active/trial/past_due | 449 | — |
| `entitlements` total | 928–930 | — |

Без движения относительно v1 snapshot.

## 6. Рекомендованный первый batch

**2026-04 — 2 строки, 350.00 BYN.** Минимальный сегмент в green-списке (`2026-03` тоже 2 строки, но сумма 500 BYN). Оба апрельских кандидата проходят ОБА новых guard'а с запасом:

| payment_id | parent | sbs | non_refund_succ | recurring signals (true) |
| --- | --- | --- | ---:| --- |
| `ffb88444-c5dc-47dd-af0d-1dfe8a5d897a` | SUB-LINK-MMIZ52FC | sbs_b5c5ea6a57413c72 | 3 | sot_recurring, sub_linked_by_order, sub_active_autorenew |
| `b9d946d4-e775-40e8-b5b7-f606d2e71642` | SUB-26-MNAI4HKZXJMB | sbs_4ac6e17bc65e73ff | 2 | sot_recurring, parent_flow_recurring, sub_linked_by_order, sub_active_autorenew |

Если 2026-04 проходит чисто → следующий 2026-03 (2 / 500), затем 2026-05 (69 / 15 810).

## 7. Verdict

**GO для подготовки execute** на v2 green = 73 / 16 660.00 BYN.
Рекомендованный первый batch — **2026-04 (2 строки, 350.00 BYN)** как минимальный безопасный сегмент.
Январь полностью исключён из green и из плана execute.

## 8. Что НЕ сделано (намеренно)

- DML не выполнялся (вся работа внутри `BEGIN; ... ROLLBACK;`).
- Никаких REBILL-orders, UPDATE payments_v2, изменений entitlements / subscriptions_v2 / provider_subscriptions / Telegram / access_rules.
- Provider API и `grant-access-for-order` не вызывались.
- Secrets / mode не менялись.

Ожидаю отдельного approve на execute-batch 2026-04 (2 строки).
