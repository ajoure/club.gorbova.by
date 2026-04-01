

# План: Привязка продукта к форме + создание сделки (финальная версия)

## Правки к предыдущей версии

### 1. Без fallback для `order_number`
Если `generate_order_number` вернул ошибку — шаг `create_order` завершается `failed`. Никакого альтернативного формата.

### 2. NULL-safe дедупликация по `tariff_id`
Каноническое условие:
```sql
profile_id = $1 AND product_id = $2 
AND reconcile_source = 'site_form'
AND status IN ('draft', 'pending')
AND (
  (tariff_id IS NULL AND $3 IS NULL) 
  OR tariff_id = $3
)
```
В коде edge function — два отдельных запроса или `.is('tariff_id', null)` / `.eq('tariff_id', tariff_id)` в зависимости от наличия.

---

## Шаги

### 1. SQL миграция
```sql
ALTER TABLE site_form_submissions 
  ADD COLUMN order_id UUID REFERENCES orders_v2(id);
```

### 2. FormBlockEditor — секция «Привязка к продукту»
- Под полями формы — опциональная секция
- Select «Продукт» → `products_v2` (`is_active = true`), паттерн из `PricingBlockEditor`
- Select «Тариф» → `tariffs` по выбранному `product_id` (`is_active = true`)
- Кнопка «Убрать привязку» для сброса
- Сохраняются в `content.product_id`, `content.tariff_id`

### 3. FormSection — передача в payload
- Из `content` извлечь `product_id`, `tariff_id`
- Добавить в тело запроса к edge function (только если заданы)

### 4. site-form-submit — расширение

**Валидация (если product_id передан):**
1. `products_v2` — `id = product_id AND is_active = true` → иначе 400
2. Если `tariff_id` — `tariffs` — `id = tariff_id AND product_id = product_id AND is_active = true` → иначе 400
3. Workspace: `// products_v2 has no workspace_id (legacy model)` — явный комментарий

**Создание заказа (после CRM resolve, если profileId И product_id):**
1. Domain event `site_form_order_requested`
2. Дедупликация с NULL-safe условием:
   - `tariff_id` задан → `.eq('tariff_id', tariff_id)`
   - `tariff_id` не задан → `.is('tariff_id', null)`
   - Плюс: `profile_id`, `product_id`, `reconcile_source = 'site_form'`, `status IN ('draft','pending')`
3. Найден → **reuse**: `submission.order_id = existing.id` + execution `reuse_order` + audit `site_form_order_reused`
4. Не найден → **create**:
   - `generate_order_number` RPC. **Если ошибка → execution `create_order` = failed, заказ НЕ создаётся**
   - Цена: `tariff_offers` (is_active, is_primary) → `base_price/final_price`; без offer → 0; без тарифа → 0
   - INSERT `orders_v2` (status=draft, reconcile_source=site_form)
   - UPDATE `submission.order_id`
   - Execution `create_order` (completed) + audit `site_form_order_created`

**Без profileId** → заказ не создаётся, execution `create_order` = skipped

### 5. Обратная совместимость
- Формы без `product_id` → без изменений
- Старые submissions без `order_id` → NULL

## Изменяемые файлы

| Файл | Действие |
|---|---|
| SQL миграция | ADD `order_id` FK |
| `FormBlockEditor.tsx` | Select продукта + тарифа |
| `FormSection.tsx` | Передача product_id/tariff_id |
| `site-form-submit/index.ts` | Валидация, event, NULL-safe dedup, order creation, audit |

## DoD
- Выбор продукта/тарифа в редакторе формы работает
- Серверная валидация product/tariff активности и связки
- `generate_order_number` fail → order не создаётся, execution failed
- Дедупликация: `tariff_id IS NULL` корректно матчится с заказом без тарифа
- `submission.order_id` проставляется и при create, и при reuse
- Audit logs для created и reused
- Без продукта — поведение без изменений

