# План: 4 патча — cb20 repair, Деньги BY closure, LibraryModule access filter, Universal RetroApply Engine

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

### Проблема
Ложные конфликты: записи с safe source и правильным lineage попадали в `conflict_existing`.

### Что изменено

**Engine (`supabase/functions/rules-retroapply/index.ts`):**
- Batch-проверка дублей: fetch ALL active entitlements per (user_id, target_product_id), count > 1 = `conflict_multiple_entitlements`
- Safe source detection через `meta` (нет колонки `source` в entitlements): `batch_id`, `retroapply`, `source_type`
- Lineage check: `meta.source_rule_id` должен совпадать или быть пустым
- Новая классификация:
  - `safe_recalculate_expires_extended` — planned > current, safe source
  - `safe_recalculate_expires_missing` — current IS NULL, safe source
  - `safe_recalculate_available_but_disabled` — safe, но recalculate выключен
  - `conflict_manual_source` — source manual/admin/unknown
  - `conflict_different_rule_source` — source_rule_id ≠ current rule
  - `conflict_multiple_entitlements` — >1 active на один target
  - `conflict_would_reduce_access` — planned < current
  - `conflict_no_planned_expiry` — planned не вычислен
- executeActions: `aligned_update_needed` с `safe_recalculate_available_but_disabled` → skip, остальные → update
- meta обновляется при update: `source_rule_id`, `retroapply_updated`, `batch_id`

**UI (`src/components/admin/product/RetroApplyPanel.tsx`):**
- Все новые reason-коды добавлены в `REASON_LABELS` с русскими переводами
- `aligned_update_needed` описание: «Доступ уже есть, будет обновлён только срок»

### Proof (правило 6ba9727e, Деньги BY)

| Режим | conflict_existing | aligned_update_needed | already_satisfied | missing_access |
|---|---|---|---|---|
| BEFORE (старая логика) | ~110 false conflicts | 0 | 0 | 110 |
| preview recalculate=false | 0 | 8 (disabled) | 102 | 0 |
| preview recalculate=true | 0 | 8 (missing expires) | 102 | 0 |
| execute recalculate=true | 0 | 8 → updated=8 | 102 | 0 |
| repeat execute | 0 | 0 | 110 | 0, updated=0 |

**Breakdown конфликтов:** 0 реальных конфликтов. Все 8 safe-update записей — `expires_at IS NULL` с source_rule_id = текущее правило.

### DoD
- [x] Ложные конфликты = 0
- [x] Safe-кейсы в `aligned_update_needed` с правильными reason-кодами
- [x] `recalculate_existing = false` → `updated = 0`
- [x] `recalculate_existing = true` → `updated = 8`
- [x] Повторный execute → `updated = 0` (idempotency)
- [x] `conflict_existing = 0` (нет реальных конфликтов в этом кейсе)
- [x] UI переводы добавлены

---

## Статусный блок

| PATCH | Описание | Статус |
|---|---|---|
| A | cb20 expiry alignment | Закрыт по data-proof |
| B | Деньги BY retro-backfill | Закрыт по proof |
| C | LibraryModule child access filtering | Закрыт как UI access-filter fix |
| D | Universal rules-retroapply engine | done |
| E | RetroApply conflict reclassification | done |
