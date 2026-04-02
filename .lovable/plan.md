# да, согласен, с учетом правок:

&nbsp;

1. **Отдельно выделить PATCH F — исправление отображения модульных покупок в сделках**
  &nbsp;
  - В /admin/deals и в DealDetailSheet не показывать корневой продукт Ценный бухгалтер | 1 ступень 2.0 | для module_only_standalone.
  - Для display name использовать уже существующие данные, без создания новых сущностей:
    &nbsp;
    - приоритет 1: purchase_snapshot.display_purchase_name
    - приоритет 2: resolved name из purchase_snapshot.module_list_mapped[] -> products_[v2.name](http://v2.name)
    - приоритет 3: products_[v2.name](http://v2.name) по orders_v2.product_id
    &nbsp;
  - Добавить явный бейдж Модульная покупка для historical_purchase_type = module_only_standalone.
  &nbsp;
2. **Зафиксировать, что в БД уже есть все нужные связи**
  &nbsp;
  - Ничего дополнительно не создавать в products_v2, orders_v2, training_modules, deals.
  - Задача — правильно использовать уже существующие:
    &nbsp;
    - orders_v2.product_id
    - purchase_snapshot.display_purchase_name
    - purchase_snapshot.module_list_mapped
    - deals/order linkage
    &nbsp;
  - В плане явно прописать: **source of truth уже существует, нужен только correct resolution в UI и в dry-run.**
  &nbsp;
3. **Добавить proof-таблицу по 4 пользователям standalone-only**
  &nbsp;
  - Для 4 пользователей, у которых нет root CB20 entitlement, но есть только модульные покупки, вывести:
    &nbsp;
    - user_id
    - profile_id
    - email
    - business_subscription_id
    - business_access_end_at
    - root_cb20_entitlement_id
    - root_cb20_order_ids
    - module_order_ids
    - module_product_ids
    - module_display_names
    - mapping_status
    &nbsp;
  - Эти 4 кейса подготовить как отдельный список для ручной проверки и ручного решения.
  &nbsp;
4. **PATCH E разделить на 2 независимых потока**
  &nbsp;
  - **E-display**: исправление отображения standalone-module orders в сделках.
  - **E-access**: отдельная логика cohort standalone_safe.
  - Не смешивать исправление названий в UI сделок с выдачей доступов.
  &nbsp;
5. **По Царёвой сделать отдельный reference-case в proof**
  &nbsp;
  - Показать:
    &nbsp;
    - её реальные module orders,
    - текущее неверное UI-отображение,
    - purchase_snapshot.display_purchase_name,
    - expected display name,
    - текущий статус entitlement,
    - ожидаемый результат после выбранного режима (strict_hold или partial_safe).
    &nbsp;
  &nbsp;
6. **Для PATCH F добавить обязательную таблицу resolution**
  &nbsp;
  - deal_display_resolution_table:
    &nbsp;
    - deal_id
    - order_id
    - fk_product_name
    - snapshot_display_purchase_name
    - resolved_display_name
    - resolution_source
    &nbsp;
  - Это нужно и для списка сделок, и для карточки сделки.
  &nbsp;
7. **В PATCH C дополнить управление rule-linked training**
  &nbsp;
  - Помимо К правилам, добавить:
    &nbsp;
    - Редактировать правило
    - Удалить связь
    &nbsp;
  - Если rule_count > 1 — сначала список/выбор конкретного правила.
  - Удаление связи = только is_active = false, без смены owner и без удаления тренинга.
  &nbsp;
8. **Для удаления rule-linked связи добавить confirmation + impact preview**
  &nbsp;
  - Перед soft-disable показывать:
    &nbsp;
    - какое правило отключается,
    - какой тариф затрагивается,
    - access_mode,
    - сколько active grants / пользователей может затронуть.
    &nbsp;
  - Без preview удаление не выполнять.
  &nbsp;
9. **PATCH E1 ужесточить по mapping**
  &nbsp;
  - Полностью убрать ветку с training_modules.code.
  - Matching делать в строгом порядке:
    &nbsp;
    1. explicit/manual alias
    2. normalized exact match по children CB20 root
    3. иначе HOLD
    &nbsp;
  - Не использовать “широкий” fuzzy match без доказуемости.
  &nbsp;
10. **По “Строительству” зафиксировать отдельный outcome**
  &nbsp;
  - Либо exact child-match доказан и попадает в safe mapping,
  - либо фиксируется как unmapped_missing_content.
  - Не допускать открытия доступа к неверному модулю.
  &nbsp;
11. **В PATCH E явно потребовать выбор одного из двух режимов**
  &nbsp;
  - strict_hold: если хотя бы один модуль не сматчен — весь пользователь HOLD
  - partial_safe: выдаём доступ только к сматченным модулям
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

- Подрядчик должен явно указать, какой режим выбран, и почему.

&nbsp;

&nbsp;

&nbsp;

12. **Если выбирается partial_safe, обязать писать расширенную meta**
  &nbsp;
  - historical_module_product_ids
  - mapped_training_module_ids
  - unmapped_historical_module_product_ids
  - mapping_version
  - mapping_confidence_summary
  &nbsp;
13. **PATCH B не закрывать теоретической диагностикой**
  &nbsp;
  - Нужен browser-proof под ролью admin:
    &nbsp;
    - открыть урок,
    - нажать редактирование,
    - сохранить изменения,
    - открыть editor блоков,
    - сохранить изменения.
    &nbsp;
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

- Только после этого считать PATCH B закрытым.
- Если не работает — уже отдельный fix patch с конкретной ошибкой.

&nbsp;

&nbsp;

&nbsp;

14. **Добавить полный proof по цепочке продукт → тариф → тренинг → сделка → доступ → срок**
  &nbsp;
  - Отдельные таблицы:
    &nbsp;
    - standalone_4_users_table
    - deal_display_resolution_table
    - mapping_proof_table
    - standalone_dry_run_table
    - runtime_access_table
    - lesson_edit_admin_proof
    &nbsp;
  &nbsp;
15. **DoD дополнить**
  &nbsp;
  - В сделках standalone-модуль отображается как реальный модульный продукт, а не как root CB20.
  - 4 standalone-only пользователя перечислены отдельно и готовы для ручного решения.
  - Rule-linked training можно редактировать и soft-remove без смены owner.
  - Proof-таблицы подтверждают корректную цепочку данных и сроков доступа.
  &nbsp;
16. **Отдельно зафиксировать ограничение**
  &nbsp;
  - Никаких новых продуктов, сделок, заказов, модулей и “искусственных” связей не создавать.
  - Разрешены только:
    &nbsp;
    - read/discovery,
    - UI resolution,
    - точечная выдача entitlement в рамках выбранного cohort,
    - soft-disable существующих access_rules.
    &nbsp;
  &nbsp;

&nbsp;

План: PATCH C + E + F — управление rule-linked, standalone cohort, отображение сделок

## Диагноз

### Факты из БД

**Царёва Ирина ([irinkazar@inbox.ru](mailto:irinkazar@inbox.ru)):**

- user_id: `5c6e6e0f`, profile_id: `f18d750e`
- BUSINESS sub: `161a0644`, access_end_at: 18.04.2026
- CB20 orders: 2 (GC-3828984 и GC-1767629483208), оба `module_only_standalone`
- CB20 entitlement: **ОТСУТСТВУЕТ** (единственная non-staff без entitlement)
- Модули: Строительство (f833c846), Розничная торговля (abee24cd), Грузоперевозки (64d9f812), Производство (064dd768)

**Модуль "Строительство":**

- training_module `b7bae7fd` — IS direct child of CB20 root `c9f7e9b8`
- product_id: NULL (не привязан к модульному продукту)
- Название training_module и products_v2 ИДЕНТИЧНЫ: "Ценный бухгалтер | 1 ступень 2.0 | Модуль: Строительство"
- Маппинг сломан потому что `tryNameMatch` ищет только по ROOT modules (`parent_module_id IS NULL`), а "Строительство" — child

**Standalone cohort summary:**

- Всего ~20+ standalone BUSINESS пользователей
- Большинство УЖЕ имеют CB20 entitlement (created ранее батчем)
- Без entitlement: только Царёва и [a.bruylo@ajoure.by](mailto:a.bruylo@ajoure.by) (staff → skip)
- Т.е. реальный standalone_safe execute = **1 пользователь** (Царёва)

**UI сделок:**

- `DealDetailSheet.tsx` строка 552: `product?.name` — берёт из FK join `products_v2.name`
- Все standalone-module orders имеют `product_id = 7101ed3c` (корневой CB20)
- `purchase_snapshot.display_purchase_name` уже содержит правильное название ("ЦБ 2.0: Строительство"), но **нигде не используется**
- Результат: в карточке сделки модульная покупка отображается как корневой "Ценный бухгалтер | 1 ступень 2.0 |"

---

## PATCH F — Корректное отображение модульных покупок в сделках

**Файл: `src/components/admin/DealDetailSheet.tsx**`

Проблема: строка 552 всегда показывает `product?.name` из FK join. Для `module_only_standalone` это корневой CB20.

Решение — добавить display name resolution:

```
const displayProductName = useMemo(() => {
  const snapshot = deal.purchase_snapshot as Record<string, any> | null;
  // Приоритет 1: display_purchase_name из snapshot (уже содержит конкретные модули)
  if (snapshot?.display_purchase_name) return snapshot.display_purchase_name;
  // Приоритет 2: FK product name
  return product?.name || "—";
}, [deal, product]);
```

Применить `displayProductName` вместо `product?.name` в:

1. Карточка "Данные сделки" → поле "Продукт" (строка 552)
2. Если `historical_purchase_type === 'module_only_standalone'` — добавить бейдж "Модульная покупка"

**Файл: `src/pages/admin/AdminDeals.tsx**` (список сделок)

Аналогичный resolution для колонки "Продукт" в таблице — приоритет `purchase_snapshot.display_purchase_name` над `products_v2.name`.

**Правила:**

- Никаких новых записей в products_v2, orders_v2, training_modules не создавать
- Source of truth: `purchase_snapshot.display_purchase_name` (уже есть в БД)
- Для non-historical заказов — без изменений, используется FK product name

---

## PATCH E — Standalone cohort: mapping fix + разблокировка

### E1 — Исправить mapping в repair-cb20-entitlements

**Файл: `supabase/functions/repair-cb20-entitlements/index.ts**`

Текущий баг: `tryNameMatch` сравнивает product name с ROOT modules (`parent_module_id IS NULL`). "Строительство" — child of CB20 root → no_match.

Исправления:

1. Убрать обращение к `training_modules.code` (колонка не существует, строка 387/407)
2. В маппинге добавить поиск по children CB20 root (`parent_module_id = 'c9f7e9b8-...'`):
  - explicit alias map (не нужен — названия совпадают 1:1)
  - normalized exact match: extract short name из product name ("Модуль: Строительство" → "строительство"), сравнить с child title (case-insensitive, contains)
  - всё остальное = HOLD
3. НЕ использовать неограниченный fuzzy match

### E2 — Отдельный execute cohort `standalone_safe`

Добавить `execute_cohort = 'standalone_safe'` со следующими критериями:

- `historical_purchase_type = module_only_standalone`
- Активный BUSINESS с `business_access_end_at IS NOT NULL`
- ВСЕ модули пользователя прошли mapping (confidence ≥ exact_name)
- `runtime_preview.visible_recursive_lesson_count > 0`
- НЕ staff (@ajoure.by)

**Два режима:**

- `strict_hold`: если хотя бы 1 модуль не сматчен — весь кейс HOLD
- `partial_safe`: выдаём доступ только к доказуемо сматченным модулям

Для execute явно указать выбранный режим в dry-run output.

### E3 — Meta-поля entitlement для standalone

При создании entitlement обязательно включить:

- `scope_resolution_mode: 'module_scope_only'`
- `historical_module_product_ids`
- `mapped_training_module_ids`
- `unmapped_historical_module_product_ids` (если partial_safe)
- `mapping_version: 'v2_children_match'`
- `mapping_confidence_summary`
- `business_subscription_id`
- `expires_at = business_access_end_at`

### E4 — Dry-run table (обязательный)

Перед execute показать таблицу:
| user_id | email | business_sub_id | business_end | module_products | mapped_training_ids | mapped_titles | confidence | visible_lessons | planned_action | mode | reason |

---

## PATCH C — Управление rule-linked training

**Файл: `src/components/admin/product/ProductLinkedTrainingsBlock.tsx**`

Расширить `RuleLinkedTrainingCard` (строка 568):

1. Заменить единственную кнопку "К правилам" на dropdown-меню:
  - **Редактировать правило** → если rule_count = 1, вызвать callback `onEditRule(ruleId)`; если > 1, показать мини-список правил для выбора
  - **Удалить связь** → soft disable: `is_active = false` через supabase update
  - **К правилам** (оставить как третий вариант)
2. **Confirmation modal для удаления связи:**
  - Impact preview: какое правило, какой тариф, какой scope
  - Текст: "Будет деактивировано правило доступа. Владелец тренинга не изменится. Доступ для покупателей этого продукта к тренингу будет прекращён."
  - Не удалять тренинг, не менять owner
3. **При нескольких правилах (rule_count > 1):**
  - Показать список: id / тариф / access_mode / is_active
  - Действие на конкретное правило, не на все сразу
4. **Для owned + rule-linked:**
  - Одна карточка
  - Два бейджа: Владелец + Через правило
  - Два набора действий визуально разделены

**Файл: `src/components/admin/product/ProductAccessRulesTab.tsx**`

Добавить callback `onEditRule(ruleId)` — открыть edit-dialog с предзаполнением из существующего правила.

---

## PATCH B — Admin lesson editing proof

Фактическая проверка через browser tools:

1. Открыть тренинг → список уроков
2. Нажать edit на уроке
3. Изменить и сохранить
4. Открыть block editor, изменить, сохранить
5. Зафиксировать результат

---

## PATCH D — Proof-пакеты

### standalone_4_users_table

По Царёвой + 3 других standalone (из запроса: [a.bruylo@ajoure.by](mailto:a.bruylo@ajoure.by)=staff skip, 19na1991=уже есть ent, 447417148=уже есть ent):

- Реально без entitlement только Царёва и staff
- Таблица: user / email / BUSINESS sub / end_at / modules / root ent / mapping status

### deal_display_resolution_table

Для Царёвой показать:

- order_id / product_id (FK) / purchase_snapshot.display_purchase_name / current UI display / expected UI display

### mapping_proof_table

Для каждого модуля Царёвой:
| module_product_id | product_name | child_training_module_id | child_title | confidence | match_reason |

### runtime_access_table (post-execute)

3 кейса: full / partial (Царёва) / no access

### lesson_edit_admin_proof

Browser proof screenshots

---

## Файлы для изменения


| Файл                                                           | Что                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `src/components/admin/DealDetailSheet.tsx`                     | PATCH F: display_purchase_name resolution                 |
| `src/pages/admin/AdminDeals.tsx`                               | PATCH F: display_purchase_name в списке                   |
| `supabase/functions/repair-cb20-entitlements/index.ts`         | PATCH E: fix children matching, standalone_safe cohort    |
| `src/components/admin/product/ProductLinkedTrainingsBlock.tsx` | PATCH C: edit/delete rule-linked actions + impact preview |
| `src/components/admin/product/ProductAccessRulesTab.tsx`       | PATCH C: onEditRule callback                              |


## DoD

### PATCH F

- В сделках standalone users отображается `display_purchase_name` (модульный продукт), а не корневой ЦБ 2.0
- Бейдж "Модульная покупка" для `module_only_standalone`
- Никаких новых записей в БД не создаётся

### PATCH E

- `training_modules.code` убран из mapping логики
- Matching по children CB20 root работает (Строительство сматчено)
- `standalone_safe` cohort выделен отдельно от `safe_only`
- Dry-run table показана перед execute
- Царёва получает CB20 entitlement с `module_scope_only` и expires_at = 18.04.2026
- Meta содержит все обязательные поля

### PATCH C

- Rule-linked тренинг можно редактировать через конкретное правило
- Rule-linked тренинг можно soft-remove (is_active=false) с confirmation + impact preview
- При нескольких правилах — выбор конкретного
- Owner тренинга не меняется при удалении rule-link

### PATCH B

- Admin может открыть, редактировать, сохранить урок — browser proof

### PATCH D

- standalone_4_users_table собрана
- deal_display_resolution_table собрана
- mapping_proof_table собрана
- runtime_access_table: 3 кейса
- lesson_edit_admin_proof: browser screenshots

## Scope boundary

- Save-path rule engine не меняем
- DB schema не меняем (кроме entitlements insert в execute)
- Standalone-only обрабатывается изолированно через отдельный cohort
- Никаких новых products/orders/training_modules не создаётся