# H5-Kazachek — payment → deal reconciliation (read-only)

**Тип:** read-only reconciliation. **DML=0.** Никаких записей в orders_v2 / payments_v2 / subscriptions_v2 / entitlements / access_rules / Telegram / provider_subscriptions / refunds. `grant-access-for-order` не вызывался. Secrets/mode не менялись.

**Snapshot UTC:** 2026-05-17 ~12:00 Minsk.
**Контакт:** `profiles.id = 82ffd5ca-70fb-4551-bc9f-eb0f235773ca` (Наталья Казачек, kazachoknbuh@gmail.com, `auth.users = 6b0e0451-c01b-4cd9-8fc4-dd7e83fd5c65`).
**Продукт:** `11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club — BUSINESS), tariff `7c748940-dcad-4c7c-a92e-76a2344622d3`.

## 1. Все bePaid-платежи Казачек за 2026 (status=succeeded)

| # | payment_id | provider_payment_id | paid_at Minsk | amount | txn | order_number | order_date Minsk | is_rebill | succ_pay_on_order | verdict |
|---|---|---|---|---:|---|---|---|:---:|:---:|---|
| 1 | `a4f8ad68-1ac7-4196-9a64-73f888d255e9` | `cd6cf490` | 2026-01-06 18:54 | 250.00 | Платеж | `PAY-26-MKOBO8E3` | 2026-01-06 | – | 1 | ✅ **correct** |
| 2 | `97463c5c-b3c1-475f-977d-3c8e4ff0336f` | `f3ff927d` | 2026-02-05 19:00 | 1.00 | Платеж | — (orphan) | — | — | — | ✅ card-check, отдельная сделка не нужна |
| 3 | `5f8b16dd-226e-41ea-a5ca-adf5ae7f0a80` | `26813173` | 2026-02-05 19:00 | 1.00 | Платеж | — (orphan) | — | — | — | ✅ card-check, отдельная сделка не нужна |
| 4 | `2d840b97-5b79-4723-9a4e-6e462222731a` | `197ee778` | 2026-02-06 17:01 | 250.00 | Платеж | `ORD-26-MLAYEWNS` | 2026-02-06 | – | 1 | ✅ **correct** |
| 5 | `6d24707a-6b33-4906-93c5-760d6f37b24c` | `6d21b5ae` | 2026-03-09 12:27 | 250.00 | Платеж | `SUB-LINK-MMIZ52FC` | 2026-03-09 | – | 3* | ✅ **correct** (parent initial — но позднее refunded, см. §3) |
| 6 | `0f812d75-116e-48fb-a5b4-fab8ec7c68a7` | `a9b8096c` | 2026-04-09 16:48 | 250.00 | Платеж | `SUB-26-MNRJ58S9J89C` | 2026-04-09 | – | 1 | ✅ **correct** (отдельная апр-сделка) |
| 7 | `ffb88444-c5dc-47dd-af0d-1dfe8a5d897a` | `c8ade1b3` | 2026-04-10 06:00 | 250.00 | Платеж | **`REBILL-ffb88444-c5d`** | 2026-04-10 | ✅ | 1 | ✅ **H5.1b-Apr execute сработал** |
| 8 | `0f854c28-1847-4f04-bff9-e176e5dca0b0` | `22b9e753` | 2026-04-10 15:55 | 250.00 | **Возврат средств** | `SUB-LINK-MMIZ52FC` | 2026-03-09 | – | 3* | ⚠️ refund-row на parent (`bepaid_refund.parent_uid = 6d21b5ae` = March-initial), reason «переплата» — НЕ отдельная сделка, H5.2 |
| 9 | **`b458870d-cfad-4828-8e2a-d5e0b8cb5e5c`** | `a4872944` | **2026-05-08 12:31** | **250.00** | Платеж | **`SUB-LINK-MMIZ52FC`** | **2026-03-09** | – | 3* | ❌ **СКЛЕЕНО — нет майской сделки**, ждёт REBILL execute |

*`succ_pay_on_order=3` на `SUB-LINK-MMIZ52FC` считает refund-row `0f854c28` как succeeded (transaction_type не учитывается в подсчёте). Реальных non-refund succeeded на parent сейчас = 2 (`6d24707a` + `b458870d`). После переноса `b458870d` в собственный REBILL остаётся 1 non-refund succ → guard `parent_would_be_orphaned` не срабатывает (порог ≥1).

## 2. Spot-check ключевых кейсов

### 2.1 `ffb88444` — H5.1b-Apr execute подтверждён ✅
- `payments_v2.order_id` = `6042768c-c6ad-4a2d-a818-7e5c6e3e1d07`
- `orders_v2.order_number` = `REBILL-ffb88444-c5d`, `deal_date = 2026-04-10 03:00:49+00`, `paid_amount = 250.00`, `status = paid`
- На REBILL-order ровно 1 succeeded платёж = `ffb88444` (как и ожидалось)
- Parent `SUB-LINK-MMIZ52FC` сохранил initial payment `6d24707a` ✅

### 2.2 `b458870d` (08.05.2026, 250 BYN) — склеено
- Текущий `payments_v2.order_id` = `6611441c-0bcf-45e7-85e6-46d11d6d5db3` = `SUB-LINK-MMIZ52FC` (deal_date 2026-03-09).
- Отдельной майской сделки **нет** — UI прав.
- payment.meta: `bepaid_subscription_id=null`, `recurring=null`, `provider_managed=null`. Платёж поступил через `statement_synced` (банковская выписка от 2026-05-14 17:07 UTC), а не через bePaid webhook — поэтому в meta нет sbs.
- Однако `sbs_resolved` корректно резолвится через `subscriptions_v2` по `(user_id, product_id)`:
  - sub `eba308ca-d9f1-465d-beab-bad93b3c72a0`, status=`active`, auto_renew=`true`, `meta.bepaid_subscription_id = sbs_b5c5ea6a57413c72`, привязана к `order_id = 6611441c…` (тот же parent).
- Все 5 источников recurring SOT:
  - `sot_recurring=true` (tariff `7c748940`.meta.recurring.is_recurring)
  - `parent_flow_recurring=false` (`parent.meta.payment_flow = admin_subscription`, не входит в `{provider_managed_checkout, subscription_managed}`)
  - `sub_linked_by_order=true`
  - `sub_active_autorenew=true`
  - `payment_has_sbs=false`
- → guard_v2 = **green**. Expected REBILL order_number: `REBILL-b458870d-cfa`.

### 2.3 `0f854c28` (10.04.2026 15:55, 250 BYN) — refund-twin
- `transaction_type = 'Возврат средств'`
- `parent.meta.bepaid_refund`: id=`22b9e753`, amount=25000 (250.00 BYN), parent_uid=`6d21b5ae` (= March-initial `6d24707a`), reason=«переплата», status=successful, tracking_id=`link:order:6611441c-…`.
- Это refund-OUTPUT на parent, парный к initial-платежу марта. Не должен материализоваться в отдельную сделку. v1-фильтр `transaction_type ~ 'возврат|refund|void|отмен'` корректно его отфильтровал — в `frozen_candidates_v2.csv` его НЕТ.

## 3. Verify по frozen CSV v2 (`.lovable/proofs/h5_refresh_v2_frozen_candidates_2026_05.csv`)

```
строка 55:
b458870d-cfad-4828-8e2a-d5e0b8cb5e5c,a4872944-…,6611441c-…,SUB-LINK-MMIZ52FC,
  6b0e0451-…,11c9f1b8-…,7c748940-…,,a0000001-…,b0000001-…0004,sbs_b5c5ea6a57413c72,
  250.00,BYN,2026-05-08 09:31:25+00,2026-05,2026-03,
  rn_in_parent=3, non_refund_succ=3, sot_recurring=t, payment_has_sbs=f,
  parent_flow_recurring=f, sub_linked_by_order=t, sub_active_autorenew=t,
  expected=REBILL-b458870d-cfa, guard_status_v2=green

строка 4:
ffb88444-… ,c8ade1b3-…,6611441c-…,SUB-LINK-MMIZ52FC, …,
  expected=REBILL-ffb88444-c5d, guard_status_v2=green
```

- `b458870d` → **green**, expected `REBILL-b458870d-cfa`. **Никаким guard'ом не отсеян.** Майский batch (69 строк) ещё не выполнялся.
- `ffb88444` → формально всё ещё green в snapshot (snapshot v2 = 2026-05-17 09:35 UTC, execute H5.1b-Apr = позже). После execute должен переоцениваться как `skip_done` (already_materialized). Это для assert в H5-refresh v3.
- `0f854c28` отсутствует в CSV (refund-фильтр сработал).
- `0f812d75` отсутствует (split signal не сработал — у parent `SUB-26-MNRJ58S9J89C` всего 1 платёж и он же initial).

## 4. Главный вывод

**`b458870d` НЕ потерян и НЕ был отсеян фильтрами H5-refresh v2.** Он сидит в frozen CSV под `guard_status_v2 = green` среди 69 майских кандидатов и ждёт майского execute-батча. Причина, по которой пользователь видит на UI «платёж 08.05 без сделки» — банальна: майский H5 batch ещё не запускался. После апрельского execute остановились на 1 строке (Казачек/Apr) и не доходили до мая.

Никакого «майского edge case Казачек был отброшен v2» нет. Картина чистая:

| Категория | Платежи Казачек |
|---|---|
| Корректные отдельные сделки | `a4f8ad68` (Jan), `2d840b97` (Feb), `6d24707a` (Mar parent), `0f812d75` (Apr separate), `ffb88444` (Apr REBILL — execute done) |
| Склеено, ждёт REBILL execute | **`b458870d`** (May, 250 BYN) — в green frozen CSV v2 |
| Refund / edge | `0f854c28` (Apr-10 refund-twin, H5.2) |
| Orphan без сделки (norm) | `97463c5c`, `5f8b16dd` (card-check 1 BYN ×2) |

**Какие именно payment_id нужно перенести (по Казачек):** ровно один — `b458870d-cfad-4828-8e2a-d5e0b8cb5e5c` → ожидаемый `REBILL-b458870d-cfa` (deal_date 2026-05-08 09:31:25+00, amount 250.00 BYN).

## 5. Рекомендация по дальнейшему H5

Перед запуском любого нового execute прогнать H5-refresh v3 с обязательными контрольными asserts (по приказу пользователя):

- `b458870d` → **green** (контрольный кейс для всего майского batch — если ушёл в любой manual_review, batch запрещён до объяснения)
- `ffb88444` → **skip_done** (already_materialized после H5.1b-Apr execute, REBILL-ffb88444-c5d уже существует)
- `0f854c28` → **manual_review:refund_related** (refund-row на parent, не должен идти в green)
- `b9d946d4` → **manual_review:refund_or_tariff_upgrade_flow** (Хрущёва — refund 100 + новый тариф 150)
- `6bfead3b` → **manual_review:parent_would_be_orphaned**

Если все asserts проходят → майский batch можно собирать. Если хоть один расходится — execute запрещён до анализа расхождения.

## 6. Что НЕ сделано (намеренно)

- Никакого DML, никаких UPDATE/INSERT/DELETE.
- `grant-access-for-order` не вызывался.
- Provider API / Telegram / secrets / mode не трогались.
- Никакие REBILL-orders дополнительно к уже существующему `REBILL-ffb88444-c5d` не создавались.

## 7. Ссылки

- `.lovable/proofs/h5_refresh_v2_frozen_candidates_2026_05.csv` (frozen CSV, 73 green строки, включая `b458870d` на строке 55)
- `.lovable/proofs/h5_refresh_v2_historical_rebill_deal_linkage_discovery_2026_05.md` (refresh v2 discovery)
- `.lovable/proofs/h5_1b_apr_historical_rebill_execute_2026_05.md` (Apr execute с §9 Stage 3 result)
