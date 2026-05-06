# Module Scope IDs Repair — Execute Proof

**Date:** 2026-05-06 (Minsk)
**Migration:** `module_scope_ids_repair_2026_05`
**Audit actor_label:** `module_scope_ids_repair_2026_05`
**Audit action:** `training_content.module_scope_ids_repaired`
**Backup:** `.lovable/proofs/module_scope_ids_repair_backup_2026_05.json` (60 rows)

## 1. Cohort filter (UUID-only)

```sql
WHERE product_id IN (
  '064dd768-de8b-40db-89bc-f8d4a7e442ba',
  '64d9f812-617c-41a8-b3dc-bb113156d6f3',
  '9187db54-8f57-42eb-bbcb-d7103d2459a9',
  '99f1f156-f384-417e-bdf8-9203eb3c9d42',
  'abee24cd-5c8b-4111-a6cb-7dee7acf168c',
  'd7effaf4-9be0-4ce2-971b-e02fe2a85a9a',
  'f833c846-a78d-4096-9dac-b8417d588371'
)
AND meta->>'scope_resolution_mode' = 'module_scope_only'
AND meta->'historical_module_product_ids' @> to_jsonb(ARRAY[product_id::text])
```

Никаких условий по product `code`/`slug`/`name`.

## 2. Mapping product_id → target training_module_id

| product_id | product_name | training_module_id | repaired |
|---|---|---|---|
| `064dd768-de8b-40db-89bc-f8d4a7e442ba` | Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Производство | `a4a5102d-fdb1-4171-a0de-f6e151155431` | 15 |
| `64d9f812-617c-41a8-b3dc-bb113156d6f3` | Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Грузо- и пассажироперевозки | `8f71d4a8-2358-4a1a-9082-e4b501909bb1` | 8 |
| `9187db54-8f57-42eb-bbcb-d7103d2459a9` | Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Общепит | `841650a9-9f83-4c6d-9093-32fa04f87712` | 5 |
| `99f1f156-f384-417e-bdf8-9203eb3c9d42` | Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: ПВТ | `b1199440-2fb7-49df-8034-7251f22d29f0` | 1 |
| `abee24cd-5c8b-4111-a6cb-7dee7acf168c` | Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Розничная торговля | `1ede03b4-03fc-4386-89a1-0f3f198d9ced` | 7 |
| `d7effaf4-9be0-4ce2-971b-e02fe2a85a9a` | Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Маркетплейсы | `4c97d21c-ce30-4d96-8487-f810ae33b563` | 16 |
| `f833c846-a78d-4096-9dac-b8417d588371` | Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Строительство | `b7bae7fd-3a39-4438-8ec6-ced99f79c327` | 8 |

**Total repaired: 60**

## 3. Verify (post-execute)

| metric | value |
|---|---|
| `repaired_total` (entitlements with `meta.module_scope_ids_repaired_at`) | **60** |
| `audit_rows` (`actor_label='module_scope_ids_repair_2026_05'`) | **60** |
| `still_broken` (cohort still has product_id in historical_module_product_ids) | **0** |
| Distinct `scope_resolution_mode` after fix | `module_scope_only` (single value, preserved) |

## 4. Invariants (preserved)

- `scope_resolution_mode` = `module_scope_only` — unchanged.
- `status`, `expires_at`, `source_type`, `source_rule_id` — untouched.
- Никаких `full_tariff_scope` upgrade'ов; full-доступ не выдан.
- Writers (`grant-access-for-order`, retroapply, rule_engine, subscription writers) — не тронуты.
- Меняли строго: `meta.historical_module_product_ids` и
  `meta.module_scope_ids_repaired_at`.

## 5. Out of scope (NOT in this batch)

- `product_id = 7101ed3c-7839-4a74-ad95-aa0660369b22` (20 entitlements with
  `module_scope_only` on parent product). Семантически отдельный кейс,
  требует отдельного approve.
- Корневой fix retroapply / rule_engine writers — отдельная задача.
- Legacy product code/slug в существующем коде/документах — backlog
  `.lovable/backlog/remove_legacy_product_code_mentions_2026_05.md`.

## 6. Hardcode policy gate

В этом proof и в исходниках миграции отсутствуют запрещённые product
code/slug. Используются только UUID и отображаемые `product_name`.

Grep gate (executed in next exec step):
```
rg -n "$LEGACY_PRODUCT_TOKENS" .lovable/proofs/module_scope_ids_repair_execute_2026_05.md
# expected: 0 matches
```

## 7. Memory

Создан `mem://architecture/standard/no-product-code-in-new-artifacts`,
ссылка добавлена в `mem://index.md` → Core.

## 8. UI verify (manual)

Затронутые пользователи должны увидеть в «Моя библиотека» карточки 7
указанных продуктов (целевой `training_module_id` теперь матчится в
`useTrainingContentRules`). Полный список user_id — в backup-файле.
