# H5.1b-Apr — Historical REBILL Deal Linkage Repair / April 2026 — Stage 0–2 Preflight (v3, refund-guard corrected)

**Тип:** read-only preflight (DML=0). Execute НЕ запускался.
**Snapshot UTC:** 2026-05-17 10:35 UTC (≈ 13:35 Minsk).
**Mode (fetch_secrets):** `BEPAID_REBILL_MATERIALIZATION` присутствует (значение из H4.1 reflip = `on`, без изменений).
**Источник:** `.lovable/proofs/h5_refresh_v2_frozen_candidates_2026_05.csv` → фильтр `guard_status_v2=green AND payment_month=2026-04`.

## 0. Изменения относительно v2 preflight

В предыдущей версии proof мы пометили обе апрельские строки как заблокированные:
- row 1 (`ffb88444`) → ошибочно ушёл в `manual_review:parent_refund_present_on_other_payment`;
- row 2 (`b9d946d4`) → корректно в `manual_review:refund_or_tariff_upgrade_flow`.

Правило parent-level refund guard было сформулировано слишком широко и блокировало чистые успешные платежи только потому, что в parent-order когда-то был возврат по другому платежу. Это противоречит главному принципу H5:

> **Один успешный bePaid payment = одна сделка. Refund блокирует ТОЛЬКО тот payment, к которому он относится.**

Ниже — исправленная логика и пересборка результата.

## 1. Корректный refund-guard (canonical)

Для candidate payment `C` (с `payment_id=C.pid`, `provider_payment_id=C.ppid`) refund блокирует материализацию ТОЛЬКО при выполнении хотя бы одного из условий:

1. `payments_v2.refunded_amount > 0` у самого `C`;
2. существует refund-row `R` в `payments_v2` (`transaction_type='refund'` или legacy `meta.type='refund'`/`amount<0`), такой что:
   - `R.meta->>'parent_payment_id' = C.pid`, **или**
   - `R.meta->>'parent_payment_uid' = C.ppid`, **или**
   - `R.meta->'bepaid_refund'->>'parent_uid' = C.ppid` (bePaid-native link).

Если ни одно условие не выполнено, но в `parent_order.meta.bepaid_refund.parent_uid` фигурирует ДРУГОЙ `ppid` (не `C.ppid`) — это НЕ блокирует `C`. Вместо этого фиксируется неблокирующий warning:

- `parent_has_refund_on_other_payment` (informational).

## 2. Применение к April candidates

### 2.1 Row 1 — `ffb88444…` / Наталья Казачек

| проверка | значение | вывод |
|---|---|---|
| `payments_v2.refunded_amount` у `ffb88444` | **0** | clean |
| refund-rows в `payments_v2` с `meta.parent_payment_id = ffb88444…` | **0** | clean |
| refund-rows в `payments_v2` с `meta.parent_payment_uid = c8ade1b3…` | **0** | clean |
| refund-rows в `payments_v2` с `bepaid_refund.parent_uid = c8ade1b3…` | **0** | clean |
| `orders_v2.meta.bepaid_refund.parent_uid` для `SUB-LINK-MMIZ52FC` | `6d21b5ae…` (≠ candidate.ppid) | **другой платёж** |

Refund в parent-order относится к мартовскому платежу `6d24707a / 6d21b5ae` (initial parent payment, 250 BYN, paid_at 2026-03-09, reason «переплата»). Candidate `ffb88444` (2026-04-10) — отдельный успешный recurring rebill, по нему возврата нет.

**Verdict row 1:** ✅ `guard_status=green`, warning `parent_has_refund_on_other_payment` (информационный).

### 2.2 Row 2 — `b9d946d4…` / Валентина Хрущёва

По указанию пользователя сценарий = refund 100 BYN по старому тарифу + новая оплата 150 BYN за новый тариф 2026-04-29. Это не простой REBILL-linkage repair, а refund + tariff upgrade.

**Verdict row 2:** `manual_review:refund_or_tariff_upgrade_flow`. Уходит в H5.2, в апрельский batch НЕ включается.

## 3. Final Execute Table (April 2026, для ручной проверки ФИО)

| # | payment_id | provider_payment_id | parent_order | ФИО | email | phone | amount | paid_at (UTC) | expected_rebill_order_number | warning | guard_status |
|---|---|---|---|---|---|---|---:|---|---|---|---|
| 1 | `ffb88444-c5dc-47dd-af0d-1dfe8a5d897a` | `c8ade1b3-1cd5-4119-ad5a-fe232756f2da` | `SUB-LINK-MMIZ52FC` | **Наталья Казачек** | kazachoknbuh@gmail.com | +375296891498 | 250.00 | 2026-04-10 03:00:49 | `REBILL-ffb88444-c5d` | `parent_has_refund_on_other_payment` | **green** |

Excluded:
- `b9d946d4-e775-40e8-b5b7-f606d2e71642` / Хрущёва — `manual_review:refund_or_tariff_upgrade_flow` (handled in H5.2).

## 4. Per-row Guard Verification (row 1)

| guard | row 1 (ffb88444) |
|---|---|
| payment всё ещё на parent_order | ✅ true (`SUB-LINK-MMIZ52FC`) |
| payment.status = succeeded | ✅ |
| parent NOT REBILL- | ✅ `SUB-LINK-…` |
| REBILL-order ещё не существует (по 3 ключам) | ✅ false |
| **refund guard (corrected)** | ✅ candidate.refunded_amount=0; нет refund-rows с parent_payment_id/uid = candidate; bepaid_refund.parent_uid в parent-order = `6d21b5ae…` (другой платёж) → warning, не blocker |
| `parent_initial_payment_preserved` | ✅ после move ffb88444 в parent останутся 2 succeeded (`6d24707a` март, `b458870d` май) |
| pipeline_id NOT NULL | ✅ |
| pipeline_stage_id NOT NULL | ✅ |
| sbs_resolved | ✅ `sbs_b5c5ea6a57413c72` |
| recurring SOT signals | ✅ tariff_offers.meta.recurring.is_recurring=true; sub_linked_by_order=true; sub active+auto_renew |
| `BEPAID_REBILL_MATERIALIZATION` | ✅ present (on) |

### Subscriptions_v2 контекст
- sub `eba308ca-d9f1-465d-beab-bad93b3c72a0`: `status=active`, `auto_renew=true`, `access_end_at=2026-06-08 12:00 UTC`. Sync access_end_at допустим, не должен уменьшаться (см. memory `bepaid_active_to_overshoot_guard`).

## 5. Baselines (snapshot 2026-05-17 10:35 UTC)

| key | value |
|---|---:|
| `payments_v2` provider=bepaid, paid_at 2026, amount>0, succeeded | **1 334** |
| `orders_v2` REBILL-% created 2026 | **201** |
| `subscriptions_v2` active/trial/past_due | **449** |
| `entitlements` total | **930** |
| `provider_subscriptions` total | **565** |
| Telegram baseline | unchanged (preflight не трогал) |

## 6. Expected Rowcounts на execute (gold standard для verify)

| таблица | дельта | примечание |
|---|---|---|
| `orders_v2` REBILL-% 2026 | **+1** (201 → 202) | создаётся `REBILL-ffb88444-c5d` |
| `payments_v2` UPDATE order_id | **1** | `ffb88444` перевязан с parent на новый REBILL-order |
| `payments_v2` count added/removed | **0** | переносы, не новые платежи |
| `payments_v2` сумма bepaid 2026 | unchanged | |
| `subscriptions_v2` | **0** изменений | sub остаётся active/auto_renew; access_end_at sync ≥ текущего значения |
| `entitlements` | **0** изменений | |
| `provider_subscriptions` | **0** изменений | |
| Telegram (queue/membership) | **0** изменений | row 1 уже active |
| audit `bepaid.rebill.materialized` | **+1** | per-payment |
| audit `bepaid.rebill.batch.summary` (H5.1b-Apr) | **+1** | один summary row |
| audit `bepaid.rebill.collision` / `already_materialized` (с конфликтом) | **0** | если ≠0 — немедленный rollback и stop |

## 7. Verdict

- **Stage 0–2 ✅ green** для row 1 (Казачек, 250 BYN).
- Refund-guard исправлен и применён по canonical логике: refund блокирует только тот payment, к которому относится.
- Row 2 (Хрущёва) выведена в `manual_review:refund_or_tariff_upgrade_flow`, в апрельский batch НЕ входит.
- April batch теперь содержит **1 green payment / 250.00 BYN**.

## 8. Что НЕ сделано (намеренно)

- DML не выполнялся.
- REBILL-orders НЕ создавались.
- `payments_v2.order_id` НЕ обновлялся.
- entitlements / subscriptions_v2 / provider_subscriptions / Telegram / access_rules не трогались.
- Provider API и `grant-access-for-order` не вызывались.
- Secrets / `BEPAID_REBILL_MATERIALIZATION` не менялись.
- Refund-операции не выполнялись.

**Ожидаю финальное подтверждение обновлённой таблицы → затем approve на execute (только Казачек, 250 BYN).**
