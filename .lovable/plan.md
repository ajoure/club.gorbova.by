# да, согласен, с учетом правок:

&nbsp;

1. **createStage() чинить не поштучным сдвигом, а через безопасную двухфазную перестановку**
  &nbsp;
  - Подтверждаю root cause по uq_crm_pipeline_stages_order.
  - Делать именно через временную безопасную зону для order_index, затем insert, затем финальную нормализацию.
  - После вставки обязательно один раз перечитать стадии и убедиться, что итоговый порядок:
    &nbsp;
    - все open идут первыми;
    - closed_won и closed_lost всегда в конце;
    - без дублей по order_index.
    &nbsp;
  &nbsp;
2. **Убрать отдельную кнопку «Режим выделения» из toolbar**
  &nbsp;
  - Полностью убрать.
  - Вход в режим выделения только через checkbox в header стадии.
  &nbsp;
3. **Логика checkbox стадии**
  &nbsp;
  - Первое нажатие при bulkMode=false:
    &nbsp;
    - только включает режим выделения;
    - ничего массово не выделяет.
    &nbsp;
  - Второе нажатие по checkbox уже в активном режиме:
    &nbsp;
    - работает как select all / deselect all для этой стадии.
    &nbsp;
  - Это поведение должно быть одинаковым для всех стадий, включая Без стадии.
  &nbsp;
4. **Checkbox в header стадии показывать всегда**
  &nbsp;
  - Да, убрать зависимость от bulkMode.
  - Но карточные checkbox оставить только в режиме выделения.
  &nbsp;
5. **После входа в selection mode не должно быть лишнего клика-блокера**
  &nbsp;
  - Как только режим включен первым кликом по header-checkbox, пользователь должен сразу иметь возможность:
    &nbsp;
    - выбирать отдельные карточки;
    - выделять все в одной стадии;
    - комбинировать сделки из нескольких стадий.
    &nbsp;
  - Никаких промежуточных состояний, где режим включён, но UI еще не готов.
  &nbsp;
6. **Проверить открытие карточек в Gorbova Club**
  &nbsp;
  - Здесь не ограничиваться только гипотезой про useDraggable.
  - Нужен фактический runtime-fix и proof:
    &nbsp;
    - карточка открывается обычным кликом;
    - drag не перехватывает обычный click;
    - в длинной колонке Gorbova Club это тоже работает стабильно.
    &nbsp;
  - Если причина в drag listeners, исправлять точечно, не ломая drag-and-drop.
  &nbsp;
7. **Убрать визуальное мерцание карточки**
  &nbsp;
  - Да, border-left должен быть постоянной ширины.
  - Менять только цвет, не геометрию.
  - Проверить, чтобы не было shift ни при hover, ни при selected state, ни при drag.
  &nbsp;
8. **Добавить явный post-insert proof для createStage**
  &nbsp;
  - В DoD добавить не просто “2 стадии создались”, а:
    &nbsp;
    - создание 2 новых стадий подряд;
    - обе видны в UI;
    - цвета назначены автоматически;
    - порядок корректен;
    - повторное создание не ломает существующие стадии.
    &nbsp;
  &nbsp;
9. **Проверить selection flow на реальном сценарии**
  &nbsp;
  - В DoD добавить сценарий:
    &nbsp;
    - первый клик по checkbox стадии Новая включает режим;
    - затем вручную выбрать 1 карточку в Новая и 2 карточки в В работе;
    - затем вторым кликом по header-checkbox одной стадии выделить все только в ней;
    - затем снять часть вручную.
    &nbsp;
  - Это нужно, чтобы не вернуться к старой неудобной логике.
  &nbsp;
10. **Ничего лишнего не менять**

&nbsp;

&nbsp;

&nbsp;

- Не трогать bulk delete / move / export.
- Не трогать цветовую палитру, если она уже устраивает.
- Не трогать list-view в этом патче, кроме случаев, если баг реально общий.

&nbsp;

&nbsp;

Итог: план хороший, но закрывать патч только после доказуемого исправления трех вещей:

**create stage**, **новая логика входа в selection mode через checkbox**, **нормальный click по карточкам без мерцания и без конфликта с drag**.

&nbsp;

План: Fix createStage unique constraint + selection mode через checkbox + visual bugs

## Диагностика

### 1. createStage() — `uq_crm_pipeline_stages_order`

В `pipelineService.ts:134-142` текущая логика сдвигает closed-стадии по одной через `update order_index = order_index + 1`. Если closed_won имеет `order_index=2` и closed_lost `order_index=3`, при сдвиге closed_won на 3 — конфликт с closed_lost. Нужен двухфазный сдвиг через временные отрицательные значения (как уже сделано в `reorderStages()`).

### 2. Кнопка «Режим выделения» — убрать

В `DealsKanbanBoard.tsx:256-282` рендерится кнопка. Удалить весь блок.

### 3. Вход в selection mode через checkbox стадии

В `KanbanColumnHeader.tsx:101-107` checkbox вызывает `onSelectAll/onDeselectAll` напрямую. Нужно:

- Если `bulkMode=false` → первое нажатие только включает selection mode (новый callback `onEnterSelectionMode`)
- Если `bulkMode=true` → обычный select-all/deselect-all

### 4. Checkbox видимость — всегда показывать в header (не только в bulkMode)

Строка 115: `{bulkMode && totalInStage > 0 && onSelectAll && (` — убрать `bulkMode &&`, чтобы checkbox был виден всегда. Карточные checkboxes остаются только в bulkMode.

### 5. Карточки не открываются в Gorbova Club

В `DealsKanbanBoard.tsx:192-195` `handleOpenDeal` возвращает пустоту если `bulkMode=true`. Но проблема в другом: `KanbanDealCard` использует `useDraggable`, и drag listeners (`...attributes, ...listeners`) перехватывают pointer events. В Gorbova Club все 1001 сделок в `closed_won` стадии — `useDraggable` **не disabled** для closed stages. Нужно проверить, не блокирует ли `onPointerDown` из drag listeners клик. Скорее всего проблема в том, что drag activation с `distance: 5` на touchpad/trackpad может мешать чистому клику. Однако это работает в других воронках, значит проблема может быть в количестве элементов или в специфике `closed_won` stage. Нужно убедиться, что `onClick` на inner div не конфликтует с drag `listeners`.

### 6. Визуальный баг — полоса/мерцание при hover

В `KanbanDealCard.tsx:120-122` условный `borderLeftWidth: accentColor ? "2px" : undefined` создаёт layout shift при hover, потому что без accent border нет 2px слева, а с ним — есть. Это вызывает "моргание" при наведении. Решение: всегда задавать `borderLeftWidth: "2px"` и менять только цвет (прозрачный → accent).

## Изменяемые файлы


| Файл                                                | Что                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/services/pipelineService.ts`                   | createStage: двухфазный сдвиг через отрицательные order_index                                  |
| `src/components/admin/deals/DealsKanbanBoard.tsx`   | Убрать кнопку «Режим выделения», добавить `onEnterSelectionMode` callback в props KanbanColumn |
| `src/components/admin/deals/KanbanColumnHeader.tsx` | Checkbox всегда видим; первый клик = enable mode, второй = select all                          |
| `src/components/admin/deals/KanbanColumn.tsx`       | Прокинуть `onEnterSelectionMode`                                                               |
| `src/components/admin/deals/KanbanDealCard.tsx`     | Убрать условный borderLeftWidth, всегда 2px с transparent fallback                             |


## Детали реализации

### createStage — безопасный порядок

```typescript
// 1. Сдвинуть closed stages в безопасную зону (отрицательные)
for (let i = 0; i < closedStages.length; i++) {
  await supabase.from("crm_pipeline_stages")
    .update({ order_index: -(i + 1000) })
    .eq("id", closedStages[i].id);
}
// 2. Вставить новую стадию
// 3. Вернуть closed stages с правильными индексами
for (let i = 0; i < closedStages.length; i++) {
  await supabase.from("crm_pipeline_stages")
    .update({ order_index: newIndex + 1 + i })
    .eq("id", closedStages[i].id);
}
```

### Selection mode через checkbox

```typescript
// KanbanColumnHeader
const handleCheckboxChange = () => {
  if (!bulkMode) {
    onEnterSelectionMode?.(); // только включить режим
    return;
  }
  // уже в режиме — toggle select all
  if (isAllSelected || isIndeterminate) {
    onDeselectAll?.();
  } else {
    onSelectAll?.();
  }
};
```

### Карточка — стабильный border

```typescript
style={{
  ...style,
  borderLeftColor: accentColor || "transparent",
  borderLeftWidth: "2px",
}}
```

## Что НЕ меняется

- Bulk delete/move/export
- List-view
- DragOverlay
- Палитра цветов
- SQL-схема

## DoD

1. Создание 2 стадий подряд без `uq_crm_pipeline_stages_order`
2. Успешно и Отказ остаются в конце
3. Toolbar не содержит кнопку «Режим выделения»
4. Первый клик по checkbox стадии включает selection mode без массового выделения
5. Второй клик по тому же checkbox выделяет все сделки стадии
6. Partial selection по нескольким стадиям работает
7. Escape выходит и очищает
8. Карточки в Gorbova Club открываются по клику
9. Нет визуального мерцания/полосы при hover на карточках