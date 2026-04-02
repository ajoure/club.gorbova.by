# План: PATCH G → E → B — нормализация + repair + proof

## Главная цель спринта

1. Нормализовать 7 multi-module historical orders (PATCH G)
2. Выдать/восстановить корректные standalone entitlements (PATCH E)
3. Доказать срок доступа и runtime visibility на reference-cases

## Статусы патчей

| Patch | Статус |
|---|---|
| PATCH F | ✅ done / verify only |
| PATCH C | ✅ done / verify only |
| PATCH D | ⏳ proof base ready |
| PATCH G | ✅ execute_children_only done, post-check PASS (22/22) |
| PATCH E | ⏳ dry-run done, awaiting execute approval |
| PATCH B | ⏳ final browser proof |

## Готовность edge functions

- `split-multi-module-orders` — fix не потребовался
- `repair-cb20-entitlements` — исправлена ошибка: `training_content` → `training_lessons`, `status` → `is_active`

## PATCH G результаты

### execute_children_only ✅
- 7 parent → 22 child orders created
- batch_id: SPLIT-2026-04-02T200720
- 0 errors

### post-check ✅ (все 7 parents)
- actual_children = expected_children ✅
- all children product_id = module_product_id (not root CB20) ✅
- all children module_list_mapped contains exactly 1 element ✅
- all children have display_purchase_name ✅
- all parents meta.split_status = 'children_created' ✅
- no parent canceled ✅
- all deal_dates match ✅

## PATCH E dry-run результаты

### post_split_candidates (теперь в standalone_safe)
| Email | Modules | Lessons | expires_at | Status |
|---|---|---|---|---|
| katerina5515530@gmail.com | 4 (Грузо, Розница, Производство, Маркетплейсы) | 5 active (только Маркетплейсы) | 2026-04-18T12:00:00 | **standalone_safe — ready for execute** |

### still_blocked
| Email | Modules | Lessons | Reason |
|---|---|---|---|
| irinkazar@inbox.ru (Царёва) | 4 (Розница, Грузо, Производство, Строительство) | 0 active | **runtime_preview_zero_visibility** — все уроки is_active=false |
| a.bruylo@ajoure.by | staff | — | staff_skip |

### Царёва — pre/post mapping proof

| module_product_id | module_product_name | matched_training_module_id | matched_training_module_title | active_lessons | mapping_confidence | allowed_in_execute |
|---|---|---|---|---|---|---|
| abee24cd | Розничная торговля | 1ede03b4 | РОЗНИЧНАЯ ТОРГОВЛЯ | 0 (4 inactive) | matched | ❌ no active lessons |
| 64d9f812 | Грузо- и пассажироперевозки | 8f71d4a8 | Грузо- и пассажироперевозки | 0 (4 inactive) | matched | ❌ no active lessons |
| 064dd768 | Производство | a4a5102d | ПРОИЗВОДСТВО | 0 (4 inactive) | matched | ❌ no active lessons |
| f833c846 | Строительство | b7bae7fd | Модуль: Строительство | 0 | matched | ❌ no lessons at all |

**Вывод по Царёвой:** блокировка легитимна. Модули сматчены корректно (4/4), но все уроки деактивированы (is_active=false). Это проблема контента, а не repair-логики. Для разблокировки нужно активировать уроки в модулях.

### strict_hold vs partial_safe

| Режим | katerina | Царёва |
|---|---|---|
| strict_hold | blocked | blocked |
| partial_safe | **execute** (5 active lessons) | blocked (0 active lessons) |

**Рекомендация:** partial_safe для katerina. Царёва остаётся в manual_review до активации уроков.

## Execution order (обновлённый)

```text
Шаг 1. ✅ PATCH G execute_children_only — done
Шаг 2. ✅ PATCH G post_check — PASS
Шаг 3. ✅ PATCH E dry_run — done (fix applied: training_lessons + is_active)
Шаг 4. ⏳ PATCH E execute standalone_safe (partial_safe) — awaiting approval
Шаг 5. ⏳ PATCH G finalize_parents
Шаг 6. ⏳ PATCH B browser proof
```

### STOP-guard
- Царёва blocked → finalize_parents разрешён только для parents, чьи children уже проверены
- PATCH E execute только по approved cohort (katerina)
- Царёва → manual_review (активация уроков → повторный dry-run)

## DoD спринта

- [x] 7 parent orders split в 22 child orders
- [x] product_id = module_product_id, deal_date сохранена
- [x] post-check passed на всех 7 parents
- [ ] standalone_safe execute (katerina)
- [ ] Царёва: manual_review documented (blocked by inactive lessons)
- [ ] expires_at = business_access_end_at
- [ ] UI display proof child orders
- [ ] PATCH G finalize_parents
- [ ] PATCH B browser proof

## Reference cases

| Email | Роль | Статус |
|---|---|---|
| irinkazar@inbox.ru | non-staff reference | blocked: 0 active lessons in all 4 modules |
| katerina5515530@gmail.com | non-staff | standalone_safe, ready for partial_safe execute |
| a.bruylo@ajoure.by | staff | manual skip |
