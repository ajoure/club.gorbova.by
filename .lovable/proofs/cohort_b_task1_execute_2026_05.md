# Cohort B — Task 1 Execute Proof (2026-05)

3 paid_without_payment кейса исправлены. Каждый — отдельная транзакция (DO-блок)
с SELECT FOR UPDATE, повторными guards, rowcount=1, audit_logs before/after,
RAISE EXCEPTION → ROLLBACK при любом несовпадении.

## Case 1.1 — link payment c42ea072 → order 97e22bb3

| Field | Before | After |
| ----- | ------ | ----- |
| `payments_v2(c42ea072).order_id` | NULL | `97e22bb3-9b9d-4bd1-a01a-e0eda7c0145c` |
| `payments_v2(c42ea072).status`   | succeeded | succeeded |
| `orders_v2(97e22bb3).status`     | paid | paid |

- rowcount = 1 ✅
- audit: `orders.repair_link_payment_2026_05` (case 1.1)
- guards: `payment.order_id IS NULL`, `payment.status='succeeded'`,
  `order.status='paid'`, no other order with same `meta.payment_id`.

## Case 1.2 — relink subscription cd8791aa: c0af8ad4 → 1ea274b1

| Field | Before | After |
| ----- | ------ | ----- |
| `subscriptions_v2(cd8791aa).order_id` | `c0af8ad4-fb04-4c13-bc6e-7721ca1e8da5` | `1ea274b1-9720-4258-baf4-d3e49cb754b5` |
| `subscriptions_v2(cd8791aa).status`   | active | active |

- rowcount = 1 ✅
- audit: `subscriptions.repair_relink_canonical_order_2026_05` (case 1.2)
- guards: lock 3 строк (sub + 2 orders); legacy linkage match; canonical
  имеет succeeded payment; canonical не имеет другой подписки.

## Case 1.3 — order 02302928: paid → canceled

| Field | Before | After |
| ----- | ------ | ----- |
| `orders_v2(02302928).status` | paid | canceled |
| meta.repair_2026_05.action | — | `status_correction_paid_to_canceled` |

- rowcount = 1 ✅
- audit: `orders.repair_status_correction_2026_05` (case 1.3)
- guards: `payments=0`, `subscriptions=0`, `access_grant_ledger=0`
  (через `order_id` и `source_order_id`).

## audit_logs proof (свежие 3 записи)

```
orders.repair_link_payment_2026_05               case=1.1  2026-05-03 13:15:22 UTC
subscriptions.repair_relink_canonical_order_2026_05  case=1.2  2026-05-03 13:15:22 UTC
orders.repair_status_correction_2026_05          case=1.3  2026-05-03 13:15:22 UTC
```

## Пересчёт Cohort B (после repair)

| Подгруппа | Было | Стало | Δ |
| --------- | ---- | ----- | -- |
| `has_subscription_ref` | 42 | 42 | 0 |
| `has_blocking_audit` (без sub-ref) | 18 | 18 | 0 |
| `paid_without_payment` | 3 | **1** | −2 |
| `unclassified` (новый бакет) | 0 | 1 | +1 |
| **Total Cohort B** | **63** | **62** | −1 |

### Расшифровка изменений

- **Case 1.1 (`97e22bb3`)** — больше не `paid_without_payment`: теперь у order
  есть привязанный succeeded payment → выпал из Cohort B полностью.
- **Case 1.2 (`c0af8ad4`)** — sub перепривязана, но сам order остался
  `paid` без своего платежа (это легаси-дубль, теперь без sub-ref).
  Остался в `paid_without_payment = 1`. **Безопасный кандидат на удаление**
  в следующей задаче.
- **Case 1.3 (`02302928`)** — переведён в `canceled`, выпал из
  `paid_without_payment`. Теперь это orphan `canceled` без sub-ref и
  без blocking audit → попадает в **unclassified** = безопасный
  кандидат на удаление (Cohort A-подобный).

### Remaining `paid_without_payment` (1 строка)

| id | order_number | status | repair_reason | superseded |
| -- | ------------ | ------ | ------------- | ---------- |
| `c0af8ad4-fb04-4c13-bc6e-7721ca1e8da5` | ORD-26-MKDNM34Z | paid | bepaid_uid_collision_legacy_duplicate | true |

`superseded_by_repair=true`, sub уже отвязана → безопасно удалить
в Задаче 2 вместе с остальными pre-orders (вырастет до **18+1+1 = 20** кандидатов
на удаление).

## DoD Задачи 1

- [x] 3 отдельные транзакции (3 DO-блока), не bulk-update
- [x] SELECT FOR UPDATE по всем изменяемым строкам
- [x] rowcount=1 проверен в каждом блоке
- [x] audit_logs before/after на каждый кейс
- [x] ROLLBACK-safe (RAISE EXCEPTION при несовпадении)
- [x] Пересчёт Cohort B выполнен (62 vs было 63)
- [x] Старые числа 42/18/3 не используются для следующей задачи
- [x] SQL before/after зафиксирован

## Готовность к Задаче 2

Расширенный список безопасных к удалению (после approve):
- 16 × `bepaid.subscription_checkout.create` (из has_blocking_audit)
- 1 × `payment_checkout.subscription_precreate_failed` (bbb85f04)
- 1 × `c0af8ad4` (legacy-дубль, sub уже relinked)
- 1 × `02302928` (orphan canceled после repair)

= **19 строк** кандидатов. `5aa1c624` (admin duplicate) — отдельная Задача 3.
