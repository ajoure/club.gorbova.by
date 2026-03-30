# PATCH v23.1.3A — ВЫПОЛНЕН ✅

## Что сделано
1. **Numeric input fix**: priority `""` вместо `"0"`, убран onBlur normalize, placeholder="0"
2. **Entitlement display**: человекочитаемые названия + код мелким шрифтом
3. **Domain/section rollback**: тип `email` убран из селектора типа цели

---

# PATCH v23.1.3B — ВЫПОЛНЕН ✅

## Что сделано

### 1. Conditional service rule — UI
- При выборе назначения «Служебное» появляется блок «Выдавать только если ранее покупал»
- Переключатель `has_condition` + селект продукта-условия + опциональный тариф
- Подпись: «Доступ будет выдан только если у покупателя есть оплаченный заказ на выбранный продукт»
- Условие сохраняется в `conditions` JSONB (ID-based):
  ```json
  {
    "rule_purpose": "service",
    "condition_type": "prior_purchase",
    "required_product_id": "uuid",
    "required_tariff_id": "uuid (опционально)",
    "match_mode": "any_paid_order"
  }
  ```

### 2. Runtime — prior_purchase check в grant-access-for-order
- При чтении access_rules для club grants: проверка `conditions.condition_type === "prior_purchase"`
- Проверка по `orders_v2` (user_id + product_id + status='paid')
- Если условие не выполнено → skip + ledger entry `status: "skipped"`, `reason_code: "condition_not_met"`
- Если выполнено → grant как обычно
- Безусловные правила (без conditions) продолжают работать без изменений
- Iterates all matching rules by priority (не limit 1) — первое прошедшее условие побеждает

### 3. Edit support
- При редактировании существующего правила с condition — состояние восстанавливается из conditions JSONB

## Изменённые файлы
- `src/components/admin/product/ProductAccessRulesTab.tsx` — UI блок условного правила
- `supabase/functions/grant-access-for-order/index.ts` — runtime condition check + ledger skip

## DoD v23.1.3B
1. ✅ Условное правило можно создать через UI (rule_purpose=service + condition)
2. ✅ Условие сохраняется в conditions JSONB (ID-based, без изменения schema)
3. ✅ Runtime проверяет prior_purchase перед выдачей
4. ✅ При невыполнении условия → skip + ledger entry skipped_by_condition
5. ✅ Существующие безусловные правила не затронуты
6. ✅ match_mode зафиксирован как any_paid_order (default)

---

# PATCH v23.1.3B correction — ВЫПОЛНЕН ✅

## Что исправлено

### Проблема
Блок условия «Выдавать только если ранее покупал» показывался только при `rule_purpose === "service"`, вынуждая использовать служебное назначение и entitlement-коды для кейса product_access.

### Исправление
1. Condition block guard: `rule_purpose === "service"` → `grant_target_type === "product_access"`
2. Добавлен badge условия в карточке правила: «Условие: ранее покупал {продукт}»
3. Runtime, save, edit restore — без изменений (уже работают для любого target type)

## DoD correction
1. ✅ Блок «Выдавать только если ранее покупал» доступен при grant_target_type=product_access
2. ✅ Кейс ЦБ настраивается через «Доступ к продукту» + условие, без entitlement-кодов
3. ✅ В списке правил виден badge условия
4. ✅ Runtime prior_purchase check продолжает работать (без изменений)

## Следующий шаг
- Runtime proof по кейсу BUSINESS → доступ к ЦБ только при наличии prior purchase
- Proof fixtures: создать тестовое правило → verify granted/skipped в ledger
