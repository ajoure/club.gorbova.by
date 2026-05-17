# H5-final-bulk-remaining — execute + verify + ROLLBACK

**Snapshot UTC:** 2026-05-17 ~12:30 UTC
**Run id:** `h5_final_bulk_remaining_2026_05`
**Итог:** Batch A прошёл, Batch B прошёл по количеству, но финальный verify обнаружил **orphan parent** → выполнен полный rollback по обоим batch'ам. Состояние БД побайтово вернулось к baseline.

## 1. Финальный scope (71 платёж / 16 310 BYN)

Источник: `.lovable/proofs/h5_refresh_v2_frozen_candidates_2026_05.csv` (73 green) − ffb88444 (skip_done) − b9d946d4 (manual_review:refund_or_tariff_upgrade_flow) = 71.

| batch | месяц | rows | сумма BYN |
| --- | --- | ---:| ---:|
| A | 2026-03 | 2 | 500.00 |
| B | 2026-05 | 69 | 15 810.00 |
| **итого** | | **71** | **16 310.00** |

Списки: `/tmp/h5_batch_A.txt`, `/tmp/h5_batch_B.txt`.

## 2. Preflight (read-only, до execute)

| guard | value | ok |
| --- | ---:|:---:|
| cohort_size | 71 | ✅ |
| with_refund_or_not_succeeded | 0 | ✅ |
| parent_would_be_orphaned (per-row sib_succ<2) | 0 | ✅ |
| already_materialized | 0 | ✅ |
| parent_is_rebill | 0 | ✅ |
| total_amount | 16 310.00 BYN | ✅ |

**Все per-row guards зелёные.** Однако этот preflight оценивал orphan-риск **поштучно** (sib_succ ≥ 2 у каждого parent на момент проверки) и **не учитывал кейс, когда несколько candidate-платежей делят один parent**.

## 3. Baseline (до execute)

| метрика | значение |
| --- | ---:|
| `subscriptions_v2` active/trial/past_due | 449 |
| `entitlements` total | 931 |
| `subscriptions_v2` Σepoch(access_end_at) | 1 943 707 329 318 |
| `entitlements` Σepoch(expires_at) | 1 654 710 914 606 |
| `orders_v2` REBILL-% | 202 |
| `provider_subscriptions` | 565 |
| `telegram_club_members` access_status='active' | 0 |

## 4. Execute Batch A (Март, 2 платежа)

| метрика | значение |
| --- | ---:|
| inserted REBILL-orders (batch=A) | 2 |
| updated payments_v2.order_id (batch=A) | 2 |
| audit per-payment (batch=A) | 2 |
| audit summary (batch=A) | 1 |
| orphan parents after A | 0 |

**Verify A: PASS.** Переход к Batch B.

## 5. Execute Batch B (Май, 69 платежей)

| метрика | значение |
| --- | ---:|
| inserted REBILL-orders (batch=B) | 69 |
| updated payments_v2.order_id (batch=B) | 69 |
| audit per-payment (batch=B) | 69 |
| audit summary (batch=B) | 1 |
| REBILL_count_run total | 71 |
| payments_repointed_run | 71 |
| audit_payment_run | 71 |
| audit_summary_run | 2 |
| b458870d → expected | `REBILL-b458870d-cfa` ✅ |
| rebill_has_one_payment | 71 ✅ |
| rebill_not_one_payment | 0 ✅ |
| **orphan_parents (final invariant)** | **1 ❌** |

## 6. Причина FAIL → ROLLBACK

Parent `SUB-LINK-MLNYCZPF` (`efe58870-e539-4e76-874a-9e5b03a66ae3`, продукт Gorbova Club — BUSINESS) исходно имел ровно 2 succeeded non-refund payments:

- `8c78c039-7c22-46b5-a47e-f3067aef9007` — 2026-03-17 (в Batch A)
- `5fc22e49-9e15-430a-a7a2-c5a0d12084a6` — 2026-05-* (в Batch B)

**Оба** платежа попали в candidate list и оба были перенесены в новые REBILL-orders → parent остался с 0 succeeded payments. Per-row preflight (sib_succ ≥ 2) этого кейса не покрыл, потому что проверял каждого кандидата изолированно.

Это нарушает обязательный verify-invariant «каждый parent сохранил минимум 1 successful non-refund payment». Согласно протоколу — **полный rollback обоих batch'ей**.

## 7. Rollback (выполнен)

`UPDATE payments_v2` (71 rows) → восстановлен `order_id` = старый parent, удалён `meta.rebill_materialization`.
`DELETE FROM orders_v2 WHERE meta->>'run'='h5_final_bulk_remaining_2026_05'` → 71 REBILL-order удалены.
`INSERT INTO audit_logs` → 1 rollback summary с причиной.

### Verify post-rollback (vs baseline)

| метрика | post | baseline | OK |
| --- | ---:| ---:|:---:|
| rebill_run_remaining | 0 | 0 | ✅ |
| payments_still_repointed | 0 | 0 | ✅ |
| `subscriptions_v2` active/trial/past_due | 449 | 449 | ✅ |
| `entitlements` total | 931 | 931 | ✅ |
| `subscriptions_v2` Σepoch(access_end_at) | 1 943 707 329 318 | 1 943 707 329 318 | ✅ |
| `entitlements` Σepoch(expires_at) | 1 654 710 914 606 | 1 654 710 914 606 | ✅ |
| `orders_v2` REBILL-% | 202 | 202 | ✅ |
| `provider_subscriptions` | 565 | 565 | ✅ |
| rollback_audit row | 1 | — | ✅ |

**State восстановлен побайтово.** subscriptions_v2 / entitlements / provider_subscriptions / Telegram / parent orders — без изменений.

## 8. Что НЕ выполнялось (намеренно)

- `subscriptions_v2`, `entitlements`, `provider_subscriptions`, `telegram_club_members`, `access_rules`, `refunds`-таблицы — без touch.
- `grant-access-for-order`, provider API, secrets / mode — без touch.
- Parent orders — без touch.

## 9. Backlog (необходимо до следующей попытки)

Перед повторным execute обязательно нужен **collective orphan guard** в preflight:

> Для каждого `parent_order_id` посчитать число candidate-платежей в run.
> Если `candidates_on_parent >= sib_succ` → **исключить как минимум один** платёж этого parent из run (например, первый по `paid_at`) или весь parent в `manual_review:parent_would_be_orphaned_collective`.

Сейчас известно ровно **1 такой parent**: `SUB-LINK-MLNYCZPF` (`efe58870-…`), 2 candidate-платежа (`8c78c039`, `5fc22e49`). После добавления collective guard:

- При выборе «оставить первый платёж parent'у» — green = 70 (250 BYN меньше: 16 060.00 BYN).
- Альтернатива: материализовать первый в SUB-LINK-MLNYCZPF как «оригинал» (оставить on parent), второй (`5fc22e49`) перенести в REBILL.

Решение по этому кейсу — за пользователем.

## 10. Артефакты

- `.lovable/proofs/h5_final_bulk_remaining_rebill_execute_2026_05.md` — этот файл
- `.lovable/proofs/h5_final_bulk_remaining_rebill_execute_2026_05.csv` — финальный candidate-список (71 row)
- `.lovable/proofs/h5_final_bulk_rollback_2026_05.sql` — per-row rollback (резервный, не использован — rollback выполнен одним CTE через supabase--insert)

## 11. Итог

**FAILED → ROLLED BACK.** Database state идентичен pre-execute baseline.
Ждать решения пользователя по collective-orphan кейсу `SUB-LINK-MLNYCZPF` перед повторной попыткой.
