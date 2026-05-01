# training_modules.product_id orphan audit (Diagnose → Dry-run)

Цель: найти модули, у которых `product_id IS NULL`, при этом корень их поддерева
(`parent_module_id IS NULL`) имеет ненулевой `product_id`. Такие модули невидимы
на вкладке «Продукт → Доступы», хотя структурно лежат внутри привязанного тренинга.

## Сводка

| Метрика | Значение |
|---|---|
| orphans_with_owned_root (попадут в backfill) | **1** |
| orphans_under_free_root (не трогаем) | 0 |
| total_descendants (контроль обхода) | 60 |

## Список к исправлению

| id | title | depth | root_title | root_product_id |
|---|---|---|---|---|
| `93078869-94fe-468c-a72a-40cc563d2f06` | Идеологическая работа в бизнесе | 2 | База знаний | `11c9f1b8-0355-4753-bd74-40b42aa53616` |

## SQL для повторного аудита

```sql
WITH RECURSIVE roots AS (
  SELECT id AS root_id, product_id AS root_product_id
  FROM training_modules
  WHERE parent_module_id IS NULL
),
tree AS (
  SELECT tm.id, tm.product_id, r.root_id, r.root_product_id, 1 AS depth
  FROM training_modules tm
  JOIN roots r ON tm.parent_module_id = r.root_id
  UNION ALL
  SELECT tm.id, tm.product_id, t.root_id, t.root_product_id, t.depth + 1
  FROM training_modules tm
  JOIN tree t ON tm.parent_module_id = t.id
  WHERE t.depth < 20
)
SELECT COUNT(*) FROM tree
WHERE product_id IS NULL AND root_product_id IS NOT NULL;
-- after migration: должен быть 0
```

## Защита backfill

- Только `child.product_id IS NULL` AND `parent_module_id IS NOT NULL` AND `root.product_id IS NOT NULL`.
- Никогда не перезаписываем уже заполненный `product_id`.
- Поддеревья «свободных» тренингов (root.product_id IS NULL) не трогаем.
