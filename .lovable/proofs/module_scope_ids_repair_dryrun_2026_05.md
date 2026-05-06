# Module Scope IDs Repair — Dry-run (Option B)

**Date:** 2026-05-06 (Minsk)
**Scope:** entitlements c `meta.scope_resolution_mode='module_scope_only'`,
у которых `historical_module_product_ids` ошибочно содержит `product_id`
(элемент существует в `products_v2`) вместо реального `training_modules.id`.

## 0. Hypothesis

Retroapply / rule_engine при формировании `historical_module_product_ids`
для standalone-модульных продуктов записал туда сам `product_id`, а не
`training_module_id` корневого тренинга. В resolver
(`useTrainingContentRules.ts`) сверка идёт по `training_modules.id` ⇒ ни
один модуль не матчится ⇒ карточка скрыта в ЛК (симптом: продукт не
виден в «Моя библиотека»).

## 1. Affected cohort (read-only)

| product_id | product_name | training_module_id (target) | affected entitlements |
|---|---|---|---|
| `064dd768-…` | Производство | `a4a5102d-…` | 15 |
| `64d9f812-…` | Грузо/пасс. перевозки | `8f71d4a8-…` | 8 |
| `9187db54-…` | Общественное питание | `841650a9-…` | 5 |
| `99f1f156-…` | ПВТ | `b1199440-…` | 1 |
| `abee24cd-…` | Розничная торговля | `1ede03b4-…` | 7 |
| `d7effaf4-…` | Маркетплейсы | `4c97d21c-…` | 16 |
| `f833c846-…` | Строительство | `b7bae7fd-…` | 8 |

**Всего к патчу: 60 entitlements по 7 standalone-модульным продуктам.**

## 2. Excluded from auto-fix

- `product_id = 7101ed3c-7839-4a74-ad95-aa0660369b22`
  (`product_name="Ценный бухгалтер | 1 ступень 2.0"`, 20 entitlements).
  Это родительский продукт тренинга, не standalone-модуль. Если на нём
  стоит `module_scope_only` с `historical_module_product_ids=[product_id]`
  — это отдельная семантическая ошибка (вероятно, должно быть
  `full_tariff_scope`, либо явный `module_scope` с конкретным историческим
  `training_module_id`). **Решается отдельным approve, в этом батче НЕ
  трогаем.**

## 3. Batch source

`source_type` распределение на 60 affected: смесь `retroapply`,
`rule_engine` и NULL. `meta.source_event_key` отсутствует у всех ⇒
привязка к конкретному `RETROAPPLY-2026-04-10-66d2d335` не подтверждается.
Это более широкий исторический баг, а не один батч.

## 4. Proposed change (per entitlement)

```sql
UPDATE entitlements
SET meta = jsonb_set(
  jsonb_set(meta,
    '{historical_module_product_ids}',
    to_jsonb(ARRAY[<target_training_module_id>]::uuid[]), true),
  '{module_scope_ids_repaired_at}',
  to_jsonb(now()::text), true)
WHERE id = <entitlement_id>;
```

- `scope_resolution_mode` = `module_scope_only` — **не меняется**
- `expires_at` / `status` — **не меняются**
- `source_type` / `source_rule_id` lineage — **не меняется**
- Никаких `full_tariff_scope`, никакого расширения доступа.

Фильтр строго:
```sql
product_id IN (<6–7 product UUIDs>)
AND meta->>'scope_resolution_mode' = 'module_scope_only'
```
Никаких условий по product `code` / `slug` / `name`.

## 5. Audit log entry per row

```sql
INSERT INTO audit_logs(action, actor_type, actor_label, target_user_id, meta)
VALUES ('training_content.module_scope_ids_repaired', 'system',
  'module_scope_ids_repair_2026_05', <user_id>,
  jsonb_build_object(
    'entitlement_id', <id>,
    'product_id', <product_id>,
    'old_historical_module_product_ids', <old>,
    'new_historical_module_product_ids', <new_training_module_id_array>));
```

## 6. Backup before write

Перед UPDATE — селект полного `meta` всех 60 entitlements в текстовый
снапшот `.lovable/proofs/module_scope_ids_repair_backup_2026_05.json`
(через `COPY ... TO STDOUT`).

## 7. Expected post-verify

- `useTrainingContentRules` для каждого user-а резолвит синтетическое
  `module_scope_only` правило с
  `allowed_module_ids = [target_training_module_id]`.
- Карточка целевого продукта появляется в библиотеке.
- `module_scope_only` остаётся — full-доступ не выдаётся.
- P4.5 fallback не используется (mode уже задан).

## 8. NOT in this batch

- `product_id = 7101ed3c-7839-4a74-ad95-aa0660369b22` (20 ent) —
  отдельный approve.
- Writers (`grant-access-for-order`, retroapply, rule_engine) НЕ
  патчатся. Корневой fix retroapply — отдельная задача после
  стабилизации данных.
- Legacy artefacts (см. раздел 10) — не редактируются.

## 9. Awaiting approve

Ждём подтверждения для перехода к Execute.

---

## 10. Hardcode policy (PATCH — strict edition)

### 10.1 Принцип

Внутренние product code/slug запрещены к использованию как технический
или текстовый идентификатор в **новых артефактах**: planах, proof,
memory, runtime-коде, миграциях, audit meta, console/log labels,
комментариях, именах файлов и функций.

Канонические ключи:
- `product_id`, `tariff_id`, `training_module_id`, `entitlement_id`
- `product_name` — только как отображаемое имя для UI/proof readability.

### 10.2 Naming canon

| Сущность | Имя |
|---|---|
| Inline миграция | `module_scope_ids_repair_2026_05` |
| Audit action | `training_content.module_scope_ids_repaired` |
| Backup | `.lovable/proofs/module_scope_ids_repair_backup_2026_05.json` |
| Execute proof | `.lovable/proofs/module_scope_ids_repair_execute_2026_05.md` |
| Backlog (legacy debt) | `.lovable/backlog/remove_legacy_product_code_mentions_2026_05.md` |

### 10.3 Pre-execute grep gate

Команда (по новым/изменённым артефактам этого PATCH):
```
rg -n "cb20|CB20" \
  .lovable/proofs/module_scope_ids_repair_dryrun_2026_05.md \
  .lovable/backlog/remove_legacy_product_code_mentions_2026_05.md
```
**Ожидание: 0 совпадений.**

После Execute — добавить:
```
rg -n "cb20|CB20" .lovable/proofs/module_scope_ids_repair_execute_2026_05.md
```
**Ожидание: 0 совпадений.**

Полный repo-скан `rg -n "cb20|CB20" src supabase .lovable` остаётся
диагностическим. Существующие совпадения в исторических миграциях,
legacy edge-функциях, legacy hooks/комментариях, `src/lib/product-names.ts`
и исторических proof-файлах помечены `legacy_existing_debt` и **не
трогаются** в этом Execute. См. backlog.

### 10.4 Repair filter (canonical)

```sql
WHERE product_id IN (
  '064dd768-…','64d9f812-…','9187db54-…','99f1f156-…',
  'abee24cd-…','d7effaf4-…','f833c846-…'
)
AND meta->>'scope_resolution_mode' = 'module_scope_only'
AND <historical_module_product_ids contains the product_id itself>
```

### 10.5 Post-execute proof contract

В execute-proof разрешено писать только:
- `product_id`,
- `product_name` (отображаемое),
- `entitlement_id`,
- `old historical_module_product_ids`,
- `new training_module_id`,
- `audit_log id`.

### 10.6 Memory rule (после Execute)

Создать `mem://architecture/standard/no-product-code-in-new-artifacts`:

> Запрещено использовать внутренние product code/slug как технический
> или текстовый идентификатор. В новых планах, proof, memory,
> runtime-коде, миграциях, audit meta, комментариях и именах файлов
> используются только `product_id`, `tariff_id`, `training_module_id`,
> `entitlement_id` и отображаемое `product_name`. Исторические артефакты
> помечаются `legacy_existing_debt` и не редактируются ad-hoc.

В `mem://index.md` → секция Core, одной строкой.

## 11. DoD (final)

- [ ] dry-run переписан, grep по нему = 0
- [ ] backlog `remove_legacy_product_code_mentions_2026_05.md` создан
- [ ] execute-proof не содержит запрещённых code/slug, grep = 0
- [ ] inline миграция, audit, backup-имена не содержат product code/slug
- [ ] memory rule `no-product-code-in-new-artifacts` создан и в Core
- [ ] writers (`grant-access-for-order`, retroapply, rule_engine,
      subscription writers) не тронуты
- [ ] repair фильтр строго `product_id IN (...) AND
      meta->>'scope_resolution_mode'='module_scope_only'`
- [ ] post-execute: целевые 7 продуктов появляются в библиотеке
      затронутых пользователей; `module_scope_only` сохранён; full-доступ
      не выдан

## 12. Awaiting Execute approve

План переписан. Pre-execute grep gate выполняется в следующем шаге.
**Execute не запускается до отдельного approve.**
