# да, согласен, с учетом правок:

&nbsp;

1. **Rebind preview**: в preview обязательно отдельно показать не только training_content rules, но и **сколько descendants получат новый product_id**, и после execute сделать proof-query: нет ни одного descendant со старым product_id.
2. **Unbind preview**:
  &nbsp;
  - блокировка должна быть **только** при active training_content rules;
  - наличие active entitlements не блокирует unbind автоматически, а показывается как **warning**;
  - после unbind нужен proof-query: root и все descendants имеют product_id = NULL.
  &nbsp;
3. **Матрица в PATCH A**: не имитировать partial/tariff logic раньше PATCH B.
  В PATCH A матрица должна быть **readonly current-state**:
  &nbsp;
  - продукт → root training → descendants → count уроков;
  - для тарифов пока показывать только статус **«полный доступ через продукт»** или **«гранулярные правила не настроены»**.
    Не добавлять псевдо-логику partial до PATCH B.
  &nbsp;
4. **Naming normalization**: проверить не только wizard, но и:
  &nbsp;
  - список уже сохранённых rules;
  - preview dialogs bind/rebind/unbind;
  - diagnostics block;
  - secondary text должен быть TRN-XXXXXX / PRD-XXXXXX, а не сырой UUID по умолчанию.
  &nbsp;
5. **Bind dialog**: для тренинга другого продукта клик не должен быть disabled. Он должен открывать **rebind preview**, а не выглядеть как недоступный пункт.
6. **Audit / DoD для PATCH A** добавить явно:
  &nbsp;
  - training.rebind.preview
  - training.rebind.executed
  - training.unbind.preview
  - training.unbind.executed
  - в meta: old_product_id, new_product_id, affected_descendants_count, affected_lessons_count, deactivated_rule_ids.
  &nbsp;
7. **Proof-пакет PATCH A** зафиксировать отдельно:
  &nbsp;
  - bind свободного тренинга;
  - rebind тренинга другого продукта через preview;
  - unbind с blocking-case (active rules) и success-case (без active rules);
  - проверка, что UI продукта и UI тренинга показывают одно и то же после каждого действия.
  &nbsp;
8. **Scope PATCH A не расширять**:
  &nbsp;
  - без training_content типа,
  - без runtime changes,
  - без новых SQL migration кроме уже сделанной public_id,
  - без попытки трогать module_access кроме readonly diagnostics.
  &nbsp;

&nbsp;

&nbsp;

План: Завершение PATCH A — rebind preview, unbind preview, матрица, naming

## Что уже сделано

- `public_id` TRN-XXXXXX работает
- Блок «Тренинги этого продукта» в карточке продукта
- Зеркальный блок в карточке тренинга с диагностикой
- Bind свободного тренинга + unbind с guard на active rules
- Хук `getRebindPreview` / `rebindTraining` готовы, но UI для них нет

## Что нужно доделать (4 задачи)

### 1. Rebind preview dialog в `ProductLinkedTrainingsBlock.tsx`

- В `BindTrainingDialog`: если тренинг принадлежит другому продукту, не блокировать клик, а открыть **rebind preview dialog**
- Preview показывает данные из `getRebindPreview()`:
  - текущий продукт (name + PRD-XXXXXX) → новый продукт
  - N дочерних модулей унаследуют новый product_id
  - N уроков затронуто
  - N training_content rules будет деактивировано
  - legacy module_access: N записей
  - есть ли активные entitlements у пользователей
- Кнопка «Перепривязать» вызывает `rebindTraining`
- Audit log уже пишется в хуке

### 2. Unbind preview dialog в `ProductLinkedTrainingsBlock.tsx`

- Заменить текущий простой `AlertDialog` на preview-диалог
- Перед подтверждением показать:
  - N дочерних модулей
  - N уроков
  - legacy module_access: N записей
  - active training_content rules: N (если >0, кнопка «Отвязать» заблокирована)
  - active entitlements на продукт: есть/нет (предупреждение)
- Загрузка данных по тому же паттерну, что `getRebindPreview`, но для unbind

### 3. Матрица «продукт → тренинг → тариф → контент» в `ProductLinkedTrainingsBlock.tsx`

- Два режима: summary (compact) и expanded (полное дерево)
- Summary: карточки root-тренингов с бейджами count уроков, active/inactive
- Expanded: раскрытие дерева модулей/уроков
- Placeholder для PATCH B (колонка тарифов/partial rules пока показывает «Полный доступ» для всех)
- Переключатель summary ↔ expanded уже есть (Collapsible), нужно добавить матричное представление с тарифами

### 4. Naming normalization

**В wizard `ProductAccessRulesTab.tsx`:**

- Для `entitlement` selector (строки 980-1002): primary label уже показывает `e.label`, secondary — `e.product_code`. Нужно проверить, что `e.label` реально содержит человеческое название, а не техкод
- В списке правил (строки 660-670): `rule.target_label` как primary, `rule.target_ref` только мелким текстом если отличается

**В `ProductLinkedTrainingsBlock.tsx`:** уже показывает `title` — OK.

**В `ProductAccessInfoBlock.tsx`:** уже показывает `product.name` — OK.

## Файлы, которые будут затронуты


| Файл                              | Изменение                                                              |
| --------------------------------- | ---------------------------------------------------------------------- |
| `ProductLinkedTrainingsBlock.tsx` | Rebind preview dialog, unbind preview dialog, матрица summary/expanded |
| `useProductTrainings.ts`          | Добавить `getUnbindPreview()`                                          |
| `ProductAccessRulesTab.tsx`       | Проверка/фикс naming в wizard и списке правил                          |


## Что НЕ меняется

- `useAccessRules.ts` — `training_content` НЕ добавляется в `GrantTargetType` (это PATCH B)
- `grant-access-for-order` — без изменений
- Runtime хуки (`useTrainingModules`, `useContainerLessons`) — без изменений
- SQL миграции — не нужны

## DoD этого шага (завершение PATCH A)

1. Rebind: dry-run preview → подтверждение → execute → audit log
2. Unbind: preview с guard (active rules блокируют) → подтверждение
3. Матрица summary/expanded показывает связанные тренинги по тарифам
4. В wizard primary label — человеческое название, не техкод
5. Product→product и club rules не затронуты