# Bucket A execute — direct parent-purchase misclassified as module_child

Дата: 2026-05-22 (Minsk)
Batch: `svetlana_price_bucket_a_2026_05_22`
Audit action: `entitlement.scope_repair` · actor_type=`system` · actor_label=`svetlana_price_bucket_a_2026_05_22`

## Бизнес-правило
Если active entitlement создан на parent-продукт, `prior_purchase_match_type='direct'`, `prior_purchase_order_id` указывает на paid order того же parent-продукта, а `historical_module_product_ids` содержат только child-модули этого parent — это ошибка retroapply. Корректный режим = `full_access`.

## Cohort (rowcount guard = 5)

| entitlement_id | user_id | email | ent_product | hpids | prior_order |
|---|---|---|---|---|---|
| 5875992d-7dbc-4081-93b5-184732cc5d16 | 7c53b6af-92d0-4a8d-881f-3fe9de45dffd | katerina5515530@gmail.com | 7101ed3c (ЦБ 1ст 2.0) | [abee24cd, 064dd768, d7effaf4] | 4b697bb6 |
| 6b7960e6-66d2-4da1-8028-2fb14256d38a | 5c6e6e0f-7b19-4ebf-957c-fa491c7e52cb | irinkazar@inbox.ru | 7101ed3c | [f833c846] | 35a9f30a |
| 7a7f5865-d9f8-40a4-b02a-8eb80230d49e | 13c5a43d-a933-4155-88d6-97a9cf109319 | kaplin@tut.by | 7101ed3c | [все 8 children] | b8fe67dd |
| a2755991-5a3e-448a-a1c7-a4d47652c654 | e16334e2-648d-428b-882c-43ffe0b9861d | 6394537@gmail.com | 7101ed3c | [64d9f812, 064dd768] | c7569e6f |
| de153a26-971c-44c1-93e0-24e0c2528e8c | baacd7a4-a99e-46f8-9de8-58e8990cdcbd | a5153253@yandex.by | 7101ed3c | [abee24cd, f833c846] | 455f7364 |

## Execute (выполнено)

```sql
UPDATE entitlements e
SET meta = e.meta || jsonb_build_object(
  'scope_resolution_mode','full_access',
  'scope_repair_reason','direct_parent_purchase_misclassified_as_module_child_2026_05_22',
  'scope_repair_previous_mode', e.meta->>'scope_resolution_mode',
  'scope_repair_previous_hpids', e.meta->'historical_module_product_ids',
  'scope_repair_batch','svetlana_price_bucket_a_2026_05_22'
)
WHERE e.id IN (<5 ids>);
-- + audit_logs INSERT (5 rows, action=entitlement.scope_repair)
```

## Verify

| metric | expected | actual |
|---|---|---|
| entitlements switched `module_scope_only → full_access` | 5 | **5** |
| `meta.scope_repair_previous_mode = 'module_scope_only'` | 5 | **5** |
| audit_logs (actor_label=batch, action=entitlement.scope_repair) | 5 | **5** |
| дубль-entitlements на тот же (user, product=7101ed3c) | 0 | **0** |
| expires_at изменился | 0 | 0 |

UI-эффект: 5 пользователей видят полный контент «ЦБ 1ст 2.0» (все модули), а не один подмножество. Telegram/billing не затронуты.

## Rollback
Точечный по id: `meta.scope_resolution_mode = meta->>'scope_repair_previous_mode'`, `historical_module_product_ids = meta->'scope_repair_previous_hpids'`.

## Out of scope
- Bucket B (self-scope, 13 rows) и Bucket C (cross-product, 9 rows) — отдельный read-only proof `svetlana_price_buckets_bc_readonly_proof_2026_05_22.md`. Не модифицированы.
- Корневой fix retroapply / rule_engine writers — backlog.
