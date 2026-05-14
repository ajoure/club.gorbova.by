# Dry-run Data Repair Report — Larisa Konobeeva (DEAL-LINKAGE-LORI-30-2026-05)

**Status:** DRY-RUN ONLY. Никаких записей в БД не выполнено. Approve обязателен перед execute.
**Scope:** только пользователь `e748983f-8409-49b6-b5f5-88a7c95920b0` (lori-30@tut.by).
**Repair batch:** `DEAL-LINKAGE-LORI-30-2026-05`
**Источник правды:** запросы к `orders_v2`, `payments_v2`, `subscriptions_v2` от 2026-05-14.

---

## 0. Контекст (read-only факты)

| Сущность | id | ключевые поля |
|---|---|---|
| March order (мартовская сделка) | `11adac7b-3f31-4267-b8e2-da54bba4b57c` | `SUB-26-MMOP3Z026XWH`, `paid`, `paid_amount=250`, `deal_date=2026-03-13 09:29:45.458+00`, `bepaid_subscription_id=NULL` (в meta=`sbs_d0a38a4774c31891`) |
| March payment | `52229463-188a-4d03-8983-5b584c3433c5` | `aa391ec7…`, 250, succeeded, `paid_at=2026-03-13 09:31:55+00`, `order_id=11adac7b…` |
| May checkout order (новая подписка) | `15927402-5566-4810-97cf-f1d5997e80ed` | оплачен payment `421d6884…`, `paid_at=2026-05-12 18:21:37+00` |
| May 13 payment (виновник) | `7a64cd04-3d08-4c9f-a81b-d50b7383edf6` | provider `e2eedd12-f1dc-4af4-8d3a-feae6956b39c`, 250, succeeded, `paid_at=2026-05-13 03:00:14+00`, **`order_id=11adac7b…` (WRONG)** |
| May 14 refund | `49825c85-07e5-4493-b086-f3cfd79b2545` | provider `6e4a67ff…`, 250 `Возврат средств`, succeeded, `paid_at=2026-05-14 11:00:35+00`, **`order_id=11adac7b…` (WRONG), `meta.parent_payment_id` отсутствует** |
| Old sub (sbs_d0a38a4774c31891) | `ceb80b6f-a94b-4aab-ba02-903b52529458` | `status=superseded`, `canceled_at=2026-05-14 11:00:14.63`, `access_end_at=2026-06-11 20:59:59+00`, `extended_by_orders=[11adac7b…]` |
| New sub (sbs_e58bb848165cb713) | `b749abfb-43c6-4d16-b1ad-f57f797a00e4` | `status=active`, `auto_renew=true`, `access_start_at=2026-05-12 18:21:39.852+00`, `access_end_at=2026-06-11 20:59:59+00`, **`extended_by_orders=[15927402…, 11adac7b…]` (WRONG)**, `last_extension_at=2026-05-13 03:00:16.698`, `last_extension_days=30` |

**Эталонный паттерн REBILL** (уже существует для апрельского ребиля):
`06b224ab-1f77-4d0f-8fd9-4fa94bafae74` → `REBILL-0e530a8c-3eb`, `meta`:
```
materialization_run: rebill_orders_materialization_2026
materialized_from_payment_id: 0e530a8c-3eba-40ed-adeb-518d9f90f473
parent_order_id: 11adac7b-3f31-4267-b8e2-da54bba4b57c
original_parent_deal_month: 2026-03
payment_flow: bepaid_subscription_charge
do_not_grant_access: true
source: rebill_materialization
deal_month: 2026-04
```

---

## 1. Новый REBILL-order (CREATE)

| поле | значение |
|---|---|
| id | новый `gen_random_uuid()` (условно `<NEW_REBILL_ID>`) |
| order_number | `REBILL-7a64cd04-3d0` |
| user_id | `e748983f-8409-49b6-b5f5-88a7c95920b0` |
| product_id | `11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club) |
| tariff_id | `7c748940-dcad-4c7c-a92e-76a2344622d3` (BUSINESS) |
| offer_id | `bc0f7a90-df41-4a86-b2ea-2a1234d0d534` |
| deal_date | `2026-05-13 03:00:14+00` (= paid_at платежа `7a64cd04`) |
| created_at | `now()` |
| status | **`refunded`** (см. п.10) — net=0, paid_amount=250, refunded_amount=250 |
| paid_amount | `250.00` |
| currency | `BYN` |
| bepaid_subscription_id | `sbs_d0a38a4774c31891` (старая подписка) |
| provider | `bepaid` |
| meta | см. ниже |

```jsonc
meta = {
  "materialization_run": "rebill_orders_materialization_2026_repair",
  "materialized_from_payment_id": "7a64cd04-3d08-4c9f-a81b-d50b7383edf6",
  "source_payment_uid": "e2eedd12-f1dc-4af4-8d3a-feae6956b39c",
  "parent_order_id": "11adac7b-3f31-4267-b8e2-da54bba4b57c",
  "original_parent_deal_month": "2026-03",
  "deal_month": "2026-05",
  "payment_flow": "bepaid_subscription_charge",
  "linked_old_subscription_v2": "ceb80b6f-a94b-4aab-ba02-903b52529458",
  "bepaid_subscription_id": "sbs_d0a38a4774c31891",
  "do_not_grant_access": true,
  "refunded_in_full": true,
  "refund_payment_id": "49825c85-07e5-4493-b086-f3cfd79b2545",
  "refund_provider_id": "6e4a67ff-f71a-4edd-9d63-89c16b44b9bf",
  "source": "rebill_materialization_repair",
  "repair_batch": "DEAL-LINKAGE-LORI-30-2026-05"
}
```

**Idempotency / source_event_key:** колонка отсутствует в `orders_v2`. Идемпотентность — через `meta.materialized_from_payment_id` + `meta.source_payment_uid`.
**Proof отсутствия дубликата:** `SELECT … WHERE meta->>'materialized_from_payment_id'='7a64cd04…' OR meta->>'source_payment_uid'='e2eedd12…' OR order_number='REBILL-7a64cd04-3d0'` → **0 строк** (на 2026-05-14).
Финансово: `paid_amount=250`, `refunded_amount=250` (поле в orders_v2 отсутствует — отслеживается через `meta.refunded_in_full=true` + parent payment `refunded_amount`), **net=0**.

---

## 2. Payment `7a64cd04-3d08-4c9f-a81b-d50b7383edf6` — before/after

| поле | before | after |
|---|---|---|
| order_id | `11adac7b-3f31-4267-b8e2-da54bba4b57c` | `<NEW_REBILL_ID>` |
| amount | 250.00 | 250.00 (без изменений) |
| paid_at | 2026-05-13 03:00:14+00 | без изменений |
| provider_payment_id | `e2eedd12-f1dc-4af4-8d3a-feae6956b39c` | без изменений |
| status | succeeded | без изменений |
| refunded_amount | 0 | **250.00** (см. п.3) |
| meta | … | + `repair_batch=DEAL-LINKAGE-LORI-30-2026-05`, `relinked_from_order_id=11adac7b…`, `relinked_at=now()` |

---

## 3. Refund `49825c85-07e5-4493-b086-f3cfd79b2545` — before/after

| поле | before | after |
|---|---|---|
| order_id | `11adac7b-3f31-4267-b8e2-da54bba4b57c` | `<NEW_REBILL_ID>` |
| amount | **+250.00** (положительное) | без изменений (системный стандарт хранит refund положительно, см. payments_v2 row `transaction_type='Возврат средств'`) |
| provider_payment_id | `6e4a67ff…` | без изменений |
| meta.parent_payment_id | отсутствует | **`7a64cd04-3d08-4c9f-a81b-d50b7383edf6`** |
| meta | … | + `repair_batch=…`, `relinked_from_order_id=11adac7b…`, `relinked_at=now()`, `parent_payment_id=7a64cd04…` |
| reference_payment_id | NULL | (опционально) `7a64cd04-3d08-4c9f-a81b-d50b7383edf6` — если стандарт это поле использует; в текущей сверке поле NULL у обоих апрельских записей, поэтому **не трогаем**, чтобы не выйти за scope |

Parent payment `7a64cd04`.refunded_amount: `0 → 250.00`, `refunded_at: NULL → 2026-05-14 11:00:35+00`.

---

## 4. March order `11adac7b-3f31-4267-b8e2-da54bba4b57c` — before/after

| поле | before | after |
|---|---|---|
| status | `paid` | `paid` (без изменений) |
| paid_amount | 250.00 | 250.00 (без изменений) |
| deal_date | `2026-03-13 09:29:45.458+00` | без изменений |
| created_at | `2026-03-13 09:29:45.501805+00` | без изменений |
| связанные payments_v2 | `52229463…` (март), `7a64cd04…` (май, чужой), `49825c85…` (май, чужой) | **только** `52229463-188a-4d03-8983-5b584c3433c5` (март) |
| meta | … | + `repair_log: { batch: 'DEAL-LINKAGE-LORI-30-2026-05', removed_payments: ['7a64cd04…','49825c85…'], removed_at: now() }` |

В UI карточки сделки `SUB-26-MMOP3Z026XWH` после repair: только мартовский платёж 13.03 + правильный месяц «Март 2026», без майских строк.

---

## 5. New sub `b749abfb-43c6-4d16-b1ad-f57f797a00e4` — before/after

| поле | before | after |
|---|---|---|
| status | `active` | без изменений |
| auto_renew | true | без изменений |
| access_start_at | `2026-05-12 18:21:39.852+00` | без изменений |
| access_end_at | `2026-06-11 20:59:59+00` | **`2026-06-11 20:59:59+00` (без изменений)** |
| meta.extended_by_orders | `[15927402…, 11adac7b…]` | **`[15927402…]`** (удаляем только `11adac7b…`) |
| meta.last_extension_at | `2026-05-13 03:00:16.698Z` | `2026-05-12 18:21:39.852Z` (от первичного grant) |
| meta.last_extension_days | 30 | 30 |
| meta | … | + `repair_log: { batch: 'DEAL-LINKAGE-LORI-30-2026-05', removed_extended_by: ['11adac7b…'], removed_at: now() }` |

**Пересчёт access_end_at:** базовый extension от `15927402` (paid_at `2026-05-12 18:21:37+00`) +30d по правилу EOD Minsk = `2026-06-11 20:59:59+00 UTC` (совпадает с текущим). Удаление `11adac7b…` из `extended_by_orders` **не уменьшает access** — уже использованного доступа не отнимает. **Risk = 0. Не STOP.**

Валидные orders для подписки после repair: `[15927402-5566-4810-97cf-f1d5997e80ed]`.

---

## 6. Old sub `ceb80b6f-a94b-4aab-ba02-903b52529458` — read-only confirmation

Не трогаем. Текущее состояние:
- `status=superseded`, `canceled_at=2026-05-14 11:00:14.63+00`, `cancel_reason=NULL`, `meta.bepaid_cancel_source=admin_cancel`
- `access_end_at=2026-06-11 20:59:59+00`, `extended_by_orders=[11adac7b…]`
- `bepaid_subscription_id=sbs_d0a38a4774c31891`

Не реанимируем, не продлеваем, доступ не выдаём. Новый REBILL полностью refunded → **no grant / no extend**.

---

## 7. Audit plan (`audit_logs`)

Все события с `actor_type='system'`, `actor_user_id=NULL`, `meta.repair_batch='DEAL-LINKAGE-LORI-30-2026-05'`, `meta.before` и `meta.after` JSON.

| event_type | target | before | after |
|---|---|---|---|
| `order.created.deal_repair_2026_05` | `orders_v2:<NEW_REBILL_ID>` | `null` | full new row |
| `payment.relinked.deal_repair_2026_05` | `payments_v2:7a64cd04…` | `{order_id:11adac7b…, refunded_amount:0}` | `{order_id:<NEW_REBILL_ID>, refunded_amount:250}` |
| `refund.parent_link_repaired` | `payments_v2:49825c85…` | `{order_id:11adac7b…, meta.parent_payment_id:null}` | `{order_id:<NEW_REBILL_ID>, meta.parent_payment_id:7a64cd04…}` |
| `subscription.access_end_at.recompute` | `subscriptions_v2:b749abfb…` | `{access_end_at:2026-06-11T20:59:59Z, extended_by_orders:[15927402…,11adac7b…]}` | `{access_end_at:2026-06-11T20:59:59Z, extended_by_orders:[15927402…]}` (no-op по access, only meta) |
| `order.payments_unlinked.deal_repair_2026_05` | `orders_v2:11adac7b…` | `{linked_payments:[52229463,7a64cd04,49825c85]}` | `{linked_payments:[52229463]}` |

**6 audit-записей всего** (включая создание REBILL-order).

---

## 8. Rollback plan

Один транзакционный rollback (если execute уже произведён, то обратный пакет — как отдельная транзакция):

1. `UPDATE payments_v2 SET order_id='11adac7b…', refunded_amount=0, refunded_at=NULL, meta=meta - 'repair_batch' - 'relinked_from_order_id' - 'relinked_at' WHERE id='7a64cd04…'`
2. `UPDATE payments_v2 SET order_id='11adac7b…', meta=meta - 'repair_batch' - 'relinked_from_order_id' - 'relinked_at' - 'parent_payment_id' WHERE id='49825c85…'`
3. `UPDATE subscriptions_v2 SET meta = jsonb_set(meta,'{extended_by_orders}','["15927402-5566-4810-97cf-f1d5997e80ed","11adac7b-3f31-4267-b8e2-da54bba4b57c"]'::jsonb) WHERE id='b749abfb…'` (восстановить также `last_extension_at=2026-05-13T03:00:16.698Z`).
4. `DELETE FROM orders_v2 WHERE id='<NEW_REBILL_ID>'` (или `UPDATE … SET meta=meta || '{"archived_by_rollback":true}'::jsonb` — выбираем DELETE т.к. order только что создан и не имеет внешних ссылок кроме перенесённых payments, которые мы уже отвязали).
5. `UPDATE orders_v2 SET meta = meta - 'repair_log' WHERE id='11adac7b…'`
6. Audit `repair.rollback.DEAL-LINKAGE-LORI-30-2026-05` с before=after-state, after=original.

Rollback должен быть проверен на dry-run отдельно перед execute основного repair.

---

## 9. STOP-guards (проверки перед execute)

| guard | текущий статус |
|---|---|
| Уже существует REBILL для `e2eedd12` / `sbs_d0a38a4774c31891` / `2026-05-13` | **PASS** (0 строк) |
| `orders_v2.status` enum поддерживает `refunded` | **PASS** (`enum_range(order_status)` содержит `refunded`) |
| Невозможно атомарно обновить payment/refund/order/subscription | **PASS** план — единая транзакция (`BEGIN; … COMMIT;`); если любой UPDATE затрагивает 0 строк — **STOP + ROLLBACK** |
| Затрагиваются `entitlements` / `access_rules` / `telegram_*` / `payments_v2` сверх перечисленных строк | **PASS** план не трогает эти таблицы; `do_not_grant_access:true` блокирует grant-access-for-order |
| Изменение `b749abfb.access_end_at` уменьшает уже использованный доступ | **PASS** access_end_at не меняется |
| Old sub `ceb80b6f` любые изменения | **PASS** read-only |

Любой failed guard → **STOP, repair не выполняется**, отчёт обновляется и возвращается к approval.

---

## 10. Expected rowcount

| таблица | операция | строк |
|---|---|---|
| `orders_v2` | INSERT (новый REBILL) | **+1** |
| `orders_v2` | UPDATE (`11adac7b…` meta.repair_log) | **1** |
| `payments_v2` | UPDATE order_id (`7a64cd04`, `49825c85`) | **2** |
| `payments_v2` | UPDATE refunded_amount + refunded_at (`7a64cd04`) | **1** (та же строка, что выше — фактически объединено в один UPDATE на `7a64cd04`) |
| `subscriptions_v2` | UPDATE meta (`b749abfb…`) | **1** |
| `audit_logs` | INSERT | **6** (см. п.7) |

Любой иной rowcount → **STOP + ROLLBACK**.

---

## Решение

Dry-run завершён. Изменений в БД нет. **Жду явного approve** перед `BEGIN; … COMMIT;` execute по перечисленным строкам.
