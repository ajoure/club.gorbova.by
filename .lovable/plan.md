## Да, согласен, с учетом правок:

```text
Дополнить план обязательными правками:

1. В новых артефактах запрещено использовать не только старый product code, но и любые производные от него:
   - в именах файлов;
   - в заголовках;
   - в комментариях;
   - в proof-тексте;
   - в memory;
   - в migration description;
   - в audit meta;
   - в console/log labels.

2. В текущем repair использовать только:
   - product_id;
   - product_name;
   - training_module_id;
   - entitlement_id;
   - tariff_id.

3. В dry-run proof полностью удалить разделы, где старый product code классифицируется как “допустимый”. Такой категории больше нет.

4. В backlog-файле по legacy-долгу также не использовать запрещённый product code в названии файла. Название заменить на:
   `.lovable/backlog/remove_legacy_product_code_mentions_2026_05.md`

5. В memory rule не приводить пример запрещённого кода. Формулировка должна быть общей:
   “Запрещено использовать внутренние product code/slug как технический или текстовый идентификатор...”

6. Перед Execute обязательно показать grep-gate:
   - по dry-run proof;
   - по execute proof;
   - по новым/изменённым файлам текущего patch;
   - результат должен быть 0 совпадений.

7. Исторические совпадения не редактировать в этом Execute, но вынести отдельным legacy debt без выполнения.

8. Repair-фильтр должен быть строго:
   `product_id IN (...)`
   плюс
   `meta->>'scope_resolution_mode' = 'module_scope_only'`
   Никаких условий по code/name/slug.

9. После Execute в proof писать только:
   - product_id;
   - product_name;
   - old historical_module_product_ids;
   - new training_module_id;
   - entitlement_id;
   - audit id.
```

После внесения этих правок план можно выполнять.

&nbsp;

План: PATCH 10 (жёсткая редакция) — полный запрет `cb20`/`CB20` в новых артефактах

### Цель

Убрать `cb20` / `CB20` из всех **новых и изменяемых** артефактов: proof, memory, планы, миграции, функции, комментарии, UI-описания. Допустимое отображаемое имя продукта — только `Ценный бухгалтер | 1 ступень 2.0`. Технические ссылки — только UUID.

### Канонические ключи

- `product_id` = `7101ed3c-7839-4a74-ad95-aa0660369b22`
- `product_name` = `"Ценный бухгалтер | 1 ступень 2.0"` (только как отображаемое имя)
- `training_module_id`, `tariff_id`, `entitlement_id`

`cb20` / `CB20` запрещены даже как label, комментарий или текст.

---

### Шаг 1. Перепись `module_scope_ids_repair_dryrun_2026_05.md`

- Удалить все `cb20` / `CB20` из текста (включая разделы 0, 2, 8, 10).
- Раздел «допустимые совпадения cb20» — **удалить целиком** (допустимых нет).
- Все технические ссылки → `product_id=<UUID>` (+ опционально `product_name="<label>"` для читаемости).
- Заголовки таблиц переименовать: вместо «top-level module title» → `product_id | product_name | training_module_id | affected_count`.
- Раздел 8 «NOT in this batch» переписать без упоминания `cb20`/`CB20` — оставить только `product_id=7101ed3c…` (20 ent — отдельный approve).

### Шаг 2. Перепись имён артефактов


| Сущность        | Имя                                                           |
| --------------- | ------------------------------------------------------------- |
| Inline миграция | `module_scope_ids_repair_2026_05`                             |
| Audit action    | `training_content.module_scope_ids_repaired`                  |
| Backup          | `.lovable/proofs/module_scope_ids_repair_backup_2026_05.json` |
| Execute proof   | `.lovable/proofs/module_scope_ids_repair_execute_2026_05.md`  |


Без `cb20` нигде.

### Шаг 3. Pre-execute grep gate

Команда:

```
rg -n "cb20|CB20" .lovable/proofs/module_scope_ids_repair_dryrun_2026_05.md
rg -n "cb20|CB20" .lovable/proofs/module_scope_ids_repair_execute_2026_05.md  # после Execute
rg -n "cb20|CB20" <все новые/изменённые файлы этого PATCH-а>
```

**Ожидание: 0 совпадений в каждом.**

Полный repo-скан `rg -n "cb20|CB20" src supabase .lovable` остаётся диагностическим: совпадения допускаются ТОЛЬКО в:

- исторических миграциях (`supabase/migrations/2026013*`, `2026010*`, `2026033*`, `2026040*`, `2026011*`),
- legacy функциях (`repair-cb20-entitlements`, `admin-entitlement-backfill-v23`, `course-prereg-notify`, `split-multi-module-orders`),
- legacy hooks-комментариях (`useTrainingContentRules.ts`, `useSidebarModules.ts`, `_shared/entitlement-sync.ts`, `_shared/access-resolver.ts`),
- `src/lib/product-names.ts` (UI-mapping legacy slug),
- `src/components/course/PreregistrationDialog.tsx` (другой продукт — предзапись),
- исторических proof-файлах (`cb20_manual_grant_tariff_repair_2026_05.md`, `training_content_resolver_cb20_tatiana_2026_05.md`, `training_content_business_full_fix.md`, `access_rules_meta_backfill_a1.md`, `access_rules_full_dod_proof.md`, `.lovable/plan.md`).

Все эти совпадения помечаются `legacy_existing_debt` и **не трогаются** в текущем Execute.

### Шаг 4. Backlog

Создать отдельный backlog-кандидат (не выполнять):

- `.lovable/backlog/remove_legacy_product_code_mentions_2026_05.md` — план поэтапного удаления `cb20`/`CB20` из legacy кода/комментариев/имён функций. Требует отдельного approve, в текущем repair не реализуется.

### Шаг 5. Memory rule

Создать `mem://architecture/standard/no-product-code-in-new-artifacts` с текстом:

> Запрещено использовать внутренние product code/slug вроде `cb20` как технический или текстовый идентификатор. В новых планах, proof, memory, runtime-коде, миграциях и комментариях используются только `product_id`, `tariff_id`, `training_module_id`, `entitlement_id` и отображаемое `product_name`. Исторические артефакты помечаются `legacy_existing_debt` и не редактируются ad-hoc.

В `mem://index.md` → секция Core, одной строкой.

### Шаг 6. Обновлённый DoD

- `module_scope_ids_repair_dryrun_2026_05.md` переписан, `rg cb20|CB20` по нему = 0
- `module_scope_ids_repair_execute_2026_05.md` создан, `rg cb20|CB20` по нему = 0
- inline миграция, audit, backup-имена не содержат `cb20`
- memory rule `no-product-code-in-new-artifacts` создан и в Core
- backlog `remove_legacy_product_code_mentions_2026_05` зафиксирован (без выполнения)
- writers (grant-access-for-order, retroapply, rule_engine, subscription writers) не тронуты
- repair фильтр: `product_id IN (<6 UUIDs>) AND meta->>'scope_resolution_mode'='module_scope_only'` — без code-условий
- post-execute: целевые 6 продуктов появляются в библиотеке у затронутых пользователей; `module_scope_only` сохранён; full-доступ не выдан

### Шаг 7. Gate перед Execute

Execute не запускается, пока:

1. dry-run переписан и проверен grep-ом (0 совпадений в новых артефактах);
2. backlog для legacy создан;
3. этот обновлённый план получил отдельный approve.

### Порядок исполнения после approve

1. Перепись dry-run (Шаг 1) → grep gate.
2. Создание backlog (Шаг 4).
3. Запрос финального approve на Execute.
4. Execute миграции + backup + audit.
5. Создание execute-proof + memory rule + index update.
6. Post-execute grep gate + verify видимости в UI.

### Что НЕ делается этим планом

- Не редактируются исторические proof-файлы (`cb20_manual_grant_tariff_repair_2026_05.md`, `training_content_resolver_cb20_tatiana_2026_05.md`, `.lovable/plan.md`, и др.).
- Не переименовывается `repair-cb20-entitlements` edge-функция.
- Не изменяется `src/lib/product-names.ts`, `PreregistrationDialog.tsx`, `course-prereg-notify`.
- Не трогается `7101ed3c…` (`module_scope_only` на product-main, 20 ent) — отдельный approve.
- Не патчатся writers и retroapply.