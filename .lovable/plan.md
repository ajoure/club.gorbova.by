1: # План: 4 патча — cb20 repair, Деньги BY closure, LibraryModule access filter, Universal RetroApply Engine

---

## Архитектурная норма

**RetroApply — это универсальный ручной механизм применения новых или изменённых access_rules к историческим данным по всем продуктам и тарифам, а не специальная логика только для BUSINESS.**

- Engine НЕ привязан к BUSINESS, НЕ привязан к club, НЕ привязан к Деньги BY
- Rule выбирается параметрами запуска (rule_ids / source_product_id / source_tariff_id / changed_since)
- Два режима: **grant missing access** (default) и **recalculate existing access** (`recalculate_existing: true`)

**Правило эксплуатации для админа:**
- Новые оплаты после изменения rules обрабатываются автоматически обычным fulfillment flow
- Старые исторические покупки автоматически НЕ пересчитываются
- Для них админ вручную запускает RetroApply: preview → execute

---

## PATCH-A: CB20 expiry alignment

**Статус:** ✅ Закрыт по data-proof

---

## PATCH-B: Деньги BY retro-backfill

**Статус:** ✅ Закрыт по proof

---

## PATCH-C: LibraryModule child access filtering

**Статус:** ✅ Закрыт как UI access-filter fix

---

## PATCH-D: Universal RetroApply Engine

**Статус:** ✅ Code-ready, preview/execute/idempotency verified, UI создан

---

## PATCH-E: RetroApply Conflict Reclassification

**Статус:** ✅ Закрыт по proof

---

## PATCH-F: Admin-Controlled Conflict Resolution

**Статус:** ✅ done

---

## PATCH-G: RetroApply Engine/UI Truth Repair

**Статус:** ✅ done

### Проблема
RetroApply safe execute визуально «срабатывал», но фактически не создавал записей.
Post-result блок показывал недостоверные данные (skipped = весь preview).

### Что исправлено

**Engine (`supabase/functions/rules-retroapply/index.ts`):**
- **Create-path:** убрана запись в несуществующий столбец `source`. Все маркеры происхождения пишутся в `meta` (`source_type`, `source_rule_id`, `batch_id`, etc.)
- **Profile_id:** при create передаётся `profile_id` если известен
- **Update-path:** реализован merge meta: `{ ...oldMeta, ...retroapplyPatch }`. Существующие ключи не затираются
- **Execute-статистика разделена:**
  - `targeted` — строки реально вошедшие в execute
  - `created` / `updated` — фактические изменения
  - `skipped_idempotent` — уже существовало между preview и execute
  - `skipped_conflict` — entitlement не найден / нет planned_expires
  - `skipped_error` — ошибка insert/update
  - `not_selected` — строки preview, которые не входили в scope execute
- Добавлены `created_action_ids`, `updated_action_ids`, `skipped_action_ids`, `errors[]`

**UI (`src/components/admin/product/RetroApplyPanel.tsx`):**
- Post-result блок показывает 4 столбца: Создано / Обновлено / Пропущено / Не входило в запуск
- Текстовая строка: «Запущено к обработке: N. Фактически изменено: M.»
- Отдельно отображаются ошибки execute (если есть)
- Auto-refresh preview после execute сохранён

### Диагностика Елизаветы Семашкевич

Разбор показал:
- Активная подписка: product `11c9f1b8` (Gorbova Club), tariff `7c748940` (BUSINESS)
- Правило `1b497fba` (9 продуктов) использует `condition_type: prior_purchase, match_mode: per_product`
- У Елизаветы оплачен только 1 из 9 target-продуктов (cb20 = `7101ed3c`)
- Entitlement для cb20 существует, но `status: expired` (срок 2026-04-07, уже истёк)
- Для остальных 8 продуктов она правомерно классифицирована как `condition_not_met`
- **Вывод:** проблема Елизаветы — не ошибка create-path и не ошибка классификации, а expired entitlement по cb20

### DoD
- [x] Create-path: убран `source`, все маркеры в `meta`
- [x] Update-path: meta merge, не overwrite
- [x] Execute-статистика: 6 раздельных метрик + action_ids + errors
- [x] UI: честный post-result с разделением scope
- [x] Елизавета: разобрана, проблема = expired cb20, не ошибка engine
- [x] Engine deployed и отвечает 200

---

## Статусный блок

| PATCH | Описание | Статус |
|---|---|---|
| A | cb20 expiry alignment | Закрыт по data-proof |
| B | Деньги BY retro-backfill | Закрыт по proof |
| C | LibraryModule child access filtering | Закрыт как UI access-filter fix |
| D | Universal rules-retroapply engine | done |
| E | RetroApply conflict reclassification | done |
| F | Admin-controlled conflict resolution | done |
| G | Engine/UI truth repair | done |

### Pending runtime proofs (не блокируют, но не подтверждены)
- `reducible_by_rule` execute — нет живого кейса в текущем датасете
- `requires_manual_review` — нет живого кейса в текущем датасете
- Create-path execute proof — engine fix deployed, ожидает первого реального safe execute через UI
