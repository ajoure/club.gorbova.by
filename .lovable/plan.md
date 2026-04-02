# да, согласен, с учетом правок:

&nbsp;

1. **Не открывать новый мини-спринт поверх текущего.**
  В плане явно зафиксировать: PATCH F / G / E / C / B уже частично реализованы, текущая задача — **довести до полного DoD и собрать proof**, а не переписывать план с нуля.
2. **PATCH F скорректировать по факту.**
  Убрать из плана пункты про добавление display_purchase_name resolution в 6 файлов как новую работу — это уже сделано.
  Оставить только незавершённое:
  &nbsp;
  - warning badge Historical name missing там, где его ещё нет
  - единая проверка всех экранов, что resolution реально работает
  &nbsp;
3. **PATCH F — warning badge оформить как отдельный добивочный подпункт.**
  Добавить только в оставшиеся места, где ещё нет warning при:
  &nbsp;
  - historical_purchase_type = 'module_only_standalone'
  - display_purchase_name IS NULL
  &nbsp;
4. **PATCH C не расписывать заново как будто он не сделан.**
  Зафиксировать: dropdown, delete, multi-rule selector и soft-disable уже реализованы.
  Осталось только:
  &nbsp;
  - добавить tariff name в selector
  - добавить tariff name в confirmation dialog
  - проверить impact preview
  &nbsp;
5. **В PATCH C убрать расплывчатость.**
  Для multi-rule selector обязательно показывать:
  &nbsp;
  - rule id
  - tariff name
  - access_mode
  - is_active
  - target_label
  &nbsp;
6. **PATCH G не трогать и не переписывать заново.**
  Зафиксировать как статус:
  &nbsp;
  - edge function создана
  - dry_run уже выполнен
  - получено 7 parent → 22 child
    Следующий шаг по G — не discovery, а:
  - execute_children_only
  - post_check
  - finalize_parents
  &nbsp;
7. **PATCH E тоже не возвращать в discovery.**
  Зафиксировать: repair function уже доработана (tryChildNameMatch, standalone_safe, meta fields).
  Следующий шаг:
  &nbsp;
  - dry-run после PATCH G
  - показать standalone cohort table
  - согласовать режим (partial_safe / strict_hold)
  - execute
  &nbsp;
8. **PATCH D сделать не “когда-нибудь”, а обязательным deliverable текущего пакета.**
  Оставить только реально несущие таблицы:
  &nbsp;
  - deal_display_resolution_table
  - standalone_4_users_table
  - mapping_proof_table
  - standalone_dry_run_table
  &nbsp;
9. **PATCH B не формулировать абстрактно.**
  Зафиксировать как обязательный proof-блок:
  &nbsp;
  - browser proof под admin
  - browser proof под superadmin
  - если не работает — точечный фикс в этом же спринте
  &nbsp;
10. **Скорректировать execution order по текущему фактическому статусу.**
  Правильный порядок сейчас:
  &nbsp;
  1. добить PATCH F warning badges
  2. добить PATCH C tariff details
  3. собрать PATCH D proof tables
  4. выполнить PATCH G: execute_children_only
  5. PATCH G: post_check
  6. PATCH G: finalize_parents
  7. выполнить PATCH E: dry_run на обновлённых данных
  8. execute approved standalone cohort
  9. собрать PATCH B browser proof
  &nbsp;
11. **Не терять основную цель.**
  В начале плана закрепить отдельным блоком:
  цель — доказуемо починить цепочку
  **продукт → тариф → сделка → тренинг → доступ → срок доступа**,
  а split historical multi-module orders — это supporting data-fix, выполняемый параллельно.
12. **Итоговый DoD переписать по факту.**
  Вместо общих формулировок сделать так:
  &nbsp;
  - на всех UI-экранах standalone purchase отображается правильным модулем
  - warning badge показывается везде, где нет display_purchase_name
  - 7 parent orders разделены на child orders и проверены post-check
  - standalone repair dry-run показан на обновлённых данных
  - Царёва и остальные standalone users попадают в понятный cohort
  - доступ выдаётся на правильный срок
  - admin/superadmin editing proof собран
  &nbsp;
13. **В конце плана добавить статус-блок вместо лишней теории.**
  Формат:
  &nbsp;
  - уже сделано
  - осталось добить
  - что идёт следующим действием
    Без повторного описания уже завершённых изменений как будто они ещё не начаты.
  &nbsp;

&nbsp;

&nbsp;

План: завершение PATCH F + C + D + B — доказательства и warning badges

## Главная задача

Починить цепочку **продукт → тариф → тренинг → сделка → доступ → срок**. PATCH G — поддерживающая нормализация, не замена основных патчей.

## Что уже сделано

- PATCH F: `display_purchase_name` resolution — реализован во всех 6 файлах
- PATCH F: Бейдж «Модульная покупка» — в AdminDeals + DealDetailSheet
- PATCH F: Warning badge — только в ContactDealsDialog
- PATCH G: Edge function с 3 режимами — создана, dry-run выполнен
- PATCH C: Dropdown (edit/delete/navigate), multi-rule selector, soft-disable, confirmation — реализованы
- PATCH E: Child name matching + standalone_safe cohort — реализован

## Что осталось

### 1. PATCH F — Warning badge на ВСЕХ экранах (не только ContactDealsDialog)

**Сейчас:** warning «⚠ Historical name missing» показывается только в `ContactDealsDialog.tsx`.

**Нужно добавить** аналогичный warning в:

- `AdminDeals.tsx` — рядом с бейджем «Модульная покупка» (строка ~968)
- `DealDetailSheet.tsx` — рядом с бейджем «Модульная покупка» (строка ~560)
- `ContactPaymentsTab.tsx` — при рендере product name (нужно передать `_missing_display_name` flag)
- `LinkDealDialog.tsx` — при рендере результатов поиска
- `LinkSubscriptionDealDialog.tsx` — аналогично

Логика: `historical_purchase_type === 'module_only_standalone' && !display_purchase_name` → показать amber badge.

### 2. PATCH C — Tariff name в multi-rule selector и confirmation dialog

**Сейчас:** multi-rule selector показывает `access_mode` и `target_label`, но **не tariff_name**. Confirmation dialog тоже без tariff name.

**Нужно:**

- В `ProductLinkedTrainingsBlock.tsx` (строка 679): при `contentRules.find(r => r.id === ruleId)` — `contentRules` не содержит `tariff_id` resolved в name.
- Добавить загрузку tariff names для rule IDs (через join или отдельный запрос к `tariffs`).
- В multi-rule selector (строки 694-707): показать tariff name, is_active badge.
- В confirmation dialog (строки 1136-1140): добавить tariff name.

Файлы: `ProductLinkedTrainingsBlock.tsx`

### 3. PATCH D — Proof tables (через DB queries)

Собрать и показать:

- `deal_display_resolution_table` — по Царёвой
- `standalone_4_users_table` — финальный список
- `mapping_proof_table` — модули Царёвой → children CB20
- `standalone_dry_run_table` — pre/post split

### 4. PATCH B — Browser proof

Admin lesson editing proof через browser tools.

## Порядок выполнения

1. PATCH F — добавить warning badge на оставшиеся 4 экрана
2. PATCH C — добавить tariff_name в selector + confirmation
3. PATCH D — собрать proof tables
4. PATCH B — browser proof

## Файлы для изменения


| Файл                                                           | Что                                            |
| -------------------------------------------------------------- | ---------------------------------------------- |
| `src/pages/admin/AdminDeals.tsx`                               | Warning badge при пустом display_purchase_name |
| `src/components/admin/DealDetailSheet.tsx`                     | Warning badge                                  |
| `src/components/admin/ContactPaymentsTab.tsx`                  | Warning badge                                  |
| `src/components/admin/payments/LinkDealDialog.tsx`             | Warning badge                                  |
| `src/components/admin/payments/LinkSubscriptionDealDialog.tsx` | Warning badge                                  |
| `src/components/admin/product/ProductLinkedTrainingsBlock.tsx` | Tariff name в selector + confirmation          |


## DoD

### Основная цепочка

- Warning badge «Historical name missing» показывается на ВСЕХ 6 экранах для standalone без display_purchase_name
- В confirmation dialog удаления rule-link виден tariff name
- В multi-rule selector виден tariff name, access_mode, is_active, target_label

### Proof tables

- deal_display_resolution_table собрана
- standalone_4_users_table собрана
- mapping_proof_table собрана

### Browser proof

- Admin lesson edit/save подтверждён

## Scope boundary

- PATCH G edge function уже создана, ждёт execute
- PATCH E repair уже обновлён, ждёт dry-run после split
- Никаких новых products/tariffs/training_modules не создаётся