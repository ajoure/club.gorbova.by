# да, согласен, с учетом правок:

&nbsp;

1. **Обязательный блок проверки preview vs published**
  &nbsp;
  - В план добавить отдельный пункт диагностики и DoD:
    &nbsp;
    - проверить открытие карточки сделки **в preview внутри [lovable.dev](http://lovable.dev)**;
    - проверить открытие карточки сделки **на опубликованном сайте** после Publish и hard refresh;
    - зафиксировать отдельно, если preview работает, а published нет.
    &nbsp;
  - Это важно, потому что сейчас есть расхождение среды: в lovable preview поведение уже могло измениться, а на published баг сохраняется.
  - Нужен proof именно по двум средам, а не только по preview.
  &nbsp;
2. **Если preview и published ведут себя по-разному — добавить обязательный PATCH на причину расхождения**
  &nbsp;
  - В план включить проверку:
    &nbsp;
    - задеплоился ли актуальный код;
    - нет ли stale build / cache / service worker / CDN cache;
    - нет ли различий env/config между preview и published;
    - нет ли различий из-за event layering только в production bundle.
    &nbsp;
  - Если preview ок, а published нет — не закрывать патч как выполненный.
  &nbsp;
3. **Расширить палитру стадий**
  &nbsp;
  - Не 8 цветов, а **готовая встроенная палитра минимум на 20 цветов**.
  - Палитра должна быть:
    &nbsp;
    - приглушённая;
    - “дорогая” по тону;
    - без кислотных цветов;
    - open-стадии не должны конкурировать с Успешно и Отказ.
    &nbsp;
  - Красный оставить только для отказа, зелёный — только для успешно.
  - Все остальные цвета — альтернативные, с мягким движением от холодных к более тёплым и ближе к зелёному по мере продвижения.
  &nbsp;
4. **Палитра должна поддерживать и автоподбор, и ручной выбор**
  &nbsp;
  - Автоматический выбор цвета при создании стадии оставить.
  - Но в picker добавить **полную preset-палитру из 20 цветов** в кружках.
  - Пользователь должен иметь возможность вручную выбрать любой из этих preset-цветов.
  - Сейчас не нужен free-color picker с hex/input. Нужна именно готовая curated palette.
  &nbsp;
5. **Уточнить правило автоподбора цвета**
  &nbsp;
  - Для новой стадии выбирать следующий свободный цвет из расширенной палитры.
  - Если все 20 уже заняты — брать наименее используемый.
  - Не дублировать подряд одинаковые оттенки в одной воронке, пока есть свободные варианты.
  &nbsp;
6. **Drag-and-drop стадий: добавить published-proof**
  &nbsp;
  - В DoD включить:
    &nbsp;
    - reorder open-стадий работает в preview;
    - после Publish и refresh тот же reorder работает на published;
    - порядок сохраняется и в list-view, и в board-view;
    - closed stages и “Без стадии” по-прежнему фиксированы.
    &nbsp;
  &nbsp;
7. **Click-to-open карточки: тоже проверять в двух средах**
  &nbsp;
  - В DoD добавить 4 обязательные проверки:
    &nbsp;
    - Основная / Без стадии в preview;
    - Gorbova Club / Успешно в preview;
    - те же 2 сценария на published;
    - после Publish + hard refresh + повторного открытия страницы.
    &nbsp;
  - Без этого патч по клику не считать закрытым.
  &nbsp;
8. **Палитру применить не только к точке/иконке, а ко всей стадии**
  &nbsp;
  - Оставить текущий принцип:
    &nbsp;
    - фон колонки tinted;
    - карточки внутри гармонируют;
    - точка стадии и header совпадают по цвету.
    &nbsp;
  - Но проверить, что после расширения палитры не появляется визуальный шум и не теряется контраст текста.
  &nbsp;
9. **Новый файл/утилита палитры**
  &nbsp;
  - В план добавить, что stagePalette.ts должен содержать:
    &nbsp;
    - массив из 20 preset colors;
    - helper getNextStageColor;
    - helper для tinted background;
    - helper для card accent;
    - semantic colors для won/lost отдельно, без смешивания с общей палитрой.
    &nbsp;
  &nbsp;
10. **DoD дополнить**

&nbsp;

&nbsp;

&nbsp;

- Open-стадии перетаскиваются между собой через handle.
- Published и preview ведут себя одинаково по:
  &nbsp;
  - reorder stages;
  - open card;
  - color apply;
  - create stage.
  &nbsp;
- В color picker доступно **20 preset-цветов**.
- Новая стадия получает цвет автоматически.
- Цвет можно поменять вручную через палитру.
- Успешно и Отказ не ломаются и остаются семантическими.
- Карточка сделки открывается и в preview, и на published.
- После Publish проблема не воспроизводится повторно.

&nbsp;

&nbsp;

&nbsp;

11. **Отдельный stop-guard**

&nbsp;

&nbsp;

&nbsp;

- Если в preview всё работает, а на published нет — не считать задачу закрытой.
- В таком случае нужен отдельный mini-patch на production-only расхождение, а не формальное “сделано”.

&nbsp;

&nbsp;

Итого: сам план по drag-and-drop стадий правильный, но его обязательно нужно расширить **published-proof проверкой** и **палитрой из 20 preset-цветов с ручным выбором и автоподбором**.

&nbsp;

План: Drag-and-drop перемещение стадий (колонок)

## Задача

Добавить возможность перетаскивать стадии (колонки) на доске Kanban, аналогично тому, как работает drag для карточек сделок — компактная иконка-handle в header стадии.

## Диагностика

- `reorderStages()` в `pipelineService.ts` уже существует и работает (positive safe-zone + нормализация).
- `usePipelineStages` уже экспортирует `reorderStages` mutation.
- `@dnd-kit/sortable` v10 установлен в проекте.
- Текущий `DndContext` в `DealsKanbanBoard` обслуживает только drag сделок между колонками (droppable = stageId, draggable = dealId).

## Архитектурное решение

Использовать **два вложенных DndContext**: внешний для стадий, внутренний (существующий) для сделок. Это стандартный паттерн dnd-kit для разных типов draggable-объектов.

### Структура

```
<DndContext for stages>          ← новый, horizontal sortable
  <SortableContext items={stageIds}>
    <DndContext for deals>       ← существующий
      {columns.map(stage => (
        <SortableStageWrapper>   ← useSortable + useDroppable
          <KanbanColumn />
        </SortableStageWrapper>
      ))}
    </DndContext>
  </SortableContext>
</DndContext>
```

## Изменяемые файлы

### 1. `src/components/admin/deals/DealsKanbanBoard.tsx`

- Добавить внешний `DndContext` + `SortableContext` для стадий (только open-стадии сортируемы; closed_won/closed_lost фиксированы в конце).
- `onDragEnd` внешнего контекста вызывает `reorderStages` с новым порядком.
- Передать drag handle props в `KanbanColumn`.

### 2. `src/components/admin/deals/KanbanColumn.tsx`

- Принять опциональные `dragHandleProps` (listeners + attributes от `useSortable`).
- Прокинуть их в `KanbanColumnHeader`.

### 3. `src/components/admin/deals/KanbanColumnHeader.tsx`

- Добавить компактную иконку `GripVertical` слева от названия стадии.
- Иконка видна только для open-стадий (closed не перемещаются).
- При наведении cursor: grab, при перетаскивании cursor: grabbing.
- Drag handle не должен мешать checkbox и другим элементам.

### 4. Новый: `src/components/admin/deals/SortableStageWrapper.tsx`

- Обёртка, использующая `useSortable` из `@dnd-kit/sortable`.
- Передаёт `setNodeRef`, `style` (transform), `listeners`/`attributes` в дочерний `KanbanColumn`.
- `useDroppable` остаётся внутри `KanbanColumn` для приёма сделок.

## Ограничения

- **Не перемещаются**: `__unassigned`, `closed_won`, `closed_lost` — всегда на фиксированных позициях.
- Только `open`-стадии участвуют в сортировке.
- В `bulkMode` drag стадий тоже отключен.

## Что НЕ меняется

- Drag сделок между колонками.
- Selection mode.
- Цвета/палитра.
- `pipelineService.ts` (reorderStages уже готов).

## DoD

1. Open-стадии перетаскиваются между собой через handle в header.
2. Closed-стадии и «Без стадии» зафиксированы.
3. После drop порядок сохраняется в БД через `reorderStages`.
4. Drag сделок не сломан.
5. В bulkMode drag стадий отключен.