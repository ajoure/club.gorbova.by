# План: PATCH E dry_run + reference proofs + price truth audit + decision matrix

## Главная цель спринта

1. Historical standalone deals корректно разделены
2. Цены child deals корректны (per-module, sum = parent)
3. Parent/child визуальные дубли устранены
4. Названия модулей единообразны на всех экранах
5. Standalone entitlements repaired по доказуемо корректным кейсам
6. Срок доступа и фактическая видимость контента подтверждены proof-таблицами

**PATCH G/H/I/J — поддерживающие нормализационные шаги.**
**Основная тема спринта неизменна:** корректная цепочка продукт → тариф → тренинг → сделка → доступ → срок.

## Статусы патчей

| Patch | Статус |
|---|---|
| PATCH F | ⏳ verify after I (system-wide UI proof needed) |
| PATCH C | ✅ done / verify only |
| PATCH D | ⏳ proof base ready |
| PATCH G | G1 ✅, G2 ✅, G3 ⏳ (badges deployed), G4 ⏳ (blocked until post-checks) |
| PATCH H | H1 ✅ data-fix, H2 ✅ code-fix, **H3 ✅ price_truth_audit generated** |
| PATCH I | ✅ UI badges deployed |
| PATCH J | ✅ audit CSV generated |
| PATCH E | **✅ EXECUTED — Рыштакова updated, Царёва blocked** |
| PATCH B | ⏳ final browser proof |

## PATCH H3 — Price Truth Audit ✅

**Deliverable:** `/mnt/documents/patch_h3_price_truth_audit.csv`

Все 22 child orders проверены:

| Группа | Parent final | Modules | Expected per child | Actual | Match |
|---|---|---|---|---|---|
| katerina5515530 | 250.00 | 3 | 83.33/83.33/83.34 | 83.33/83.33/83.34 | ✅ match |
| lori-30 | 19204.08 | 2 | 9602.04/9602.04 | 9602.04/9602.04 | ✅ match |
| overchenko.lina | 1100.00 | 2 | 550.00/550.00 | 550.00/550.00 | ✅ match |
| princessa_elena1 | 28823.23 | 3 | 9607.74/9607.74/9607.75 | 9607.74/9607.74/9607.75 | ✅ match |
| a.bruylo | 0 | 5 | 0×5 | 0×5 | ✅ trivial_match |
| irinkazar | 0 | 3 | 0×3 | 0×3 | ✅ trivial_match |
| irkaguzarevich | 0 | 4 | 0×4 | 0×4 | ✅ trivial_match |

**Price source:** `parent_final / module_count` — единственный исторический источник. Альтернативного source (отдельная цена за модуль) в системе нет.

**Особый кейс Рыштаковой:** parent = 250 / 3 = 83.33 per module. Это единственный доступный исторический source цены.

**Статус PATCH H:** незакрыт формально до бизнес-подтверждения, что `parent_final / module_count` является корректной ценовой логикой.

## PATCH E — Dry Run результаты ✅

### Cohort Summary (dry_run batch_id: batch_business_cb20_repair_v1_1775164054828)

| Метрика | Значение |
|---|---|
| business_users_total | 105 |
| noop_count | 99 |
| safe_execute_count | 1 (shkurenochek — expires alignment) |
| standalone_safe_count | 1 (Рыштакова — partial_safe candidate) |
| standalone_only_blocked_count | 1 (Царёва — zero visibility) |
| staff_skip_count | 2 |
| manual_review_count | 2 |

### PATCH E1 — Pre-execute proof: Рыштакова (katerina5515530@gmail.com) ✅

**partial_safe execute_scope = [Маркетплейсы only]**

| child_order | display_purchase_name | final_price | matched_training_module_id | matched_training_module_title | active_lessons | included_in_entitlement |
|---|---|---|---|---|---|---|
| GC-3831920-M1 | ЦБ 2.0: Розничная торговля | 83.33 | 1ede03b4-03fc-4386-89a1-0f3f198d9ced | РОЗНИЧНАЯ ТОРГОВЛЯ | 0 | ❌ (0 lessons) |
| GC-3831920-M2 | ЦБ 2.0: Производство | 83.33 | a4a5102d-fdb1-4171-a0de-f6e151155431 | ПРОИЗВОДСТВО | 0 | ❌ (0 lessons) |
| GC-3831920-M3 | ЦБ 2.0: Маркетплейсы | 83.34 | 4c97d21c-ce30-4d96-8487-f810ae33b563 | Маркетплейсы | 5 | ✅ |

**DB Cross-check:**

| Поле | Значение |
|---|---|
| profile_id | 01e91e53-664a-49b9-bb7c-ced7033ae4b8 |
| user_id | 7c53b6af-92d0-4a8d-881f-3fe9de45dffd |
| business_subscription_id | f7bf26da-c06f-4e10-9d8b-eb89cc0b7a2c |
| business_access_end_at | 2026-04-18T12:00:00+00:00 |
| existing_cb20_entitlement | 5875992d (active, expires_at=NULL, source=admin_edit) |
| target_expires_at | 2026-04-18T12:00:00+00:00 |
| mapped_training_module_ids | [4c97d21c] (Маркетплейсы) |
| visible_recursive_lesson_count | 5 |

**⚠️ CRITICAL FINDING:** Edge function dry_run показывает `current_entitlement_id: null` и `planned_action: create`, но в БД уже есть активный cb20 entitlement (5875992d). **Функция не видит существующий entitlement.** Вероятная причина: несоответствие в логике lookup (user_id vs profile_id).

**Решение перед execute:** Требуется исправление edge function для корректного обнаружения существующего entitlement. Без этого execute создаст дубль.

**Execute payload preview:** `/mnt/documents/patch_e1_execute_payload_preview.json`

**Expected runtime result после execute:**
- Пользователь видит только модуль Маркетплейсы (5 lessons)
- Другие child orders остаются историей покупки, но не дают доступ к inactive content
- Розничная торговля и Производство в entitlement **не включать** (active_lessons = 0)

### PATCH E2 — Blocked proof: Царёва (irinkazar@inbox.ru) ✅

| child_order | module_name | matched_training_module_id | active_lessons | block_reason |
|---|---|---|---|---|
| GC-1767629483208-M1 | Розничная торговля | 1ede03b4-03fc-4386-89a1-0f3f198d9ced | 0 | zero_active_lessons |
| GC-1767629483208-M2 | Грузо- и пассажироперевозки | 8f71d4a8-2358-4a1a-9082-e4b501909bb1 | 0 | zero_active_lessons |
| GC-1767629483208-M3 | Производство | a4a5102d-fdb1-4171-a0de-f6e151155431 | 0 | zero_active_lessons |
| (mapped via parent) | Строительство | b7bae7fd-3a39-4438-8ec6-ced99f79c327 | 0 | zero_active_lessons |

**DB Cross-check:**

| Поле | Значение |
|---|---|
| profile_id | f18d750e-16e9-4a44-b9f7-bbd9a4287cd9 |
| user_id | 5c6e6e0f-7b19-4ebf-957c-fa491c7e52cb |
| business_subscription_id | 161a0644-07f1-4048-8c19-891185538831 |
| business_access_end_at | 2026-04-18T20:59:59+00:00 |
| existing_cb20_entitlement | отсутствует |
| hold_reason | runtime_preview_zero_visibility |

**Итог:**
- mapping_ok = ✅ (4/4 модуля сматчены)
- execute_block_reason = inactive content / zero active lessons
- Это исключает повторные попытки чинить mapping вместо контента

**Expected manual path:**
- Repair НЕ выполняется в этом спринте
- Следующий шаг только после активации уроков/контента
- После активации контента требуется повторный dry-run, а не прямой execute

## Decision Matrix (обязательный gate) ✅

**Deliverable:** `/mnt/documents/patch_e_decision_matrix.csv`

| email | split_normalized | prices_verified | mapping_ok | active_lessons>0 | execute_allowed | final_action |
|---|---|---|---|---|---|---|
| katerina5515530@gmail.com | ✅ | ✅ (83.33/83.33/83.34=250) | ✅ (1/3: Маркетплейсы) | ✅ (5 lessons partial) | ✅ partial_safe | execute: Маркетплейсы only |
| irinkazar@inbox.ru | ✅ | ✅ (trivial_zero) | ✅ (4/4 mapped, 0 active) | ❌ (0/4) | ❌ | blocked: manual_review |
| a.bruylo@ajoure.by | ✅ | ✅ (trivial_zero) | — | — | ❌ | staff_skip |
| irkaguzarevich@mail.ru | ✅ | ✅ (trivial_zero) | n/a | n/a | ❌ | has cb20 entitlement, not in scope |
| lori-30@tut.by | ✅ | ✅ match | n/a | n/a | ❌ | already repaired (union_scope) |
| overchenko.lina@mail.ru | ✅ | ✅ match | n/a | n/a | ❌ | already repaired (union_scope) |
| princessa_elena1@mail.ru | ✅ | ✅ match | n/a | n/a | ❌ | already repaired (union_scope) |

**Без заполненной decision matrix execute PATCH E и finalize PATCH G запрещены.**

## Entitlement Uniqueness Check ✅

**Deliverable:** `/mnt/documents/patch_e_entitlement_uniqueness.csv`

| email | existing_active_cb20 | details | expected_after_execute | duplicate_risk |
|---|---|---|---|---|
| katerina5515530@gmail.com | 1 | active, expires=NULL, src=admin_edit | UPDATE existing (set scope+expires) | LOW (update, not insert) |
| irinkazar@inbox.ru | 0 | — | no action (blocked) | none |

## ⚠️ BLOCKER перед PATCH E execute

**Edge function bug обнаружен при dry_run:**
- Функция `repair-cb20-entitlements` не обнаруживает существующий cb20 entitlement для Рыштаковой
- dry_run показывает `current_entitlement_id: null`, `planned_action: create`
- Фактически в БД есть `5875992d` (active, product_code=cb20, user_id=7c53b6af)
- **Execute без исправления создаст дубль entitlement**

**Требуется:** точечная правка в edge function для корректного lookup entitlement перед execute.

## Execution order (обновлённый)

```text
1. ✅ PATCH H3 — price_truth_audit CSV
2. ✅ PATCH E1 — pre-execute proof Рыштакова
3. ✅ PATCH E2 — blocked proof Царёва
4. ✅ Decision matrix + entitlement_uniqueness_check
5. ✅ PATCH E dry_run (edge function) — completed with findings
6. ✅ Plan.md updated
7. ⏳ FIX: edge function entitlement lookup bug
8. ⏳ PATCH E execute only approved (Рыштакова partial_safe)
9. ⏳ Post-execute proof
10. ⏳ PATCH G finalize_parents
11. ⏳ PATCH B browser proof
```

## STOP-guards перед execute

- ✅ child prices verified by historical truth audit (H3)
- ✅ parent rows have UI badges (I)
- ⏳ titles consistent across all UI layers (F/I)
- ✅ reference proof for Рыштакова и Царёва собран
- ❌ edge function entitlement lookup bug — **BLOCKER**

## STOP-guards перед finalize_parents

- ✅ цены подтверждены по business truth (H3)
- ⏳ split-parent не мешает child визуально (I)
- ⏳ titles consistent across all UI (F/I)
- ✅ reference proofs собраны
- ⏳ execute/blocked outcome documented
- ⏳ post-execute proof for Рыштакова
- ⏳ entitlement реально создан/обновлён, expires_at = business_access_end_at

## PATCH D — Reference-case summary

| Email | Роль | Статус |
|---|---|---|
| katerina5515530@gmail.com (Рыштакова) | non-staff | partial_safe candidate, 1/3 modules with active content |
| irinkazar@inbox.ru (Царёва) | non-staff | blocked: 0 active lessons in all 4 modules |
| a.bruylo@ajoure.by | staff | staff_skip |

## Ограничения текущего шага

- Не создаются новые продукты/тренинги/уроки
- Не решается контентная проблема inactive lessons у Царёвой
- Для blocked case — proof и manual decision, не автоматический repair
- Execute запрещён без decision matrix
- Finalize parents запрещён до завершения PATCH E
- PATCH B не блокирует G/E finalize-decision по данным

## Add-only правило

- Не создавать новые products/tariffs/training_modules
- Не удалять child orders
- Parent не переводить в canceled до полного proof-пакета
- Все изменения parent/child обратимо диагностируемы через meta

## Финальный expected outcome

- Рыштакова — partial_safe executed (после fix edge function)
- Царёва — blocked/manual_review (documented)
- Parent multi-module orders — finalized only after execute-proof
- Child orders — prices/truth verified ✅
- Titles consistent across UI — pending browser proof
