да, согласен, с учетом правок:

&nbsp;

1. Выполняй этот PATCH только как SQL execute + proof, без новых кодовых изменений, потому что write-guards и readonly UI уже закрыты в v23.1.6 и их надо только пере-подтвердить, а не трогать повторно.
2. Перед execute обязательно покажи полный dry-run список именно тех 19 модулей, которые будут обновлены:  

  - module_id
  - title
  - parent_module_id
  - parent_title
  - inherited_product_id
  - inherited_product_name
3. &nbsp;
4. В execute добавь жёсткий stop-guard:  

  - update только child.product_id IS NULL
  - update только где parent.product_id IS NOT NULL
  - после dry-run ожидаем ровно 19 строк
  - если ROW_COUNT != 19, execute не делать и показать расхождение
5. &nbsp;
6. В post-check покажи не только сводку 29 / 51, но и:  

  - список 19 фактически обновлённых модулей
  - полный unresolved list из 51
  - отдельной секцией: какие из unresolved являются top-level контейнерами, какие — дочерними
7. &nbsp;
8. По write-guards не переписывать код, а дать proof по 4 точкам:  

  - useTrainingModules
  - ContentCreationWizard / handleSubmitLesson
  - ContentCreationWizard / handleSaveAccess
  - ContentSectionSelector
  - training-copy-move  
  Для каждой точки: условие guard + что произойдёт при product_id != null и при product_id == null.
9. &nbsp;
10. По readonly UI тоже без новых правок, но нужен proof по всем местам:  

  - AdminTrainingModules
  - ContentCreationWizard (оба сценария)
  - показать, что используется один и тот же ProductAccessInfoBlock, а не разные реализации
11. &nbsp;
12. В финальном отчёте отдельно зафиксируй архитектурный итог после этого патча:  

  - product SoT modules = 29
  - legacy modules = 51
  - conflicts = 0
  - unresolved = 51
  - module_access остаётся только как переходный legacy path
13. &nbsp;
14. Следующий патч после этого не размывать: он должен быть уже про ручное решение и перевод оставшихся 51 модулей, без возврата к уже закрытым PATCH v23.1.4–v23.1.6.

&nbsp;

&nbsp;

# План: PATCH v23.1.7 — Продолжение перевода training access на продуктовый SoT

## Диагностика

### Текущее состояние БД


| Категория                           | Количество |
| ----------------------------------- | ---------- |
| Модули с `product_id` (product SoT) | 10         |
| Модули без `product_id` (legacy)    | 70         |
| **Итого**                           | **80**     |


### Dry-run по оставшимся 70 модулям

**Ключевой факт**: все 70 оставшихся модулей имеют статус **NO_MAPPING** — у них **нет записей в `module_access**` вообще. Ни один из них не связан с тарифами/продуктами через `module_access`.

Это означает: **автоматический маппинг через `module_access → tariff → product` невозможен** — нечего маппить.

### Но есть наследование через parent_module_id

19 модулей являются **дочерними** к модулям, у которых уже есть `product_id`:


| Родительский модуль  | Продукт      | Детей без product_id |
| -------------------- | ------------ | -------------------- |
| Вебинары             | Gorbova Club | 11                   |
| Закрой год 2025-2026 | ЗАКРОЙ ГОД   | 6                    |
| Квесты               | Gorbova Club | 2                    |


Эти 19 модулей могут **однозначно** получить `product_id` от родителя. Маппинг детерминированный, конфликтов нет.

### Оставшиеся 51 модуль

51 модуль без `product_id`, без записей в `module_access`, без родителя с `product_id`. Среди них:

- 12 неактивных top-level модулей (Бонус-вебинар, Бухгалтер маркетплейсов, Деньги BY, старые версии и т.д.)
- ~20 дочерних модулей контейнера «Ценный бухгалтер | 1 ступень 2.0» (у которого тоже нет `product_id`)
- остальные — подмодули других неактивных контейнеров

Эти модули **невозможно автоматически перевести** без ручного решения о связи с продуктом.

---

## Предлагаемое решение

### Шаг 1: Dry-run — уже выполнен выше

Результат:

- **OK (наследование от родителя)**: 19 модулей
- **CONFLICT**: 0
- **NO_MAPPING**: 51 модуль

### Шаг 2: SQL migration — проставить product_id для 19 дочерних модулей

Идемпотентный UPDATE: дочерние модули наследуют `product_id` от родителя.

```sql
UPDATE training_modules child
SET product_id = parent.product_id
FROM training_modules parent
WHERE child.parent_module_id = parent.id
  AND parent.product_id IS NOT NULL
  AND child.product_id IS NULL;
```

**Guard**: только `product_id IS NULL` → идемпотентно. Только дочерние с явным родителем, у которого уже есть `product_id`.

**Post-check**: показать количество обновлённых + итоговое распределение.

### Шаг 3: Write-path guards — повторная проверка

Все 4 write-points уже имеют guard из v23.1.6. Нужно подтвердить, что для 19 новых product-linked модулей guard тоже сработает. Проверка по коду:

1. `**useTrainingModules.tsx**` — `createModule`: `effectiveProductId = data.product_id || newModule?.product_id` → skip. `updateModule`: `effectiveProductId = data.product_id ?? modules.find(...)?.product_id` → skip. ✅
2. `**ContentCreationWizard.tsx**` — `handleSubmitLesson` (строка 609-616): fetch `product_id` контейнера → skip. `handleSaveAccess` (строка 801-809): fetch `product_id` модуля → skip. ✅
3. `**ContentSectionSelector.tsx**` (строка 247): `if (!containerModule.product_id)` → skip. ✅
4. `**training-copy-move/index.ts**` (строка 209): `if (!mod.product_id)` → skip. ✅

**Вывод**: дополнительных исправлений write-path не требуется.

### Шаг 4: Readonly UI — уже унифицирован

Проверено в 3 местах:

- `AdminTrainingModules.tsx` (строка 346-349): `effectiveProductId` → `ProductAccessInfoBlock`
- `ContentCreationWizard.tsx` (строка 947-948): `targetModuleProduct` → `ProductAccessInfoBlock`
- `ContentCreationWizard.tsx` (строка 1053-1054): аналогично

Все используют **один и тот же компонент** `ProductAccessInfoBlock` с единым UX (бейдж, название продукта, кнопка перехода, пояснение). Дополнительной унификации не требуется.

### Шаг 5: Финальный реестр (после execute)


| Категория           | До патча | После патча |
| ------------------- | -------- | ----------- |
| product SoT         | 10       | **29**      |
| legacy (NO_MAPPING) | 70       | **51**      |
| conflict            | 0        | 0           |


---

## Unresolved list (51 модуль)

Модули без `product_id`, без `module_access`, без родителя с `product_id`. Все **не обновляются автоматически**.

Основные группы:

- «Ценный бухгалтер | 1 ступень 2.0» + 20 подмодулей — нет привязки к products_v2
- «Подоходный налог для физ лиц» + 3 подмодуля
- «Ценный бухгалтер | 2 ступень | 3 поток» + 1 подмодуль
- Неактивные одиночные модули (Бонус-вебинар, Бухгалтер маркетплейсов, Деньги BY 1/2, Марафон, ТЕСТ и т.д.)

**Причина**: у этих модулей нет ни одной записи в `module_access` и нет связи с `products_v2`. Для перевода нужно ручное решение о привязке к продукту.

---

## Изменяемые компоненты


| Файл          | Изменение                                 |
| ------------- | ----------------------------------------- |
| SQL migration | UPDATE product_id для 19 дочерних модулей |


Код **не меняется** — все guards и readonly UI уже работают из v23.1.6.

## Что НЕ делаем

- Не меняем код (guards и UI уже работают)
- Не трогаем `grant-access-for-order`, `access_rules`, entitlements
- Не обновляем модули без подтверждённого маппинга
- Не удаляем `module_access`

## STOP-guards

- Если UPDATE затронет больше 19 строк → остановить
- Если UPDATE затронет строки с уже заполненным `product_id` → невозможно (WHERE `product_id IS NULL`)

## DoD

1. Dry-run показан: 19 OK (наследование), 0 CONFLICT, 51 NO_MAPPING
2. product_id проставлен для 19 дочерних модулей
3. Post-check: 29 модулей на product SoT, 51 на legacy
4. Conflict list пуст
5. Unresolved list: 51 модуль без автоматического маппинга
6. Write-guards подтверждены для всех 4 write-points (код не менялся)
7. Readonly UI унифицирован (один компонент во всех местах, код не менялся)
8. Финальный реестр собран
9. Ничего не сломано

## Deferred (следующий патч)

- Ручное решение по привязке 51 оставшегося модуля к продуктам
- Для «Ценный бухгалтер 1 ступень 2.0» — нужно создать/найти продукт в `products_v2` и привязать
- Постепенное сворачивание legacy `module_access`