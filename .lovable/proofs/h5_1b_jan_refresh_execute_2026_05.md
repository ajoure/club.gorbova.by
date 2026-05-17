# H5.1b-Jan-refresh — Historical REBILL Deal Linkage Repair / January 2026

**Тип:** read-only Stage-0 preflight (DML=0).
**Snapshot UTC:** 2026-05-17 09:20 UTC (≈ 12:20 Minsk).
**Mode (fetch_secrets):** `BEPAID_REBILL_MATERIALIZATION=on` (без изменений).
**Scope:** только `payment_month=2026-01` из `.lovable/proofs/h5_refresh_frozen_candidates_2026_05.csv`.
**Кандидаты (из frozen CSV):** 1 строка.
**Verdict:** **HOLD — НЕ запускать execute.** Найдены 2 независимых блокера. Январский batch требует пересмотра классификации.

## 1. Целевой платёж (из frozen CSV)

| поле | значение |
| --- | --- |
| payment_id | `6bfead3b-1365-4306-9f96-abaf66a7011e` |
| provider_payment_id | `714e3732-6b63-49fd-a24a-f7873327ef77` |
| parent_order_id | `43c34b9a-9f57-4408-bdd0-a6ba49226f95` |
| parent_order_number | `PAY-26-MMUQOBC8` |
| customer_email | `irkaguzarevich@mail.ru` |
| user_id | `1502c12e-bb49-4362-a6bf-2e3ed6109d29` |
| product_id | `de36a695-…` (ЗАКРОЙ ГОД 2025-2026, installment) |
| tariff_id | `0fb3db55-b6ba-44bf-8a0b-37bb040ab01a` |
| pipeline_id / stage_id | `a0000001-…-08` / `b0000001-…-08-03` |
| amount | 350.00 BYN |
| paid_at | 2026-01-20 14:29:59 UTC |
| sub_id (frozen) | `beab8ace-0fc3-4ad9-8f0e-755634d5e14d` |
| sbs (frozen) | `sbs_686219e109cfccc1` (source: `subscriptions_v2`) |
| expected_rebill_order_number | `REBILL-6bfead3b-136` |
| recurring_evidence (frozen) | `tariff.installment | subv2.bepaid_subscription_id` |

## 2. Preflight checks (живые данные)

| check | результат | статус |
| --- | --- | --- |
| payment всё ещё на parent_order | да (`order_id=43c34b9a…`) | ✅ |
| parent_order НЕ REBILL | `PAY-26-MMUQOBC8` | ✅ |
| REBILL-order ещё не существует | 0 строк по всем guard-критериям | ✅ |
| refund_check | `refunded_amount` пуст, `transaction_type='Платеж'`, нет refund-rows | ✅ |
| pipeline_id / pipeline_stage_id NOT NULL | оба заполнены | ✅ |
| mode = on | `BEPAID_REBILL_MATERIALIZATION=on` (fetch_secrets) | ✅ |
| **parent сохранит initial non-refund payment после move** | parent имеет **ровно 1** non-refund succeeded payment = target. После переноса — **orphan parent** (`paid_amount=350.00` без payments_v2-строки). | ❌ **БЛОКЕР #1** |
| **recurring evidence по SOT** | `tariff_offers.meta.recurring.is_recurring` = **NULL** у обоих pay_now-offer'ов тарифа `0fb3db55…`. `is_installment=false`, `installment_count=2` есть только у одного offer'a. `payment.meta.bepaid_subscription_id` отсутствует. `parent.meta.payment_flow` / `recurring` пустые. Единственная связка sbs — через `subscriptions_v2.meta.bepaid_subscription_id`. | ⚠️ слабая |
| subscription state | `subscriptions_v2.status='canceled'`, `access_end_at=NULL`, `auto_renew=false`. | ❌ **БЛОКЕР #2** |
| provider_subscription state | `provider_subscriptions.state='expired'`, `next_charge_at=NULL`. | ❌ подтверждение #2 |
| timing-аномалия | `payment.paid_at=2026-01-20`, `parent_order.created_at=2026-03-16` (parent создан **через 55 дней ПОСЛЕ платежа**). Это reverse-split, нетипичный для REBILL-сценария (REBILL = поздний автоплатёж после раннего parent). | ⚠️ требует уточнения |

### 2.1 Контекст пользователя/продукта

Все orders_v2 пары `(user=1502c12e…, product=de36a695…)`:

| id | order_number | status | created_at | paid_amount |
| --- | --- | --- | --- | --- |
| 43c34b9a… | PAY-26-MMUQOBC8 | paid | 2026-03-16 | 350.00 |
| 2e71b286… | ORD-26-00068 | pending | 2026-05-04 | 0 |
| 58a7b17d… | SUB-LINK-MOQSJKAY | pending | 2026-05-04 | 0 |

Других bepaid-платежей по продукту нет. Картина: один январский платёж по installment plan (1 из 2 запланированных), parent создан задним числом, subv2/provider уже схлопнулись в canceled/expired без access. Это не классическая REBILL-склейка, а скорее обрезанный installment-сценарий.

## 3. Baselines (snapshot 2026-05-17 09:20 UTC)

| key | count | sum |
| --- | --- | --- |
| `payments_v2` bepaid 2026, amount>0 | 1 771 | 303 905.13 |
| `orders_v2` `REBILL-%` created 2026 | 201 | 42 672.00 |
| `subscriptions_v2` active/trial/past_due | 449 | sum(access_end_at epoch) = 705 847 652 732.745 |
| `entitlements` total с expires_at | 928 | sum(expires_at epoch) = 1 652 930 826 206.749 |
| `provider_subscriptions` (целевая sbs) | 1 | `state=expired` |

## 4. Сторонний риск, выявленный preflight'ом

Проверка по всему frozen-CSV (75 строк) → у скольких parent'ов всего 1 non-refund succeeded payment (orphan-on-move):

| non_refund_succ | parents | orphans_on_move |
| --- | --- | --- |
| 1 | 2 | **2** |
| 2 | 70 | 0 |
| 3 | 1 | 0 |

Orphans:
- `43c34b9a-…` `PAY-26-MMUQOBC8` — **январский target**.
- `a27a8b74-…` `SUB-LINK-MLP7MKV3` — майский (product `11c9f1b8…`).

→ В H5-refresh discovery guard `parent_initial_payment_preserved` отсутствовал. Эти 2 строки должны были попасть в `manual_review:orphan_on_move`, а не в `green`.

## 5. Final execute table

| field | value |
| --- | --- |
| candidate payment | `6bfead3b-…` |
| recommended action | **NO-OP (HOLD)** |
| expected rowcounts | 0 / 0 / 0 / 0 |
| reason | блокер #1 (orphan_on_move) + блокер #2 (subv2 canceled / provider expired) + слабая recurring evidence по SOT |

DML НЕ запускался. Никаких изменений в `orders_v2`, `payments_v2`, `subscriptions_v2`, `entitlements`, `provider_subscriptions`, `access_rules`, Telegram, secrets — нет.

## 6. Verdict

**HOLD январский batch.** Прошу approve на одно из двух:

**Вариант A (рекомендуется):** обновить guard-набор в H5-refresh:
1. Добавить guard `parent_initial_payment_preserved` (parent после move должен сохранить ≥1 non-refund succeeded payment). Это автоматически выводит 2 orphan-parent'a в `manual_review:orphan_on_move`.
2. Добавить guard `recurring_offer_sot` (требовать `tariff_offers.meta.recurring.is_recurring=true` ИЛИ explicit `payment.meta.bepaid_subscription_id` ИЛИ `parent.meta.payment_flow ∈ {provider_managed_checkout, subscription_managed}`). По SOT `Auto-Renewals Cohort SOT` + `Recurring Snapshot Resolver SOT` — installment_count сам по себе не делает offer recurring.
3. Перевыпустить frozen CSV (`h5_refresh_frozen_candidates_2026_05_v2.csv`) и пересчитать сводку по месяцам.
4. После этого выбрать новый первый batch.

**Вариант B:** руками подтвердить, что для январского `6bfead3b-…` экономически и юридически корректно создать REBILL-order и оставить parent `PAY-26-MMUQOBC8` orphaned (paid_amount без payment). Тогда отдельный approve именно на этот edge case.

## 7. Что НЕ сделано (намеренно)

- DML не выполнялся.
- Mode не менялся.
- `subscriptions_v2` / `entitlements` / `provider_subscriptions` / Telegram / `access_rules` не трогались.
- `grant-access-for-order` и provider API не вызывались.
- Manual_review строки не трогались.

Ожидаю approve на Вариант A или Вариант B перед любым execute.
