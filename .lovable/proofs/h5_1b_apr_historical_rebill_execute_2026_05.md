# H5.1b-Apr — Historical REBILL Deal Linkage Repair / April 2026 — Stage 0–2 Preflight

**Тип:** read-only preflight (DML=0). Execute НЕ запускался.
**Snapshot UTC:** 2026-05-17 09:50 UTC (≈ 12:50 Minsk).
**Mode (fetch_secrets):** `BEPAID_REBILL_MATERIALIZATION` присутствует в секретах проекта (значение из H4.1 reflip = `on`, без изменений).
**Источник:** `.lovable/proofs/h5_refresh_v2_frozen_candidates_2026_05.csv` → фильтр `guard_status_v2=green AND payment_month=2026-04`.

## 1. Scope

- Только 2 green-кандидата за апрель 2026.
- Сумма: **350.00 BYN** (250.00 + 100.00).
- Остальные месяцы (03 / 05) и manual_review-строки **не трогаются**.

> Примечание: в v2 proof §6 указана сумма «350.00» для строки `b9d946d4-…`. Источник истины — frozen CSV v2: фактический `amount = 100.00 BYN`. Итог batch 250 + 100 = 350 BYN совпадает с заявленным.

## 2. Final Execute Table (для ручной проверки ФИО)

| # | payment_id | provider_payment_id | parent_order | ФИО | email | phone | amount | paid_at (UTC) | expected_rebill_order_number |
|---|---|---|---|---|---|---|---:|---|---|
| 1 | `ffb88444-c5dc-47dd-af0d-1dfe8a5d897a` | `c8ade1b3-1cd5-4119-ad5a-fe232756f2da` | `SUB-LINK-MMIZ52FC` | **Наталья Казачек** | kazachoknbuh@gmail.com | +375296891498 | 250.00 | 2026-04-10 03:00:49 | `REBILL-ffb88444-c5d` |
| 2 | `b9d946d4-e775-40e8-b5b7-f606d2e71642` | `8ab7d0a1-dd67-4188-ad8e-02cfaff7cc68` | `SUB-26-MNAI4HKZXJMB` | **Валентина Хрущёва** | shefska@gmail.com | +375297501777 | 100.00 | 2026-04-27 16:01:00 | `REBILL-b9d946d4-e77` |

## 3. Per-row Guard Verification

| guard | row 1 (ffb88444) | row 2 (b9d946d4) |
|---|---|---|
| payment всё ещё на parent_order | ✅ true | ✅ true |
| payment.status = succeeded | ✅ | ✅ |
| parent NOT REBILL- | ✅ `SUB-LINK-…` | ✅ `SUB-26-…` |
| REBILL-order ещё не существует (по 3 ключам) | ✅ false | ✅ false |
| refund guard (refunded_amount=0, no refund/void txn) | ✅ `0` | ✅ `0` |
| `parent_initial_payment_preserved` (non_refund_succ ≥ 2 ⇒ ≥1 останется) | ✅ **3** | ✅ **2** |
| pipeline_id NOT NULL | ✅ `a0000001-…001` | ✅ `a0000001-…001` |
| pipeline_stage_id NOT NULL | ✅ `…004` | ✅ `…003` |
| sbs_resolved | ✅ `sbs_b5c5ea6a57413c72` (sub.meta) | ✅ `sbs_4ac6e17bc65e73ff` (sub.meta) |
| recurring SOT signals | sot_recurring=t, sub_linked_by_order=t, sub_active_autorenew=t | sot_recurring=t, parent_flow=`provider_managed_checkout`, sub_linked_by_order=t |
| `BEPAID_REBILL_MATERIALIZATION` | ✅ present (on) | ✅ present (on) |

### 3.1 Subscriptions_v2 контекст (для контроля побочки)

| row | sub_id | status | auto_renew | access_end_at |
|---|---|---|---|---|
| 1 | `eba308ca-d9f1-465d-beab-bad93b3c72a0` | active | true | 2026-06-08 12:00 UTC |
| 2 | `96f2cae4-08d9-4ba4-83f8-70de67fa0b33` | **superseded** | false | 2026-05-27 20:59 UTC |

⚠️ **Внимание по row 2:** подписка в статусе `superseded` (auto_renew=false). Recurring-доказательство по SOT/tariff/parent.flow остаётся валидным (это исторический recurring-платёж до supersede), но при execute необходимо удостовериться, что `grant-access-for-order` для REBILL-копии **не реактивирует** superseded подписку и не расширит access_end_at сверх SOT (см. memory: `bepaid_active_to_overshoot_guard`, `subscription_renewal_secondary_grants`). Перед execute явно подтвердить ожидаемое поведение по row 2.

## 4. Baselines (snapshot 2026-05-17 09:50 UTC)

| key | value |
|---|---:|
| `payments_v2` provider=bepaid, paid_at 2026, amount>0, succeeded | **1 334** |
| `orders_v2` REBILL-% created 2026 | **201** |
| `subscriptions_v2` active/trial/past_due | **449** |
| `entitlements` total | **930** |
| `provider_subscriptions` total | **565** |
| Telegram baseline | unchanged (preflight не трогал) |

> Расхождение `payments_v2 bepaid 2026 = 1 334` (H5.1b) vs `1 771` (H5-refresh §7) — в refresh использовался расширенный фильтр без `status='succeeded'`. Для H5.1b baseline берём строгий счётчик (succeeded only), который и должен оставаться стабильным после execute.

## 5. Expected Rowcounts на execute (gold standard для verify)

| таблица | дельта | примечание |
|---|---|---|
| `orders_v2` REBILL-% 2026 | **+2** (201 → 203) | `REBILL-ffb88444-c5d`, `REBILL-b9d946d4-e77` |
| `payments_v2` | **0 added / 0 removed** | UPDATE: `payment.order_id` → новый REBILL-order |
| `payments_v2` сумма bepaid 2026 | unchanged | переносы, не новые платежи |
| `subscriptions_v2` count | **0** | row 1: остаётся active (sync access_end_at допустим, не должен уменьшаться); row 2: остаётся superseded, без изменений |
| `entitlements` count | **0** | при правильной идемпотентности |
| `provider_subscriptions` | **0** | не трогаем |
| Telegram (queue/membership) | **0** | row 1 уже active, row 2 superseded — auto-grant пропускается per canonical write-path |
| audit `bepaid.rebill.materialized` | **+2** | по одному на каждый payment |
| audit `bepaid.rebill.collision` / `already_materialized` (с конфликтом) | **0** | если ≠0 — немедленный rollback и stop |

## 6. Verdict

- **Stage 0–2 ✅ green по обоим кандидатам.**
- Все 8 обязательных guard'ов пройдены.
- Один edge-сигнал на row 2 (`superseded`+`auto_renew=false`) — требует явного approve, что мы НЕ ждём реактивации подписки от REBILL-копии. Доступ row 2 закончился 2026-05-27, продление НЕ ожидается.
- Recommend: **execute разрешать только после явного approve по row 2 поведению**. Если поведение по row 2 неприемлемо — исключить и оставить только row 1 (250 BYN).

## 7. Что НЕ сделано (намеренно)

- DML не выполнялся.
- REBILL-orders НЕ создавались.
- `payments_v2.order_id` НЕ обновлялся.
- entitlements / subscriptions_v2 / provider_subscriptions / Telegram / access_rules не трогались.
- Provider API и `grant-access-for-order` не вызывались.
- Secrets / `BEPAID_REBILL_MATERIALIZATION` не менялись.
- Refund-операции не выполнялись.

Ожидаю отдельный approve на execute с явным указанием по row 2.
