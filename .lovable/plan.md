# да, согласен, с учетом правок:

&nbsp;

1. Добавь в план явную проверку, что **проблема production-only не маскируется старым опубликованным bundle**:
  &nbsp;
  - publish;
  - hard refresh;
  - открыть published в новой инкогнито-вкладке;
  - сравнить fingerprint preview vs published;
  - только после этого делать вывод о click bug.
  &nbsp;
2. По KanbanDealCard.tsx зафиксируй, что нужен не просто data: { type: "deal" }, а **полный runtime trace цепочки**:
  &nbsp;
  - лог входа в handleCardClick;
  - лог вызова onOpenDeal;
  - лог [deal.id](http://deal.id), pipeline_stage_id, [event.target](http://event.target), event.currentTarget;
  - лог того, был ли bulkMode;
  - лог того, стартовал ли drag вместо click.
  &nbsp;
3. Добавь проверку, что **move button / checkbox / drag handle / overlay** не перекрывают content-zone карточки на published:
  &nbsp;
  - временно вывести pointer-events, z-index и active target в лог;
  - доказать, что клик реально попадает в content div, а не в служебный слой.
  &nbsp;
4. Уточни в плане, что fingerprint должен быть **стабильным для одного build** и видимым:
  &nbsp;
  - в [console.info](http://console.info);
  - желательно еще в window.__BUILD_FINGERPRINT__, чтобы его можно было быстро проверить в DevTools на published.
  &nbsp;
5. В main.tsx добавь не только build fingerprint, но и **environment marker**:
  &nbsp;
  - preview / published origin;
  - commit/build time;
  - чтобы исключить путаницу между средами.
  &nbsp;
6. В DoD добавь обязательный proof:
  &nbsp;
  - preview console fingerprint;
  - published console fingerprint;
  - published click log до фикса/после фикса;
  - published открытие карточки в Gorbova Club, ЗАКРОЙ ГОД, Ценный бухгалтер.
  &nbsp;
7. Зафиксируй STOP-guard:
  &nbsp;
  - если fingerprint на published не совпадает с preview, UI-fix не считать проверенным;
  - сначала закрыть deploy/cache mismatch, потом снова тестировать click-to-open.
  &nbsp;
8. Небольшая коррекция формулировки root cause:
  &nbsp;
  - data: { type: "deal" } — это обязательный фикс и правильное усиление;
  - но само по себе оно еще не доказывает, что именно оно было единственной причиной production bug;
  - поэтому в плане правильно оставить это как **основной технический фикс + обязательный runtime-proof**, а не как окончательно доказанный единственный root cause.
  &nbsp;

&nbsp;

&nbsp;

План: Build fingerprint + runtime tracing + production click fix

## Диагностика

### Root cause #1: отсутствует `data: { type: "deal" }` в useDraggable

`KanbanDealCard.tsx` строка 76-79 — `useDraggable` не передаёт `data: { type: "deal" }`. В результате `handleDragStart` (строка 157-170 DealsKanbanBoard) при `e.active.data?.current?.type === undefined` трактует любой pointer event как deal drag. Это может вызвать гонку с PointerSensor при `activationConstraint: { distance: 5 }` — в production build оптимизации могут изменить тайминг event propagation, из-за чего click не доходит до `handleCardClick`.

### Root cause #2: нет доказательства актуальности published build

Без fingerprint невозможно подтвердить, что published работает на том же коде, что и preview.

## Изменения (3 файла)

### 1. `src/components/admin/deals/KanbanDealCard.tsx`

- Добавить `data: { type: "deal" }` в `useDraggable` — это критически важно для корректной маршрутизации drag events в unified DndContext.
- Добавить временный `console.info` в `handleCardClick` для runtime tracing на published: deal id, pipeline, stage, event target. Это нужно для proof, что click доходит до handler.

### 2. `vite.config.ts`

- Добавить `define: { __BUILD_FINGERPRINT__: JSON.stringify(new Date().toISOString()) }` — глобальная константа с timestamp сборки.

### 3. `src/main.tsx`

- Добавить `console.info('[Build]', __BUILD_FINGERPRINT__)` — выводит fingerprint при загрузке. Позволяет сравнить preview и published.

## Что НЕ меняется

- SortableStageWrapper, KanbanColumn, KanbanColumnHeader — не трогаем.
- Selection mode, палитра, createStage — не трогаем.
- Визуальные стили карточек — не трогаем.

## DoD

1. `__BUILD_FINGERPRINT__` виден в console и preview, и published.
2. Click по карточке логирует deal id + stage в console.
3. `data: { type: "deal" }` корректно передаётся в useDraggable.
4. После Publish + hard refresh fingerprint совпадает.
5. Click-to-open работает в Gorbova Club, ЗАКРОЙ ГОД, Ценный бухгалтер на published.
6. Drag по-прежнему стартует только из handle.