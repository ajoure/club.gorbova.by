# Buckets B/C — read-only proof (NO repair)

Дата: 2026-05-22 (Minsk)
Status: **read-only**, никаких UPDATE/DELETE не выполнялось.
Cohort: те же фильтры что у Bucket A, но без 5 строк, исправленных в `svetlana_price_bucket_a_execute_2026_05_22.md`, и без entitlement `e21b82fd` (Svetlana, исправлено отдельно).

Размер: **22 entitlements** = 13 (Bucket B) + 9 (Bucket C).

## Почему НЕ чиним массово
Исторически клиенты покупали тариф без всех модулей, а потом отдельно докупали конкретные модули. В этих случаях `full_access` на parent-продукт открыл бы больше прав, чем было оплачено. Каждую строку из B/C нужно разбирать вручную.

## Bucket B — self-scope (13 rows)
`ent_product_id` = product-модуль (064dd768/64d9f812/9187db54/abee24cd/d7effaf4 и т.п.), `historical_module_product_ids = [<тот же product_id>]`. Семантически entitlement УЖЕ ограничен ровно тем модулем, который купили — нет дрейфа, просто избыточная meta. Безопасно оставить как есть.

| entitlement_id | user_id | email | ent_product | prior_order |
|---|---|---|---|---|
| 074f40c8 | 7c53b6af | katerina5515530@gmail.com | 64d9f812 | d9a29949 |
| 1244d5ee | 1502c12e | irkaguzarevich@mail.ru | 9187db54 | 63c36a18 |
| 2922e104 | 5c6e6e0f | irinkazar@inbox.ru | 64d9f812 | 727fe302 |
| 328b9ea0 | 5c6e6e0f | irinkazar@inbox.ru | abee24cd | 12909f3f |
| 460bfaed | e748983f | lori-30@tut.by | 064dd768 | cee45419 |
| 684b905d | 7c53b6af | katerina5515530@gmail.com | d7effaf4 | f1c284d1 |
| 75161a75 | e748983f | lori-30@tut.by | abee24cd | fe4809b1 |
| 80dc7e99 | 7c53b6af | katerina5515530@gmail.com | 064dd768 | 34ae0f30 |
| 95bd3a7b | 5c6e6e0f | irinkazar@inbox.ru | 064dd768 | b5a8eca6 |
| 96679cb7 | 1502c12e | irkaguzarevich@mail.ru | 064dd768 | 4c5209e1 |
| b0c8b114 | 1502c12e | irkaguzarevich@mail.ru | d7effaf4 | 243a2c95 |
| f4ea10ad | 1502c12e | irkaguzarevich@mail.ru | abee24cd | fad67bb7 |
| fac13564 | 7c53b6af | katerina5515530@gmail.com | abee24cd | d2218e8e |

Expected access: limited to single module (как сейчас). Action: **no-op**.

## Bucket C — cross-product / mixed (9 rows)
`historical_module_product_ids` указывают на продукты, отличные от `ent_product_id`, либо смешанные. Требуют manual review: какой тариф фактически куплен, какие модули входили в его scope на момент покупки, какие были докуплены отдельно.

См. SQL для полного списка:
```sql
WITH cohort AS (
  SELECT e.id, e.user_id, e.product_id, e.meta->>'prior_purchase_order_id' AS prior_order_id,
         e.meta->'historical_module_product_ids' AS hpids
  FROM entitlements e
  WHERE e.status='active'
    AND e.meta->>'scope_resolution_mode'='module_scope_only'
    AND e.meta->>'prior_purchase_match_type'='direct'
    AND e.id NOT IN (<6 fixed>)
)
SELECT * FROM cohort
WHERE NOT (hpids @> to_jsonb(ARRAY[product_id::text]) AND jsonb_array_length(hpids)=1);
-- 9 rows
```

Для каждой строки нужно собрать:
- prior `order.tariff_id` + список модулей, входивших в тариф на дату покупки;
- отдельно докупленные модули (orders_v2 same user, child-products);
- expected_access: `full_parent` / `limited_modules` / `manual_review`.

Действие: **backlog**, отдельный sweep после согласования бизнес-правил merge tariff-scope ↔ historical_module_product_ids. Текущее состояние корректно (default-deny на не входящие модули), пользователь не теряет ранее купленный доступ.

## Decision
- Bucket B: оставить, no-op. Семантика верна.
- Bucket C: оставить, перевести в backlog `.lovable/backlog/buckets_c_cross_product_module_scope_review.md` (создать при следующем подходе).
