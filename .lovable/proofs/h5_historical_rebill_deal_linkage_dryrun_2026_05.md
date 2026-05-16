# H5 — Historical REBILL Deal Linkage Repair 2026 — Stage 1 dry-run

**Date:** 2026-05-16 (snapshot fixed at query time, Europe/Minsk)
**Status:** Read-only. Stage 1 only. DML = 0. Migrations = 0. Provider API = 0.
**Mode:** `BEPAID_REBILL_MATERIALIZATION=on` (H4.1 Stage 2 observation).

## 0. Идентификаторы (контракт правки #2 — без двусмысленности)

- `payments_v2.id` — внутренний UUID платежа.
- `payments_v2.provider_payment_id` — bePaid transaction uid.
- `orders_v2.provider_payment_id` — bePaid uid, проставляемый канонической materialization (`REBILL-<first12(provider_payment_id)>`).
- При создании REBILL-order формат — **тот же, что в текущем materialization**: `order_number = 'REBILL-' || substr(provider_payment_id, 1, 12)`. Не смешивать с `payments_v2.id` UUID. Дополнительно `meta.materialized_from_payment_id = payments_v2.id`.

## 1. Скоуп

- `payments_v2`: `provider='bepaid'`, `paid_at ∈ [2026-01-01; 2027-01-01)`, `status ∈ {succeeded, refunded}` (enum `payment_status` не содержит `paid`).
- Recurring/autocharge признак (любой из):
  - `meta->>'bepaid_subscription_id' IS NOT NULL`
  - `meta->>'payment_flow' = 'bepaid_subscription_charge'`
  - `meta->>'is_recurring' = true`
  - `meta->>'parent_uid' IS NOT NULL`
  - `is_recurring = true`
- Refund признак (правка #3 — учёт фактических вариантов БД):
  - `transaction_type IN ('refund','Refund','Возврат средств')`
  - ИЛИ `meta->>'type' = 'refund'`
  - ИЛИ `amount < 0`
  - ИЛИ (для parent classifier) `refunded_amount > 0`
  - `transaction_type='Отмена'` — НЕ refund (это `void`, не возврат).
- Все булевые сравнения через `COALESCE(...,false)` — без NULL-trap.
- `rn>1` считается **только среди успешных non-refund** платежей (правка #4).

## 2. Топ-цифры (источник истины — `orders_v2/payments_v2` сейчас, не старый аудит)

| Метрика | Значение |
|---|---|
| Всего bePaid 2026 (succeeded/refunded) | **1 335** |
| Refund-rows | 36 |
| Non-refund payments | 1 299 |
| Из них recurring (cohort) | 557 |
| Из них one-time | 742 |
| Already in REBILL-order | 176 |
| Skip (initial OK: rn=1, month совпал) | 309 |
| **Кандидаты на split → REBILL** | **72** |
| Duplicate REBILL by `provider_payment_id` | **0** |
| Кандидаты без parent order | 0 |
| Refunds: имеют `meta.parent_payment_id` | 1 / 36 |
| Refunds: orphan (нет parent meta) | **35** |

Разница с `rebill_orders_audit_2026.md` (200 кандидатов на март 2026): за прошедший период 176 уже материализованы каноническим путём (mode=on + ранее) — поэтому SOT сейчас даёт 72 остатка. Старый аудит — reference, не SOT (правка #6).

## 3. Распределение 72 кандидатов

### По planned_action

| planned_action | cnt |
|---|---|
| `create_rebill_for_subsequent_payment` (rn>1) | 71 |
| `create_rebill_or_review_initial_offset` (rn=1, но месяц платежа ≠ месяц сделки) | 1 |

### По месяцу платежа

| pay_month | cnt |
|---|---|
| 2026-03 | 2 |
| 2026-04 | 2 |
| 2026-05 | 68 |

### Агрегаты

- distinct users: **62**
- distinct parent orders: **71**
- distinct tariffs: **4** (recurring cohort)
- Σ amount: **16 410.00 BYN**

## 4. Refund resolution

- 36 refund-rows в скоупе:
  - 1 имеет `meta.parent_payment_id` + `meta.parent_payment_uid` (canonical) — переедет вместе с parent, если parent попадёт в REBILL.
  - **35 orphan** — нет `parent_payment_id`, нет `parent_payment_uid`. Резолв возможен только эвристикой `(user_id, bepaid_subscription_id, amount, time-window)` — это **запрещено по ID-First Contract** (см. memory).
  - 11 не имеют `order_id` совсем.
- **Planned action для всех 35 orphan refunds**: `manual_review`. Не угадывать parent.
- Кейс Ларисы (refund `49825c85-07e5...`) — orphan в meta, но фактически уже сидит на правильном `REBILL-7a64cd04-3d0` (PATCH DEAL-LINKAGE-ROOT-FIXES-2026-05 уже починил). Действия не требуется.

## 5. Образец 15 первых кандидатов (по `paid_at`)

| payment_id | bepaid uid | amt | paid_at (UTC) | pay_month | current_order | order_month | rn |
|---|---|---|---|---|---|---|---|
| ab0ffa83… | fcda768e… | 250 | 2026-03-18 13:46 | 2026-03 | SUB-LINK-MLP7MKV3 | 2026-02 | 1 |
| 66871b07… | bb2cef4a… | 250 | 2026-03-21 03:01 | 2026-03 | SUB-26-MLQHNWJMW2CN | 2026-02 | 2 |
| ffb88444… | c8ade1b3… | 250 | 2026-04-10 03:00 | 2026-04 | SUB-LINK-MMIZ52FC | 2026-03 | 2 |
| b9d946d4… | 8ab7d0a1… | 100 | 2026-04-27 16:01 | 2026-04 | SUB-26-MNAI4HKZXJMB | 2026-03 | 2 |
| a83352c2… | 8f22a0c4… | 250 | 2026-05-02 09:15 | 2026-05 | SUB-LINK-MMADP5ZB | 2026-03 | 2 |
| 5a112ac0… | fca38cc5… | 250 | 2026-05-02 13:00 | 2026-05 | SUB-LINK-MNHH3SQH | 2026-04 | 2 |
| 0e713a34… | f76b8c76… | 250 | 2026-05-02 13:15 | 2026-05 | SUB-LINK-MNHH6TU2 | 2026-04 | 2 |
| 76eaa1d1… | 22b52a8a… | 250 | 2026-05-02 18:00 | 2026-05 | SUB-26-MMAWIO73NU51 | 2026-03 | 2 |
| 479c6df9… | ee98e5a4… | 250 | 2026-05-03 05:45 | 2026-05 | SUB-26-MMBLYVOS3KAC | 2026-03 | 2 |
| a3737a29… | 64accff3… | 250 | 2026-05-03 06:45 | 2026-05 | SUB-LINK-MMBMO4LL | 2026-03 | 2 |
| 1f92a138… | a752f367… | 250 | 2026-05-03 07:00 | 2026-05 | SUB-LINK-MMBNQHVI | 2026-03 | 2 |
| ef22adef… | 48ac648e… | 250 | 2026-05-03 10:15 | 2026-05 | SUB-LINK-MNIQ1XGN | 2026-04 | 2 |
| 5d351438… | ae6387aa… | 250 | 2026-05-03 10:15 | 2026-05 | SUB-LINK-MNIQS4P0 | 2026-04 | 2 |
| 927b948e… | 1fbc88e7… | 250 | 2026-05-03 11:30 | 2026-05 | SUB-LINK-MNIT7JUV | 2026-04 | 2 |
| 02e332de… | a3237ab8… | 250 | 2026-05-03 11:30 | 2026-05 | SUB-LINK-MNIT8568 | 2026-04 | 2 |

Полный список 72 кандидатов извлекается тем же CTE — приложен к Stage 2 H5.1 snapshot.

## 6. Spot-check кейсов

### Лариса Конобеева — `user_id=e748983f-8409-49b6-b5f5-88a7c95920b0`

- 7 bePaid платежей в 2026 + 1 refund.
- **NOT a candidate**. Все платежи уже в правильных месячных REBILL/initial-orders после PATCH DEAL-LINKAGE-ROOT-FIXES-2026-05:
  - 2026-03 → `SUB-26-MMOP3Z026XWH` ✅
  - 2026-04 → `REBILL-0e530a8c-3eb` ✅
  - 2026-05 → `SUB-LINK-MP2YGAG4` + `REBILL-7a64cd04-3d0` + refund на `REBILL-7a64cd04-3d0` ✅
- `not_candidate_reason = already_repaired_2026_05`.

### Вероника Матук — `user_id=341e6f46-79dd-4920-b500-da78e3574aab`

- 10 bePaid платежей в 2026 (включая 1 refund).
- **NOT a candidate**. Все месяцы совпадают: ORD-26 для основной, REBILL-23a5fe7f / REBILL-3ef6feed для rebill-платежей марта/апреля.
- 1 orphan refund `dab644a5` на `SUB-26-MMDQEZ64S8VK` (нет `parent_payment_id` в meta) → попадает в общий `manual_review` пул refunds (35 шт.), отдельной H5-acтивности не требует.
- `not_candidate_reason = already_correct` (все месяцы совпадают; INV-22 / zombie subscriptions Вероники — отдельный сценарий, **out of scope H5**).

## 7. STOP-guards (применяются как `manual_review`, не блок отчёта)

Подтверждено в выборке:

| Guard | Hits |
|---|---|
| `provider_payment_id` пустой | 0 (партиал-уник не пропустит, проверено) |
| `payment.user_id ≠ order.user_id` | 0 |
| Duplicate REBILL by pid (несколько уже существующих) | 0 |
| Refund parent не найден (orphan) | 35 |
| `Σ|refund| > parent.amount` | n/a (orphan'ы не резолвятся) |
| Перенос rebill снизит initial.paid_amount некорректно (initial без non-refund payment) | 0 (rn=1 у каждого initial-order остаётся) |
| Tariff/currency/user mismatch с existing REBILL | 0 |
| Затрагивает entitlements/subscriptions_v2/Telegram | 0 (H5 их не пишет; проверено сверкой checksum'ов после Stage 2) |

Уточнение по правке #5: ни у одного initial-order не образуется ситуация «без non-refund payment». Initial keeps `rn=1` платёж.

## 8. Pre-state checksums (по 62 affected users; неизменность доказывается в H5.1 post-state)

```
payments_v2 (id|order_id|amount|refunded_amount|transaction_type)  md5 = 8435bb6cb4cc737e90fe3cc50860af47
orders_v2   (id|status|paid_amount|order_number|meta.deal_month)   md5 = e2e15331c9eab49e27f0269249a4d9d5

subscriptions_v2  rows = 456
  Σ epoch(access_end_at)       = 787 775 646 072
  count(access_end_at IS NULL) = 11           -- inactive/legacy

entitlements      rows = 405
  Σ epoch(expires_at)          = 721 480 200 523
  count(expires_at IS NULL)    = 0

users in scope = 62
```

**Инвариант H5.2 (post-state)**: оба `epoch_sum` и оба `null_count` для `subscriptions_v2.access_end_at` и `entitlements.expires_at` — без изменений. Иначе → rollback.

## 9. Executive summary (правка #12)

```
total_candidates              : 72
  create_rebill_order         : 72   (71 rn>1 + 1 initial_offset)
  relink_to_existing_rebill   : 0
  refund_repairs (canonical)  : 1    (паттерн «refund переезжает с parent»)
  refund_repairs orphan→review: 35
  skip_already_correct        : 309
  skip_already_materialized   : 176
  manual_review (refund orphan): 35
affected_users                : 62
affected_parent_orders        : 71
distinct_tariffs              : 4
sum_amount_to_split           : 16 410.00 BYN
months_affected               : 2026-03 (2), 2026-04 (2), 2026-05 (68)
duplicate_rebill_by_pid       : 0
candidates_without_parent     : 0
out_of_scope_user_mismatch    : 0
```

## 10. Запреты Stage 1 (соблюдено)

- DML: 0 (только SELECT)
- INSERT/UPDATE orders/payments/refunds: 0
- entitlements / subscriptions_v2 / Telegram / access_rules / provider_subscriptions: read-only
- provider API: 0
- secrets / `BEPAID_REBILL_MATERIALIZATION`: не трогалось

## 11. Стейджинг для H5.1 (предварительный, не утверждать сейчас)

При утверждении Stage 2 (отдельный план H5.1):

- INSERT 72 `orders_v2` `REBILL-<first12(provider_payment_id)>`, `meta.source='h5_historical_repair'`, `meta.materialized_from_payment_id=<payments_v2.id>`, `deal_date=payment.paid_at`, pipeline/stage = parent.
- UPDATE 72 `payments_v2.order_id` → новый REBILL-id.
- 35 orphan refund-rows — НЕ трогаем (отдельная manual-review задача).
- 1 canonical refund — переедет вместе с parent, если parent в свою очередь попадёт под H5 (в текущем snapshot — нет, parent уже в правильном order).
- audit `orders.h5_historical_rebill_repaired` × 72 + summary.
- Решение по `meta.do_not_grant_access=true` — отложено в H5.1 (правка #9): нужно подтвердить, что флаг не сломает отчёты/карточку сделки и не приведёт к двойному вызову `grant-access-for-order` через любой другой путь.
- Rollback SQL прилагается к H5.1, восстанавливает прежние `order_id` платежей и удаляет 72 REBILL-orders по `meta.source='h5_historical_repair'`.

## 12. DoD Stage 1

- ✅ Полный список 72 склеенных сделок 2026 с planned_action.
- ✅ manual_review список (35 orphan refunds) с причиной.
- ✅ Spot-check Лариса + Вероника с `not_candidate_reason`.
- ✅ Pre-state checksums (4 значения) зафиксированы.
- ✅ DML/migrations/provider API = 0.
- ✅ Proof создан.

**Execute не запускать без отдельного H5.1 approve.**
