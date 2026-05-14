# INV: Deal linkage desync — lori-30@tut.by (Лариса Конобеева)

Date: 2026-05-14
Status: **Stage 1 — read-only reconcile complete**. Stage 2 (data repair) — awaits approval.

## Контекст жалобы

Карточка сделки `SUB-26-MMOP3Z026XWH` показывает 2 платежа за 250 BYN (13.03 и 13.05) со статусом «Оплачен», без возврата. Возврат за 14.05 виден только в общем списке платежей контакта. Пользователь спросил: почему расхождение и сделана ли сверка с bePaid.

## Ключевые UUID

- user_id: `e748983f-8409-49b6-b5f5-88a7c95920b0`
- profile_id: `71b21654-91fe-41b5-803d-1b2afcfe7430`
- product_id: `11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club)
- tariff_id: `7c748940-dcad-4c7c-a92e-76a2344622d3`
- offer_id: `bc0f7a90-df41-4a86-b2ea-2a1234d0d534`

### Сделки (orders_v2)

| order_id | order_number | created_at | deal_date | status | paid_amount |
|---|---|---|---|---|---|
| 11adac7b-3f31-4267-b8e2-da54bba4b57c | SUB-26-MMOP3Z026XWH | 2026-03-13 09:29 | 2026-03-13 | paid | 250.00 |
| 06b224ab-1f77-4d0f-8fd9-4fa94bafae74 | REBILL-0e530a8c-3eb | 2026-04-14 03:00 | 2026-04-14 | paid | 250.00 |
| 15927402-5566-4810-97cf-f1d5997e80ed | SUB-LINK-MP2YGAG4   | 2026-05-12 18:19 | 2026-05-12 | paid | 250.00 |

### Подписки (subscriptions_v2)

| sub_id | bepaid_subscription_id | created_at | status | auto_renew | access_end_at | extended_by_orders |
|---|---|---|---|---|---|---|
| ceb80b6f-a94b-4aab-ba02-903b52529458 | sbs_d0a38a4774c31891 | 2026-03-13 | canceled (admin 14.05) | false | 2026-06-11 | [11adac7b] |
| b749abfb-43c6-4d16-b1ad-f57f797a00e4 | sbs_e58bb848165cb713 | 2026-05-12 | active | true  | 2026-06-11 | [15927402, 11adac7b] |

## Сверка payments_v2 ↔ bePaid (subset, 2026-03 → 2026-05)

| paid_at | bePaid uid | type | amount | sv2 link by tracking | payments_v2.id | order_id linked | OK? |
|---|---|---|---|---|---|---|---|
| 2026-03-13 09:31 | aa391ec7…a608 | Платёж | 250 | ceb80b6f | 52229463 | 11adac7b (SUB-26-MMOP3Z026XWH) | ✅ |
| 2026-03-14..16 | 3 × failed | Платёж | 250×3 | ceb80b6f | e7e1f3cb / 16ce5a98 / 0c479060 | NULL (failed → не привязываются) | ✅ |
| 2026-04-12..13 | 2 × failed | Платёж | 250×2 | ceb80b6f | 18fa67c9 / cadc3801 | NULL | ✅ |
| 2026-04-14 03:00 | 49c8f8f9…3639 | Платёж | 250 | ceb80b6f | 0e530a8c | 06b224ab (REBILL-0e530a8c-3eb) | ✅ корректный rebill |
| 2026-05-12 09:45 | 80010eae…3f71 | Платёж failed | 250 | b749abfb | 405f1e72 | NULL | ✅ |
| 2026-05-12 21:21 | e3965e9b…f780 | Платёж | 250 | b749abfb | 421d6884 | 15927402 (SUB-LINK-MP2YGAG4) | ✅ |
| **2026-05-13 03:00** | **e2eedd12…b39c** | **Платёж** | **250** | **ceb80b6f** | **7a64cd04** | **11adac7b (SUB-26-MMOP3Z026XWH)** | **❌ должен быть новый REBILL-order** |
| **2026-05-14 11:00** | **6e4a67ff…b9bf** | **Возврат** | **250** | **ceb80b6f** | **49825c85** | **11adac7b** | **❌ должен висеть на REBILL за 13.05; meta.parent_payment_id отсутствует** |

Все 27 строк bePaid находятся в payments_v2; расхождений по самим суммам/uid нет. Десинхрон — только в `order_id`/`parent_payment_id`/`refunded_amount` для майского цикла.

## Корневые дефекты (5)

1. **Duplicate Sub Guard не сработал 12.05** — создана новая bePaid sbs при живой старой sbs того же продукта.
2. **bepaid-webhook autocharge 13.05** пристегнул платёж e2eedd12 к initial-order `11adac7b` вместо создания нового REBILL-order (как было в апреле).
3. **grant-access-for-order 13.05** продлил НОВУЮ подписку `b749abfb` чужим платежом старой sbs (не сматчил `bepaid_subscription_id`).
4. **Refund-row 49825c85**: `meta.parent_payment_id = NULL`, `amount = +250`, `7a64cd04.refunded_amount = 0` — `DealDetailSheet` не находит refund→parent линк.
5. **`deal_date` карточки** показывает «13 мая 05:00» при «Месяц сделки: Март 2026» — потому что чужой майский платёж пристегнут к мартовской сделке (следствие №2).

## Чек-сумма snapshot (before any repair)

```
SELECT md5(string_agg(id::text || '|' || coalesce(order_id::text,'') || '|' || amount::text || '|' || coalesce(refunded_amount::text,'0') || '|' || transaction_type, ',' ORDER BY id))
FROM payments_v2 WHERE user_id = 'e748983f-8409-49b6-b5f5-88a7c95920b0';
```
