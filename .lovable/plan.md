# да, согласен, с учетом правок:

&nbsp;

1. Убери из плана утверждение **«код edge functions уже готов, изменения не нужны»**.
  Замени на:
  &nbsp;
  - PATCH G и PATCH E считаются готовыми к запуску **только после preflight-check**
  - если preflight/dry-run покажет отклонения, допускаются точечные правки в:
    &nbsp;
    - supabase/functions/split-multi-module-orders/index.ts
    - supabase/functions/repair-cb20-entitlements/index.ts
    &nbsp;
  &nbsp;
2. В **Шаг 1** добавь жёсткий preflight для PATCH G execute_children_only. Execute разрешён только если dry-run повторно подтверждает:
  &nbsp;
  - parent_count = 7
  - total_children_planned = 22
  - у всех rows existing_child_conflict = false
  - все parent имеют status = paid
  - все parent имеют reconcile_source = getcourse_historical
  &nbsp;
3. В **Шаг 2** post-check распиши как обязательный DoD-блок, а не общую формулировку. После execute_children_only проверить:
  &nbsp;
  - по каждому parent actual_children = expected_children
  - у каждого child product_id = module_product_id
  - у каждого child purchase_snapshot.module_list_mapped содержит ровно 1 элемент
  - у каждого child заполнен purchase_snapshot.display_purchase_name
  - у каждого parent стоит meta.split_status = 'children_created'
  - ни один parent ещё не canceled
  &nbsp;
4. В **Шаг 3** dry-run для PATCH E раздели на два блока:
  &nbsp;
  - post_split_candidates
  - still_blocked
    Иначе не видно, кого реально чинит split, а кто остаётся в HOLD.
  &nbsp;
5. Не фиксируй заранее execute только в partial_safe как уже окончательно принятое решение.
  Правильно так:
  &nbsp;
  - dry-run обязан показать результат для strict_hold
  - dry-run обязан показать результат для partial_safe
  - после этого выбрать режим
  - для reference-case Царёвой базовый приоритет — partial_safe
  &nbsp;
6. Для Царёвой добавь обязательный **pre/post mapping proof**:
  &nbsp;
  - module_product_id
  - module_product_name
  - matched_training_module_id
  - matched_training_module_title
  - mapping_confidence
  - allowed_in_execute
  &nbsp;
7. Пункт по [katerina5515530@gmail.com](mailto:katerina5515530@gmail.com) сделай жёстким.
  Не писать аналогичный repair (или documented skip).
  Должен быть один из трёх финальных статусов:
  &nbsp;
  - repair executed
  - blocked with exact reason
  - manual review
  &nbsp;
8. Перед **Шагом 5 finalize_parents** добавь ещё одно условие:
  &nbsp;
  - кроме post-check и repair confirmation, должен быть подтверждён UI/display proof хотя бы на 1–2 child orders после split
  - только после этого разрешён finalize_parents
  &nbsp;
9. **PATCH B** расширь. Это не только proof по урокам.
  Должно быть:
  &nbsp;
  - admin lesson edit/save
  - superadmin lesson edit/save
  - browser/runtime proof видимости тренинга после repair на reference-case
  &nbsp;
10. В **Файлы для изменения** не оставляй только .lovable/[plan.md](http://plan.md).
  Напиши:
  &nbsp;
  - план обновляется в .lovable/[plan.md](http://plan.md)
  - при отклонениях по preflight/dry-run допускаются точечные правки в edge functions PATCH G и PATCH E
  &nbsp;
11. В **DoD спринта** добавь недостающие проверки:
  &nbsp;
  - child orders после split отображаются в UI как отдельные модульные сделки
  - parent не финализируются до полного post-check
  - у repaired user нет дублей активных cb20 entitlements
  - active entitlement по cb20 один канонический
  - expires_at = business_access_end_at без отклонений
  - runtime visibility доказана не только SQL, но и UI/reference proof
  &nbsp;
12. Добавь явный **STOP-guard**:
  &nbsp;
  - если хотя бы по одному parent post-check не проходит, то:
    &nbsp;
    - finalize_parents запрещён
    - PATCH E execute запрещён
    - сначала фикс данных/children, потом повторный post-check
    &nbsp;
  &nbsp;
13. Итоговую цель спринта уточни как результат:
  &nbsp;
  - historical standalone deals нормализованы
  - standalone entitlements восстановлены
  - срок доступа и видимость контента доказаны на reference-cases
  &nbsp;
14. В конец плана добавь короткий блок **Reference cases**:
  &nbsp;
  - Царёва — основной case для split + repair + runtime proof
  - [katerina5515530@gmail.com](mailto:katerina5515530@gmail.com) — второй non-staff case
  - [a.bruylo@ajoure.by](mailto:a.bruylo@ajoure.by) — staff skip / manual proof only
  &nbsp;
15. В шаге **PATCH E execute** явно зафиксируй, что execute идёт **только по approved cohort из dry-run**, а не по всем standalone автоматически.

&nbsp;

&nbsp;

План: выполнение PATCH G → E → B

## Главная цель спринта

1. Нормализовать 7 multi-module historical orders (PATCH G)
2. Выдать/восстановить корректные standalone entitlements (PATCH E)
3. Доказать срок доступа и runtime visibility на reference-cases (PATCH B + proof)

## Статусы патчей


| Patch   | Статус                                                                     |
| ------- | -------------------------------------------------------------------------- |
| PATCH F | ✅ done / verify only                                                       |
| PATCH C | ✅ done / verify only                                                       |
| PATCH D | ⏳ proof base ready (таблицы собраны, ждут использования как proof для G/E) |
| PATCH G | ➡️ next execute (dry_run подтверждён: 7 parent → 22 child)                 |
| PATCH E | ⏳ queued after G children creation                                         |
| PATCH B | ⏳ final browser proof                                                      |


## Execution order

```text
Шаг 1. PATCH G execute_children_only
Шаг 2. PATCH G post_check
Шаг 3. PATCH E dry_run на нормализованных данных
Шаг 4. PATCH E execute standalone_safe (partial_safe)
Шаг 5. PATCH G finalize_parents
Шаг 6. PATCH B browser proof admin + superadmin
```

Parent orders НЕ cancel до: children созданы + post-check успешен + repair cohort подтверждён.

## Шаг 1–2: PATCH G execute_children_only + post_check

Edge function `split-multi-module-orders` уже создана и задеплоена. Dry-run подтверждён.

**Действие:** вызвать edge function с `mode: "execute_children_only"`, затем проверить результат SQL-запросом (post_check).

Post-check SQL должен показать:

- 22 child orders с `meta->>split_from_order_id` 
- каждый child: `product_id = module_product_id` (не root CB20)
- `purchase_snapshot.display_purchase_name` начинается с "ЦБ 2.0:"
- `deal_date` совпадает с parent

## Шаг 3–4: PATCH E dry_run + execute

Edge function `repair-cb20-entitlements` уже доработана (tryChildNameMatch, standalone_safe cohort).

**Standalone users (repair focus):**

- `irinkazar@inbox.ru` (Царёва) — non-staff, reference-case
- `katerina5515530@gmail.com` — non-staff
- `a.bruylo@ajoure.by` — staff / manual skip

Реальный non-staff repair = Царёва + katerina5515530.

**Действие:**

1. Вызвать `repair-cb20-entitlements` с `dry_run: true` → показать standalone cohort
2. После согласования вызвать с `dry_run: false, execute_cohort: "standalone_safe", standalone_mode: "partial_safe"`

**Reference-case Царёва — что доказать после execute:**

- child orders созданы корректно (из PATCH G)
- entitlement создан с `scope_resolution_mode = module_scope_only`
- `expires_at = 2026-04-18` (= business_access_end_at)
- `mapped_training_module_ids` содержит только её модули
- runtime visibility ограничена этими модулями

## Шаг 5: PATCH G finalize_parents

Только после подтверждения шагов 1–4. Вызвать edge function с `mode: "finalize_parents"`.

## Шаг 6: PATCH B browser proof

- Browser proof admin lesson editing
- Browser proof superadmin lesson editing
- Если проблема не воспроизводится — закрыть proof'ом

## Файлы для изменения

Только `.lovable/plan.md` — обновить статусы. Код edge functions уже готов, изменения не нужны.

## DoD спринта

- 7 parent orders split в 22 child orders, `product_id = module_product_id`, deal_date сохранена
- Parent finalize только после post-check
- standalone_safe dry-run и execute выполнены (partial_safe)
- Царёва: entitlement с `module_scope_only`, `expires_at = 2026-04-18`
- katerina5515530: аналогичный repair (или documented skip)
- `expires_at` строго равен `business_access_end_at`
- Runtime visibility доказана на reference-case
- Admin/superadmin lesson editing подтверждён browser proof