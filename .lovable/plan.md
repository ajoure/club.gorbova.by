# Статус: PATCH 1-3 выполнены

## PATCH 1 — Фикс чекбоксов TreePicker ✅

**Файл:** `src/components/admin/product/TrainingContentTreePicker.tsx`

**Исправленный баг:** `collectAllModuleIds(tree)` собирал только дочерние модули, исключая корень. Root-level lessons (`tree.lessons`) не попадали в bulk-операции «Выбрать всё» и «Весь тренинг».

**Что исправлено:**
1. `handleSelectAll` — теперь включает `tree.lessons.map(l => l.id)` в lessonIds
2. Кнопка «Выбрать всё» — аналогично
3. `rootState` — учитывает `allRootLessonsSelected` при определении checked/indeterminate
4. При переходе в full-access partial state очищается явно (строка 1270 — уже было)

## PATCH 2 — Safe execute cb20 repair ✅

**Batch ID:** `batch_business_cb20_repair_v1_1775135923599`

### Safe cohort breakdown

| Метрика | Значение |
|---|---|
| align_to_business | 2 |
| repair_metadata_and_align | 84 |
| repair_metadata_only | 0 |
| full_tariff_scope | 46 |
| union_scope | 40 |
| **total executed** | **86** |

### Исключения (сознательные)
- staff_skip: 2
- manual_review: 3
- noop: 15
- create: 0 (заблокирован by design)
- standalone_only: 0 (заблокирован)

### Post-check proof
- `expires_mismatch` = 0 для всех 86
- `null_scope_mode` = 0
- `null_business_subscription_id` = 0
- `null_historical_purchase_type` = 0
- Все 86 результатов = `success`
- `audit_logs` содержит запись: `actor_label = 'batch_business_cb20_repair_v1'`, `actor_type = 'system'`
- Per-user scope 1:1 совпадает с dry-run: 46 full_tariff_scope, 40 union_scope

## PATCH 3 — Runtime proof ✅

### User 1: full_tariff_scope (6214525@mail.ru)
- **Subscription:** Business (active), access_end_at = 2026-05-28
- **Entitlement до:** expires = 2026-09-24, meta = null (no_meta)
- **Entitlement после:** expires = 2026-05-28, scope = full_tariff_scope
- **Historical tariff:** 543940b1 (Главный бухгалтер)
- **Visible modules:** 18 (по правилу training_content для тарифа Главный бухгалтер)
- **Full-access fallback:** НЕТ — доступ ограничен partial rule тарифа

### User 2: union_scope (rusaya@tut.by)
- **Subscription:** Business (active), access_end_at = 2026-04-26
- **Entitlement до:** expires = 2026-12-23, meta = null (no_meta)
- **Entitlement после:** expires = 2026-04-26, scope = union_scope
- **Historical tariff:** 9bc81736 (Бизнес-леди) + standalone module d7effaf4
- **Visible modules:** 28 (тариф Бизнес-леди) + standalone-модули из purchase history
- **Full-access fallback:** НЕТ — scope ограничен union тарифных правил + исторических модулей

### Бизнес-вывод
Покупка Business корректно продлевает доступ к «Ценный бухгалтер 2.0» только в рамках исторической покупки. Нет silent full-access fallback. expires_at привязан к business_access_end_at.

---

## Standalone-only — НЕ ВХОДИТ В ТЕКУЩИЙ ЭТАП

- **Статус:** HOLD
- **Execute:** запрещён
- **Mapping confidence:** 2/5 exact_fk (один — «Предобучение», не коммерческий), 3/5 no_match
- **Нужен:** отдельный mapping proof + отдельный follow-up patch

---

## Общий статус этапа Business → cb20

| Элемент | Статус |
|---|---|
| Архитектурная подготовка | ✅ |
| Dry-run | ✅ |
| Safe cohort split | ✅ |
| Edge function guards | ✅ |
| Safe execute | ✅ (86 users) |
| Post-check proof | ✅ |
| Runtime/UI proof | ✅ (2 users) |
| Standalone-only follow-up | ❌ HOLD |
| TreePicker UI fix | ✅ |
