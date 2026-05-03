# Cohort B — Task 2 Dry-Run (2026-05)

Read-only. Никаких мутаций. Снапшот построен после Task 1 Execute.

## Скоуп

19 строк `orders_v2`, безопасных к удалению. Все прошли strict guards:
`payments_v2 = 0`, `subscriptions_v2 (order_id / origin_order_id / extended_by_orders) = 0`,
`access_grant_ledger (order_id / source_order_id) = 0`,
`entitlements (meta.order_id / meta.source_order_id) = 0`.

## Разбивка по reason

| reason | count |
| ------ | ----- |
| `bepaid_pre_order` (audit `bepaid.subscription_checkout.create`, без charge) | 16 |
| `precreate_failed` (audit `payment_checkout.subscription_precreate_failed`) | 1 |
| `legacy_duplicate_relinked` (`c0af8ad4`, sub перепривязана в Task 1.2) | 1 |
| `orphan_canceled_after_repair` (`02302928`, переведён в canceled в Task 1.3) | 1 |
| **Total** | **19** |

## Полный список (snapshot, заморожен для Execute)

| # | id | order_number | status | reason | created_at | bepaid_uid |
| -- | -- | ------------ | ------ | ------ | ---------- | ---------- |
| 1 | 72d76f96-5bbf-4ef8-b7f2-0e1c2b512574 | SUB-26-ML82GRABP6N4 | pending | bepaid_pre_order | 2026-02-04 13:31 | — |
| 2 | 50e89997-451b-4647-a68f-429846663219 | SUB-26-ML85BMNATNSZ | pending | bepaid_pre_order | 2026-02-04 14:51 | — |
| 3 | cb390d13-4822-41a5-a734-1aa9b47ac560 | SUB-26-ML869IGPM8ZD | pending | bepaid_pre_order | 2026-02-04 15:18 | — |
| 4 | 9857235f-ba79-438f-9049-5a4938e663f1 | SUB-26-ML88YEVEHCK1 | pending | bepaid_pre_order | 2026-02-04 16:33 | — |
| 5 | 1e0926a0-0c78-4956-aed2-b559de729160 | SUB-26-ML88ZKCVOC5D | pending | bepaid_pre_order | 2026-02-04 16:34 | — |
| 6 | e5bec945-3cbd-4198-a540-c98ae749c94c | SUB-26-ML9959EN054U | pending | bepaid_pre_order | 2026-02-05 09:26 | — |
| 7 | c2363c0f-224c-4553-a467-858f7ccac0ef | SUB-26-MLP7HEQQ6JRO | pending | bepaid_pre_order | 2026-02-16 13:24 | — |
| 8 | c9f419a1-f5fa-4c19-9028-de78f8ffeefc | SUB-26-MLXRENVVMZT2 | pending | bepaid_pre_order | 2026-02-22 13:04 | — |
| 9 | 1203a81b-6d0c-472f-871a-5c750f243db0 | SUB-26-MLXRK8M9ST5E | pending | bepaid_pre_order | 2026-02-22 13:08 | — |
| 10 | 607547b2-3e01-4ea0-9be0-851d9d2c5a91 | SUB-26-MLXS0P42TNII | pending | bepaid_pre_order | 2026-02-22 13:21 | — |
| 11 | dc9731d4-e3d6-4a69-a51c-3e98a2c6f8a8 | SUB-26-MMD6E6IHK8EA | pending | bepaid_pre_order | 2026-03-05 08:00 | — |
| 12 | b72d69d0-cb11-4203-89dd-2150e153f773 | SUB-26-MMD6EZQR0QE8 | pending | bepaid_pre_order | 2026-03-05 08:00 | — |
| 13 | 7728fff7-554a-4207-91cf-9551184283e7 | SUB-26-MMTCMNX55JYY | pending | bepaid_pre_order | 2026-03-16 15:39 | — |
| 14 | 345fa412-3ef8-40b4-b1b0-8cd2461f8b8f | SUB-26-MN7WWLGQZ9RT | pending | bepaid_pre_order | 2026-03-26 20:15 | — |
| 15 | 20cf5129-80b5-45b7-b71c-b15ead598c23 | (SUB-…) | pending | bepaid_pre_order | … | — |
| 16 | 2db48c49-1b15-4150-a4c1-b1bd0a75b31d | (SUB-…) | pending | bepaid_pre_order | … | — |
| 17 | c0af8ad4-fb04-4c13-bc6e-7721ca1e8da5 | ORD-26-MKDNM34Z | paid | legacy_duplicate_relinked | 2026-01-14 | sbs_2c7191865864fef9 (legacy) |
| 18 | 02302928-7d5d-4bc0-b2ab-c58029b491ac | ORD-ADM-1769114549787 | canceled | orphan_canceled_after_repair | 2026-01-22 | — |
| 19 | bbb85f04-8366-4617-b377-f379ed4b91e9 | SUB-LINK-MOKBHI8E | failed | precreate_failed | … | — |

## Per-row safety verification (агрегат)

| reason | total | payments=0 | subs=0 | ledger=0 | entitlements=0 |
| ------ | ----- | ---------- | ------ | -------- | -------------- |
| bepaid_pre_order | 16 | 16 ✅ | 16 ✅ | 16 ✅ | 16 ✅ |
| precreate_failed | 1 | 1 ✅ | 1 ✅ | 1 ✅ | 1 ✅ |
| legacy_duplicate_relinked | 1 | 1 ✅ | 1 ✅ | 1 ✅ | 1 ✅ |
| orphan_canceled_after_repair | 1 | 1 ✅ | 1 ✅ | 1 ✅ | 1 ✅ |

## Payment provider reconciliation check

- `bepaid_pre_order`: ни у одной из 16 строк нет `meta.bepaid_uid` /
  `meta.bepaid_subscription_id` (audit-запись фиксировала *попытку*
  открыть чекаут, но `subscription_id` от bePaid так и не получен).
  **Reconciliation impact: нет** — bePaid не знает об этих записях.
- `precreate_failed` (`bbb85f04`): чекаут оборвался до ответа bePaid,
  никакого external id не существует.
- `c0af8ad4`: `meta.bepaid_subscription_id = sbs_2c7191865864fef9`
  принадлежит **другой** подписке (canonical sub `cd8791aa` теперь
  использует `sbs_4665c1ef51f08fb1`). Legacy uid сохранится в
  `meta.repair_2026_05` каноничного order через предыдущий repair —
  проверка истории в bePaid останется возможной по audit_logs.
- `02302928`: 3DS-redirect не завершён, у bePaid нет успешной транзакции.

**Итог:** удаление не разрушает reconciliation ни по одному провайдеру.

## Telegram / access side effects

- 0 строк в `access_grant_ledger` (включая `source_order_id`).
- 0 строк в `entitlements` через `meta.order_id` / `meta.source_order_id`.
- 0 строк в `subscriptions_v2` через `order_id` / `origin_order_id` /
  `extended_by_orders`.
- Telegram grants идут через `subscriptions_v2` → ни одна не зависит
  от этих 19 orders.

## Execute план (после approve)

Single transaction, single migration:

1. `INSERT INTO public._orders_orphan_cleanup_2026_05_backup`
   (та же backup-таблица, что и Cohort A; добавим колонку
   `cohort text default 'A'`, для Task 2 — `'B'` если нужно, иначе
   создадим новую `_orders_cohort_b_cleanup_2026_05_backup`).
2. `INSERT INTO audit_logs(action='orders.cohort_b_orphan_delete_2026_05',
   meta=jsonb_build_object('order_id', ..., 'reason', ..., 'snapshot', row_to_json))`
   — 19 строк.
3. `DELETE FROM orders_v2 WHERE id = ANY($exact_19_ids)`.
4. Гард: `backup_count=19 AND audit_count=19 AND deleted=19` иначе
   `RAISE EXCEPTION` → ROLLBACK.

ID-list (frozen):
```
72d76f96-5bbf-4ef8-b7f2-0e1c2b512574
50e89997-451b-4647-a68f-429846663219
cb390d13-4822-41a5-a734-1aa9b47ac560
9857235f-ba79-438f-9049-5a4938e663f1
1e0926a0-0c78-4956-aed2-b559de729160
e5bec945-3cbd-4198-a540-c98ae749c94c
c2363c0f-224c-4553-a467-858f7ccac0ef
c9f419a1-f5fa-4c19-9028-de78f8ffeefc
1203a81b-6d0c-472f-871a-5c750f243db0
607547b2-3e01-4ea0-9be0-851d9d2c5a91
dc9731d4-e3d6-4a69-a51c-3e98a2c6f8a8
b72d69d0-cb11-4203-89dd-2150e153f773
7728fff7-554a-4207-91cf-9551184283e7
345fa412-3ef8-40b4-b1b0-8cd2461f8b8f
20cf5129-80b5-45b7-b71c-b15ead598c23
2db48c49-1b15-4150-a4c1-b1bd0a75b31d
c0af8ad4-fb04-4c13-bc6e-7721ca1e8da5
02302928-7d5d-4bc0-b2ab-c58029b491ac
bbb85f04-8366-4617-b377-f379ed4b91e9
```

## Post-Execute verify (план)

- `SELECT count(*) FROM orders_v2 WHERE id = ANY($19)` → 0.
- Backup count = 19.
- Audit `orders.cohort_b_orphan_delete_2026_05` count = 19.
- Пересчёт Cohort B:
  - ожидаем total = **62 − 19 = 43**;
  - `has_subscription_ref = 42`;
  - `has_blocking_audit (без sub-ref) = 0` (16+1 уйдут);
  - `paid_without_payment = 0`;
  - `unclassified = 0`;
  - остаётся: **42 has_subscription_ref + 1 admin duplicate (`5aa1c624`) = 43**.
- `payments_v2 / subscriptions_v2 / entitlements / access_grant_ledger`
  diff = 0.

## DoD dry-run

- [x] Полный список 19 строк с reason/category.
- [x] Все 4 guard-проверки = 0 для каждой строки.
- [x] Telegram/access/Reconciliation impact: нет.
- [x] Никаких мутаций.
- [x] Frozen id-list для Execute.

**Жду approve на Execute.**
