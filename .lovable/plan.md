# Sprint v23 — Access Rules UI + Mapping Consolidation

## Статус

```
SPRINT = v23
PHASE_A = DONE (access_rules table + runtime read path + legacy fallback)
PHASE_B = DONE (Product UI — Access Rules tab)
PHASE_C = IN PROGRESS (mapping consolidation)
PHASE_D = IN PROGRESS (visual polish)
```

## Что сделано

### Phase A — Rule model + runtime read path
- [x] Таблица `access_rules` создана (migration)
  - scope: product_id / tariff_id
  - grant_target_type: entitlement | club | email | product_access
  - target_ref, target_label, is_active, priority, duration_days, conditions, notes
  - UNIQUE constraint на (product_id, tariff_id, grant_target_type, target_ref)
  - RLS: authenticated read/write
- [x] `grant-access-for-order` обновлён: читает access_rules (tariff → product), fallback на legacy product_club_mappings
- [x] Legacy таблицы (product_club_mappings, product_email_mappings) НЕ удалены — работают как fallback

### Phase B — Product UI
- [x] `ProductAccessRulesTab` — новая вкладка "Доступы" в /admin/products-v2/:id
  - Список правил с фильтрами (active/inactive, тип)
  - Create/Edit правила через диалог
  - Toggle active/inactive, delete
  - Конфликт-детекция (duplicate target в разных scope)
  - Preview / Explain panel — показывает effective grants для выбранного тарифа
  - Legacy mappings panel — показывает старые привязки и статус миграции
  - Source indicators: rule / legacy, product / tariff scope

### Phase C — Mapping consolidation (TODO)
- [ ] Связывание legacy mappings с новым rules-layer
- [ ] Migration indicators в legacy panel

### Phase D — Visual polish (TODO)
- [ ] Warning badges для конфликтов в основном списке
- [ ] Runtime proof на реальном продукте

## Scope v23

### Включено
- Access Rules UI (вкладка в product editor)
- Mapping Rules consolidation
- Visual controls (фильтры, badges, конфликты)
- Preview / Explain
- New rules-layer + legacy fallback

### Не включено
- grant vs extend semantic refactor
- dead code cleanup
- cutover
- новый backend sprint по ledger

## Файлы

| Файл | Описание |
|------|----------|
| `src/hooks/useAccessRules.ts` | Hook для CRUD access_rules + legacy mappings + effective grants |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | UI компонент вкладки Access Rules |
| `supabase/functions/grant-access-for-order/index.ts` | Runtime: access_rules → legacy fallback |
