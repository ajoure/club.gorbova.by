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

---

## 10. PATCH: убрать `cb20` как технический идентификатор

### 10.1 Принцип

`cb20` / `CB20` / «Ценный бухгалтер» допустимы ТОЛЬКО как:
- человекочитаемый label в proof/отчётах,
- запись в справочнике `src/lib/product-names.ts` (UI mapping),
- исторические proof-файлы (не редактируются).

Запрещено как технический ключ в:
- access/resolver/repair business logic,
- именах функций / migrations,
- условиях `product.code === 'cb20'`,
- runtime-фильтрах.

Канонические ключи: `product_id`, `tariff_id`, `training_module_id`, `entitlement_id`.

### 10.2 Pre-execute grep аудит (фактический результат)

Команда: `rg -n "cb20|CB20" src supabase` (исключая backfill-v23 и proof-файлы).

**Допустимые совпадения (label / UI / historical):**
- `src/lib/product-names.ts` — UI mapping (`cb20`, `cb20_predzapis`, `CB20`). ✅ оставляем.
- `src/components/course/PreregistrationDialog.tsx:35` — `productCode = "cb20_predzapis"` дефолт пропса для предзаписи. ✅ это другой продукт (предзапись), не относится к access-logic.
- `supabase/functions/course-prereg-notify/index.ts:68` — label-маппинг для уведомления. ✅ человекочитаемое имя.
- Комментарии (`// cb20 etc.`, `/* CB20 */`) в `useSidebarModules.ts`, `useTrainingContentRules.ts`, `_shared/entitlement-sync.ts`, `_shared/access-resolver.ts`, `split-multi-module-orders/index.ts`, `repair-cb20-entitlements/index.ts` — только в комментариях, без runtime-логики. ✅ оставляем (или чистим в отдельном refactor).

**Недопустимые совпадения (runtime business logic с `cb20` как условием):**

| Локация | Тип | Действие |
|---|---|---|
| `supabase/migrations/20260331113539_*.sql:143` | `AND p2.code <> 'cb20'` в исторической миграции | NOOP — миграция уже применена, не переписываем историю; runtime не использует |
| `supabase/migrations/20260331115050_*.sql:71` | то же | NOOP — историческая миграция |
| `supabase/migrations/20260406205141_*.sql` | data-fix комментарий | NOOP — историческая миграция |
| `supabase/functions/_shared/entitlement-sync.ts:13` | КОММЕНТАРИЙ «Skips cb20 when called from subscription paths (mode_filter)» | проверить, нет ли ниже runtime-кода с `code === 'cb20'` |
| `supabase/functions/admin-entitlement-backfill-v23/` | внутренний backfill v23 | вне scope текущего repair, отдельный refactor |
| `supabase/functions/repair-cb20-entitlements/` | имя функции содержит cb20 | НЕ используем; новая функция — `repair-training-module-scope-ids` (или inline migration) |

**Решение для текущего repair:**
- НЕ создаём новую edge-function с `cb20` в имени.
- Repair выполняем как **inline миграция** под именем `module_scope_ids_repair_2026_05`.
- Условия фильтра — ТОЛЬКО `product_id IN (<7 UUIDs>)` + `meta->>'scope_resolution_mode' = 'module_scope_only'`. Никаких `code = 'cb20'`.

### 10.3 Проверка `entitlement-sync.ts` на runtime-фильтр по `cb20`

Требуется отдельное чтение файла перед execute (см. Step 0 ниже).

### 10.4 Step 0 (новый, обязательный перед Execute)

1. `code--view supabase/functions/_shared/entitlement-sync.ts` — найти и зафиксировать наличие/отсутствие `code === 'cb20'` или подобных runtime-проверок.
2. Если найдено — внести в отдельный backlog-кандидат `cb20_hardcode_cleanup_2026_05.md` (НЕ блокирует текущий repair, т.к. касается subscription-sync, а не module_scope).
3. Никаких write-операций, пока этот аудит не зафиксирован в proof.

### 10.5 Repair-naming canonical

| Сущность | Имя |
|---|---|
| Миграция | `module_scope_ids_repair_2026_05` |
| Audit action | `training_content.module_scope_ids_repaired` |
| Backup-файл | `.lovable/proofs/module_scope_ids_repair_backup_2026_05.json` |
| Proof execute | `.lovable/proofs/module_scope_ids_repair_execute_2026_05.md` |

Ни в одном из имён нет `cb20`.

### 10.6 Memory rule (после Execute)

Добавить файл `mem://architecture/standard/no-product-code-in-business-logic`:

> Запрещено использовать product `code`/`name` (например, `cb20`, `CB20`, «Ценный бухгалтер») как технический ключ в access/resolver/repair logic, фильтрах, условиях, именах функций или миграций. Канонические ключи: `product_id`, `tariff_id`, `training_module_id`, `entitlement_id`. Название продукта допускается только для UI-mapping (`src/lib/product-names.ts`) и человекочитаемых proof-отчётов.

И ссылку в `mem://index.md` → секция Core (одной строкой).

### 10.7 Post-execute Hardcode cleanup verification

После Execute обязательно:
1. `rg -n "cb20|CB20" src supabase` → итоговый снимок в proof.
2. Каждое совпадение классифицировать: `label-only` / `historical-migration` / `comment` / `RUNTIME-VIOLATION`.
3. `RUNTIME-VIOLATION = 0` — иначе Execute считается невыполненным, откат + новый план.

### 10.8 Обновлённый DoD

- [ ] repair выполнен по `product_id → training_module_id`, без `cb20`-условий в SQL/именах
- [ ] inline миграция `module_scope_ids_repair_2026_05`, без новых cb20-named функций
- [ ] proof оперирует `product_id=<UUID>, product_name="<label>"`, а не `cb20`-кодом
- [ ] post-grep: `RUNTIME-VIOLATION=0` (label/comment/historical-migration допустимы)
- [ ] memory rule `no-product-code-in-business-logic` добавлен
- [ ] writers (grant-access-for-order, retroapply, rule_engine, subscriptions writers) не тронуты

## 11. Awaiting approve (обновлено)

План дополнен PATCH-разделом 10. Pre-execute grep-аудит выполнен и зафиксирован.
**Execute не запускается до отдельного approve этого обновлённого плана.**
