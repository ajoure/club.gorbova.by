# да, согласен, с учетом правок:

&nbsp;

1. **По createStage root cause найден верно**
  &nbsp;
  - order_index >= 0 действительно ломает текущую negative safe-zone.
  - Это нужно чинить через **positive safe-zone**.
  &nbsp;
2. **Но safe-zone лучше делать не фиксированным 999/1000, а гарантированно свободным диапазоном**
  &nbsp;
  - Не надо хардкодить 999, 1000 + i.
  - Безопаснее:
    &nbsp;
    - взять текущий max(order_index) по pipeline;
    - временный диапазон сделать как maxOrder + 100 + i;
    - новую стадию вставлять в этот же safe-range;
    - потом один раз нормализовать в 0..N.
    &nbsp;
  - Так патч не зависит от текущих данных и не упрется в случайный занятый индекс.
  &nbsp;
3. **Нормализацию порядка нужно делать для всей pipeline целиком**
  &nbsp;
  - Не только closed stages.
  - Канонический порядок после любого create:
    &nbsp;
    - все open,
    - потом closed_won,
    - потом closed_lost.
    &nbsp;
  - И индексы должны быть подряд, без дырок и дублей.
  &nbsp;
4. **По второй проблеме в плане есть важная неточность**
  &nbsp;
  - setNodeRef **не нужно** переносить с wrapper на handle.
  - Для dnd-kit это как раз риск сломать drag-preview/transform, потому что draggable node и transform должны относиться к одному реальному draggable element.
  - Правильнее:
    &nbsp;
    - setNodeRef оставить на wrapper карточки;
    - listeners/attributes держать только на handle;
    - убрать перекрытие handle поверх content;
    - проверить z-index, pointer-events, ширину handle и паддинги content.
    &nbsp;
  - То есть root issue не в самом setNodeRef, а в геометрии и hit-area.
  &nbsp;
5. **Handle надо сделать не overlay-полосой, а компактной самостоятельной зоной**
  &nbsp;
  - Сейчас absolute left-0 top-0 bottom-0 w-5 слишком агрессивен.
  - Надо заменить на отдельный небольшой handle внутри карточки:
    &nbsp;
    - слева сверху или в углу,
    - без перекрытия content,
    - без растягивания на всю высоту карточки.
    &nbsp;
  - Тогда click по content гарантированно не конфликтует с drag.
  &nbsp;
6. **В план добавить проверку реального hit-test**
  &nbsp;
  - Перед execute проверить:
    &nbsp;
    - какой элемент реально получает pointerdown;
    - не перекрывает ли handle текстовую область;
    - нет ли поверх карточки move-button/checkbox/container layer;
    - не ломает ли click selection mode.
    &nbsp;
  - Это обязательный dry-run пункт.
  &nbsp;
7. **backdrop-blur-md действительно можно убрать**
  &nbsp;
  - Как visual fix и для снижения артефактов — это логично.
  - Но это не основной root cause click-bug, а только дополнительная очистка визуала.
  &nbsp;
8. **Патч реально можно держать узким — только 2 файла**
  &nbsp;
  - pipelineService.ts
  - KanbanDealCard.tsx
  - Это хороший scope.
  &nbsp;
9. **Уточнить execute по createStage**
  &nbsp;
  - Последовательность должна быть такой:
    &nbsp;
    1. прочитать все стадии pipeline;
    2. вычислить safeBase = max(order_index) + 100;
    3. увести **все** стадии в safeBase + i;
    4. вставить новую стадию тоже в safe-range;
    5. перечитать стадии;
    6. один раз финально перенумеровать в каноническом порядке.
    &nbsp;
  - Не вставлять новую стадию сразу в рабочий индекс.
  &nbsp;
10. **Уточнить execute по карточке**

&nbsp;

&nbsp;

&nbsp;

- Последовательность:
  &nbsp;
  1. wrapper остается draggable node;
  2. handle становится компактной inline-зоной;
  3. listeners/attributes только на handle;
  4. content-zone получает чистый onClick;
  5. handle не absolute на всю высоту карточки;
  6. move-button и checkbox остаются с stopPropagation.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

11. **DoD надо усилить**

&nbsp;

&nbsp;

&nbsp;

- Не просто “клик открывает карточку”, а:
  &nbsp;
  - в Основная / Без стадии;
  - в Gorbova Club / Успешно;
  - в ЗАКРОЙ ГОД / Успешно;
  - в длинной колонке со скроллом.
  &nbsp;
- И отдельно:
  &nbsp;
  - drag стартует только из handle;
  - клик по content никогда не стартует drag;
  - создание 2 стадий подряд проходит без check и без unique.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

12. **Итог**

&nbsp;

&nbsp;

&nbsp;

- План правильный по направлению.
- Нужно только поправить 2 вещи:
  &nbsp;
  - safe-zone делать динамической positive, а не 999/1000;
  - setNodeRef не переносить на handle, а оставить на wrapper и уменьшить/развести hit-area handle.
  &nbsp;

&nbsp;

&nbsp;

Итоговая формулировка: **план принимается, но с этими правками**.

&nbsp;

План: Fix createStage + click-to-open (узкий patch)

## Диагностика — root cause найден

### 1. createStage — CHECK constraint

```
CHECK ((order_index >= 0))
UNIQUE (pipeline_id, order_index)
```

Текущий код использует `-(i + 1000)` для safe-zone → **нарушает CHECK `order_index >= 0**`. Это точная причина ошибки `crm_pipeline_stages_order_index_check`.

### 2. Карточка — click vs drag

Drag handle: `absolute left-0 top-0 bottom-0 w-5` с `{...attributes} {...listeners}` висит поверх карточки. Content div: `pl-5`. Структура верная, но проблема в том, что `useDraggable` привязан к `setNodeRef` на **внешнем wrapper div**, а не на handle. Это значит **весь wrapper** — draggable node для dnd-kit, и pointer events на всей карточке обрабатываются dnd-kit sensor, даже если listeners на handle. Нужно `setNodeRef` оставить на wrapper (это обязательно для dnd-kit), но `listeners` и `attributes` вынести только на handle — что уже сделано. Однако `PointerSensor` с `activationConstraint: { distance: 5 }` может всё равно перехватывать pointer на wrapper. Решение: использовать `**useDraggable` disabled** для тяжёлых колонок не нужно — нужно просто убедиться, что `onPointerDown` не перехватывается wrapper'ом. Текущий handle уже имеет `listeners`, но wrapper ref всё равно даёт dnd-kit контроль. Нужно использовать отдельный ref для handle.

## Изменяемые файлы (только 2)

### `src/services/pipelineService.ts`

**normalizeStageOrder**: заменить negative safe-zone на positive (1000 + i):

```typescript
// Phase 1: move all to positive safe-zone (1000+)
for (let i = 0; i < ordered.length; i++) {
  await supabase.from("crm_pipeline_stages")
    .update({ order_index: 1000 + i })
    .eq("id", ordered[i].id);
}
// Phase 2: assign 0..N
for (let i = 0; i < ordered.length; i++) {
  await supabase.from("crm_pipeline_stages")
    .update({ order_index: i })
    .eq("id", ordered[i].id);
}
```

**createStage**: insert с `order_index: 999` (вместо -1), затем normalizeStageOrder.

### `src/components/admin/deals/KanbanDealCard.tsx`

Убрать `backdrop-blur-md` с карточки (источник визуальных артефактов).

Для drag: использовать отдельный ref на handle вместо `setNodeRef` на wrapper:

```typescript
const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({...});

// wrapper: НЕ setNodeRef
<div style={...} className={...}>
  {/* handle: setDragRef + listeners */}
  <div ref={setDragRef} {...attributes} {...listeners} className="drag-handle...">
    <GripVertical />
  </div>
  {/* content: onClick */}
  <div onClick={handleCardClick} className="p-3 cursor-pointer">
    ...
  </div>
</div>
```

Это полностью разделит drag и click зоны: dnd-kit будет отслеживать только handle element.

## Что НЕ меняется

- Selection mode
- Цвета/палитра
- KanbanColumn, KanbanColumnHeader
- Bulk операции
- SQL/schema

## DoD

1. createStage 2 раза подряд без ошибок (ни check, ни unique)
2. После refresh порядок: open → closed_won → closed_lost
3. Click открывает карточку в Основная, Gorbova Club, ЗАКРОЙ ГОД
4. Drag стартует только из handle (GripVertical)
5. Selection mode не сломан
6. Нет визуальных артефактов (backdrop-blur убран)