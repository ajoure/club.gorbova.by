# Module Scope IDs Repair — Dry-run (Option B)

**Date:** 2026-05-06 (Minsk)
**Scope:** entitlements c `meta.scope_resolution_mode='module_scope_only'`,
у которых `historical_module_product_ids` ошибочно содержит **product_id**
(элементы существуют в `products_v2`) вместо реальных `training_modules.id`.

## 0. Hypothesis

Retroapply / rule_engine при формировании `historical_module_product_ids` для
standalone-модульных продуктов записал туда сам `product_id`, а не `module_id`
корневого тренинга. В resolver (`useTrainingContentRules.ts`) сверка идёт по
`training_modules.id` ⇒ ни один модуль не матчится ⇒ карточка скрыта в ЛК
(симптом «Маркетплейсы не видно»).

## 1. Affected cohort (read-only)

| product_id | top-level module title | proposed module_id | affected entitlements |
|---|---|---|---|
| 064dd768… ПРОИЗВОДСТВО | a4a5102d… | 15 |
| 64d9f812… Грузо/пасс.перевозки | 8f71d4a8… | 8 |
| 9187db54… ОБЩ. ПИТАНИЕ | 841650a9… | 5 |
| 99f1f156… ПВТ | b1199440… | 1 |
| abee24cd… РОЗН. ТОРГОВЛЯ | 1ede03b4… | 7 |
| d7effaf4… **Маркетплейсы** | 4c97d21c… | 16 |
| f833c846… Строительство | b7bae7fd… | 8 |

**Всего к патчу: 60 entitlements по 7 standalone-модулям CB20.**

## 2. Excluded from auto-fix

- `7101ed3c-7839-4a74-ad95-aa0660369b22` (CB20 main, 20 entitlements).
  Это сам родительский продукт тренинга, не standalone-модуль. Если
  `module_scope_only` стоит на CB20-main с `hist=[cb20_product_id]` — это
  отдельная семантическая ошибка (вероятно должно быть `full_tariff_scope`,
  либо явный module_scope с конкретным историческим модулем). **Решается
  отдельным approve, в этом батче НЕ трогаем.**

## 3. Batch source

`source_type` распределение на 60 affected: смесь `retroapply`, `rule_engine`
и NULL. `meta.source_event_key` отсутствует у всех ⇒ привязка к конкретному
RETROAPPLY-2026-04-10-66d2d335 не подтверждается. Это более широкий
исторический баг, а не один батч.

## 4. Proposed change (per entitlement)

```
UPDATE entitlements
SET meta = jsonb_set(
  jsonb_set(meta,
    '{historical_module_product_ids}',
    to_jsonb(ARRAY[<top_module_id_for_product>]::uuid[]), true),
  '{module_scope_ids_repaired_at}',
  to_jsonb(now()::text), true)
WHERE id = <entitlement_id>;
```

- `scope_resolution_mode` = `module_scope_only` — **не меняется**
- `expires_at` / `status` — **не меняются**
- `source_type` / `source_rule_id` lineage — **не меняется**
- Никаких `full_tariff_scope`, никакого расширения доступа.

## 5. Audit log entry per row

```
INSERT INTO audit_logs(action, actor_type, actor_label, target_user_id, meta)
VALUES ('training_content.module_scope_ids_repaired', 'system',
  'module_scope_ids_repair_2026_05', <user_id>,
  jsonb_build_object(
    'entitlement_id', <id>,
    'product_id', <product_id>,
    'old_historical_module_product_ids', <old>,
    'new_historical_module_product_ids', <new>));
```

## 6. Backup before write

Перед UPDATE — селект полного `meta` всех 60 entitlements в текстовый
снапшот в proof-файл `module_scope_ids_repair_backup_2026_05.json` (через
`COPY ... TO STDOUT`).

## 7. Expected post-verify

- `useTrainingContentRules` для каждого user-а резолвит синтетическое
  `module_scope_only` правило с `allowed_module_ids = [top_module_id]`.
- Модуль (Маркетплейсы / Производство / …) появляется в библиотеке.
- `module_scope_only` остаётся — full-доступ не выдаётся.
- P4.5 fallback не используется (mode уже задан).

## 8. NOT in this batch

- `7101ed3c` CB20 main (20 ent) — отдельный approve.
- `d7effaf4` Маркетплейсы попадает в этот батч (16 ent, включая жалобу
  пользователя).
- Writers (`grant-access-for-order`, retroapply, rule_engine) НЕ патчатся.
  Корневой fix retroapply — отдельная задача после стабилизации данных.

## 9. Awaiting approve

Ждём подтверждения для перехода к Execute.
