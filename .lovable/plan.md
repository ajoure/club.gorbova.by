# да, согласен, с учетом правок:

&nbsp;

1. **Блок A по performance в целом правильный.**
  Root cause с лагами тоже выглядит правдоподобно: не нужно держать DropdownMenu + Tooltip + Portal на каждой карточке при колонке в 2000+ записей.
  Но shared menu лучше делать **не на уровне колонки, а на уровне board / page-shell**, чтобы:
  &nbsp;
  - не плодить по одному menu на каждую колонку;
  - не пересоздавать anchor state при переносах между колонками;
  - проще контролировать outside click / Escape / z-index / portal.
  &nbsp;
2. **В PATCH A2 зафиксировать один shared move-menu на весь board.**
  Нужен state вида:
  &nbsp;
  - moveMenu = { dealId, anchorRect | anchorEl } | null
    и один popover/dropdown в DealsKanbanBoard.tsx или ближайшем общем контейнере, а не per-card и не per-column.
  &nbsp;
3. **TooltipProvider тоже не должен жить в каждой карточке.**
  Если tooltip остаётся, то:
  &nbsp;
  - один общий provider выше по дереву;
  - в карточке только trigger/content wiring.
    Иначе часть лишней нагрузки останется.
  &nbsp;
4. **Кнопку Переместить уменьшить ещё, но не делать слишком маленькой для тача.**
  Хороший ориентир:
  &nbsp;
  - визуально размер иконки как у галочки/часов;
  - hit area всё равно оставить чуть больше самой иконки.
    То есть маленький видимый control, но нормальная clickable зона.
  &nbsp;
5. **PATCH A3 по DragOverlay правильный, но нужно явно добавить запрет на рендер тяжёлой карточки в overlay.**
  Никаких KanbanDealCard внутри overlay.
  Только лёгкий preview без hooks, dropdown, tooltip и лишних badges.
6. **К performance-патчу добавить React.memo не только для колонки, но и для карточки.**
  Иначе при движении drag/open menu всё равно может быть лишний rerender сотен карточек.
  Нужно:
  &nbsp;
  - React.memo(KanbanDealCard)
  - React.memo(KanbanColumn)
  - стабильные callbacks / props, чтобы memo реально работал.
  &nbsp;
7. **Блок B по product pipelines неполный без bindings.**
  Раз уже есть crm_pipeline_product_bindings, их нужно использовать.
  При создании product-pipeline для каждого продукта обязательно:
  &nbsp;
  - создать pipeline,
  - создать стандартные стадии,
  - создать binding product_id -> pipeline_id.
    Иначе потом auto-assignment / фильтры / логика “какая pipeline для продукта” останутся без source of truth.
  &nbsp;
8. **Для product-pipelines нужен deterministic naming rule.**
  Просто “название продукта” может конфликтовать:
  &nbsp;
  - с уже существующей pipeline;
  - с другим продуктом с похожим именем;
  - с длиной/символами.
    Нужна явная политика:
  - если pipeline с таким названием уже существует и уже привязана к тому же продукту — переиспользовать;
  - если существует, но чужая — не создавать дубль молча, а использовать suffix или остановиться с dry-run report.
  &nbsp;
9. **В dry-run по продуктовым pipeline нужно добавить product_id, а не только product_name.**
  Название недостаточно. Machine-check и audit должны опираться на product_id.
10. **PATCH B1 не стоит делать через “используем существующий createPipeline” как основную execute-логику.**
  Для массовой операции лучше:

&nbsp;

&nbsp;

&nbsp;

- либо controlled SQL/exec;
- либо отдельная batch-safe service function.
  Массовое создание 17 pipeline через UI-подобный helper менее надёжно и хуже для repeatability/proof.

&nbsp;

&nbsp;

&nbsp;

11. **В PATCH B2 обязательно учитывать только сделки с product_id IS NOT NULL.**
  И отдельно в proof показать:

&nbsp;

&nbsp;

&nbsp;

- сколько paid без product_id;
- что они остались в Основной;
- что это ожидаемый хвост, а не пропавшие сделки.

&nbsp;

&nbsp;

&nbsp;

12. **В STOP-guards добавить проверку на уже существующие product-pipelines и bindings.**
  Нужно остановиться или перейти в idempotent mode, если:

&nbsp;

&nbsp;

&nbsp;

- pipeline уже создана;
- binding уже существует;
- стадия Успешно уже существует;
- часть сделок уже перенесена.
  То есть операция должна быть безопасной при повторном запуске.

&nbsp;

&nbsp;

&nbsp;

13. **Proof после redistribution нужно считать не только по pipeline count, но и по суммам.**
  Обязательно показать:

&nbsp;

&nbsp;

&nbsp;

- per product: successful count + successful sum;
- сумма по всем product-pipelines;
- сравнение с total paid count/sum в БД;
- хвост paid без product_id отдельно.

&nbsp;

&nbsp;

&nbsp;

14. **После создания 17 product-pipelines проверить usability selector-а.**
  Это важно. Если selector становится неудобным, надо хотя бы:

&nbsp;

&nbsp;

&nbsp;

- сортировать pipeline по name или по успешным продажам;
- Основная держать первой;
- product-pipelines ниже.
  Иначе UI станет тяжёлым сразу после redistribution.

&nbsp;

&nbsp;

&nbsp;

15. **Итоговое дополнение к плану:**

&nbsp;

```
Дополни план следующими правками.

A. Performance fix

1. Shared move-menu делать один на весь board/page-shell, а не per-card и не per-column.
State:
- moveMenu = { dealId, anchorEl/anchorRect } | null
Один общий popover/dropdown для move action.

2. TooltipProvider не держать в каждой карточке.
Один provider выше по дереву.

3. Для performance обязательно:
- React.memo(KanbanDealCard)
- React.memo(KanbanColumn)
- лёгкий DragOverlay без KanbanDealCard и без hooks/menu/tooltip

4. Кнопку "Переместить":
- визуально уменьшить до уровня status icon,
- но оставить нормальную clickable area,
- сделать доступной на hover / focus / touch.

B. Product pipelines

5. При создании product-pipelines обязательно создавать bindings в `crm_pipeline_product_bindings`.
Без этого product-pipeline модель неполная.

6. Dry-run и execute делать по `product_id`, не только по названию продукта.

7. Naming rule:
- если pipeline для этого product_id уже существует — переиспользовать;
- не создавать дубликаты молча;
- если есть конфликт имени — явно логировать/обрабатывать.

8. Массовое создание 17 pipeline и перенос сделок делать не через UI helper по одной, а batch-safe execute с idempotent logic.

9. В redistribution переносить только:
- status = paid
- product_id IS NOT NULL

10. Отдельно показать хвост:
- paid без product_id
- они остаются в Основной
- это expected remainder

11. STOP-guards:
- existing pipeline
- existing binding
- existing closed_won stage
- partially moved deals
должны обрабатываться идемпотентно.

12. Финальный proof после redistribution:
- per product: count + sum
- total across all product-pipelines
- paid without product_id
- total successful deals in DB
- equality checks по counts и sums

13. Pipeline selector после создания product-pipelines:
- Основная первой
- product-pipelines отсортированы предсказуемо
- selector остаётся usable
```

После этих правок план можно исполнять.

&nbsp;

План: Performance fix + Product pipelines для успешных сделок

## Диагностика


| Проблема                              | Root cause                                                                                 | Файл                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| Move dropdown лагает 10-15 сек        | Каждая из 2000+ карточек монтирует `DropdownMenu` + `TooltipProvider` + `Tooltip` + Portal | `KanbanDealCard.tsx`                  |
| Drag троит и тормозит                 | `DragOverlay` рендерит полный `KanbanDealCard` с `useDraggable` hook                       | `DealsKanbanBoard.tsx` строка 222     |
| Кнопка «Переместить» крупновата       | `h-6 w-6` vs `h-3.5 w-3.5` у status icon                                                   | `KanbanDealCard.tsx` строка 168       |
| Paid сделки в одной колонке «Успешно» | Нет product-pipelines и bindings                                                           | Данные в `crm_pipelines`, `orders_v2` |


## Блок A — Performance fix

### A1. Убрать per-card DropdownMenu/Tooltip/TooltipProvider из KanbanDealCard

**Файл**: `src/components/admin/deals/KanbanDealCard.tsx`

- Удалить импорты `DropdownMenu`, `Tooltip`, `TooltipProvider` и все связанные компоненты
- Кнопка «Переместить» → простой `<button>` с `title="Переместить"` и `aria-label`
- При клике вызывает новый callback `onMoveClick(dealId, event.currentTarget)` вместо открытия dropdown
- Размер кнопки: `h-4 w-4`, иконка `h-2.5 w-2.5`, но `min-w-[28px] min-h-[28px]` для touch hit area
- Видимость: `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` + всегда видна на touch через media query
- Обернуть компонент в `React.memo`

### A2. Один shared move-menu на весь board

**Файл**: `src/components/admin/deals/DealsKanbanBoard.tsx`

- Добавить state: `moveTarget: { dealId: string; anchorEl: HTMLElement } | null`
- Один `DropdownMenu` (или Popover) в конце JSX, позиционированный через `anchorEl`
- При `onMoveClick` от карточки → установить `moveTarget`, menu открывается
- Закрытие стандартное: outside click / Escape — мгновенное (один Portal на весь board)
- Обернуть один `TooltipProvider` вокруг всего board content (не per-card)

### A3. Лёгкий DragOverlay

**Файл**: `src/components/admin/deals/DealsKanbanBoard.tsx`, строки 219-225

- Заменить `<KanbanDealCard deal={activeDeal} onOpen={() => {}} isDragging />` на лёгкий div:

```tsx
<div className="p-3 rounded-xl border bg-card shadow-xl opacity-90 rotate-1 w-[260px]">
  <div className="text-xs font-medium truncate">{activeDeal.product_name}</div>
  <div className="text-sm font-semibold mt-1">{formatCurrency(...)}</div>
</div>
```

- Без hooks, без dropdown, без tooltip, без badges

### A4. React.memo для KanbanColumn

**Файл**: `src/components/admin/deals/KanbanColumn.tsx`

- Обернуть экспорт в `React.memo`
- Убрать из props `onMoveTo` и `availableStages` на уровне карточки (теперь board-level)
- Вместо этого передавать `onMoveClick` callback

### A5. Стабильные callbacks

**Файл**: `src/components/admin/deals/DealsKanbanBoard.tsx`

- `onMoveClick` через `useCallback`
- `onOpenDeal` и `onMoveDeal` lambdas в JSX → вынести в `useCallback` чтобы memo работал

## Блок B — Product pipelines для успешных сделок

### B1. Dry-run (данные уже получены)


| product_id          | Продукт                        | Paid     | Сумма                         |
| ------------------- | ------------------------------ | -------- | ----------------------------- |
| 11c9f1b8...         | Gorbova Club                   | 1001     | 200 842                       |
| 7101ed3c...         | Ценный бухгалтер 1 ступень 2.0 | 442      | 3 093 117                     |
| 73c29914...         | ЗАКРОЙ ГОД                     | 313      | 1 540 690                     |
| 87a8870f...         | Ценный бухгалтер 2 ступень     | 111      | 132 775                       |
| 85046734...         | Бухгалтерия как бизнес         | 78       | 19 250                        |
| 4fc18564...         | Подоходный налог с физлиц      | 72       | 20 240                        |
| + 11 продуктов      | ...                            | 71       | ...                           |
| **Итого**           | **17 продуктов**               | **2088** | &nbsp;                        |
| paid без product_id | —                              | **18**   | expected remainder в Основной |


Existing pipelines: только «Основная» (id `e8606cb2...`). Bindings: пусто. Конфликтов имён нет.

### B2. Execute — batch-safe SQL через insert tool

Для каждого из 17 продуктов (идемпотентно):

1. **Проверить** существует ли pipeline с binding к этому `product_id` → если да, переиспользовать
2. **Создать pipeline**: `INSERT INTO crm_pipelines (name, order_index)` — название = название продукта
3. **Создать 4 стадии**: Новая, В работе, Успешно, Отказ
4. **Создать binding**: `INSERT INTO crm_pipeline_product_bindings (pipeline_id, product_id)`
5. **Перенести сделки**: `UPDATE orders_v2 SET pipeline_id = X, pipeline_stage_id = closed_won_stage WHERE status = 'paid' AND product_id = Y AND (pipeline_stage_id IS NULL OR pipeline_stage_id NOT IN (select closed_won stages))`
6. **Audit**: `deal.bulk_reassigned_to_product_pipeline` с meta per product

### B3. STOP-guards (идемпотентность)

- Pipeline уже существует для product_id → переиспользовать
- Binding уже существует → skip
- Closed_won stage уже есть → переиспользовать
- Сделки уже в правильной pipeline/stage → skip (WHERE clause)
- Paid без product_id (18 шт) → остаются в Основной, это expected remainder

### B4. Pipeline selector после создания 17 pipelines

**Файл**: `src/pages/admin/AdminDeals.tsx`, строки 844-855

- Основная (is_default) всегда первой
- Остальные отсортированы по `order_index` (уже так в `fetchPipelines`)
- При 18 pipelines selector остаётся usable (dropdown scroll)

## Изменяемые файлы


| Файл                                   | Изменение                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `KanbanDealCard.tsx`                   | Убрать DropdownMenu/Tooltip/Provider, добавить `onMoveClick`, уменьшить кнопку, `React.memo` |
| `DealsKanbanBoard.tsx`                 | Shared move-menu, лёгкий DragOverlay, `TooltipProvider` на board, stable callbacks           |
| `KanbanColumn.tsx`                     | `React.memo`, передавать `onMoveClick` вместо per-card menu props                            |
| `orders_v2` (data)                     | Перенести paid сделки в product-pipelines                                                    |
| `crm_pipelines` (data)                 | 17 новых pipeline                                                                            |
| `crm_pipeline_stages` (data)           | 68 новых стадий (4 × 17)                                                                     |
| `crm_pipeline_product_bindings` (data) | 17 bindings                                                                                  |
| `audit_logs` (data)                    | Audit записи                                                                                 |


## DoD

1. Move dropdown открывается/закрывается мгновенно (один shared menu на board)
2. Drag — один лёгкий ghost preview, без троения и фризов
3. Кнопка «Переместить» уменьшена до уровня status icon, доступна на hover/focus/touch
4. `React.memo` на KanbanDealCard и KanbanColumn
5. 17 product-pipelines созданы с bindings
6. Paid сделки (2088) перенесены в соответствующие product-pipelines → стадию Успешно
7. 18 paid без product_id остались в Основной (expected remainder)
8. Основная очищена от paid с product_id
9. Audit записи по каждой операции
10. Pipeline selector: Основная первой, product-pipelines отсортированы
11. Summary/board корректны после redistribution
12. Machine-check proof: per-product count + sum, total equality check
13. После refresh всё сохраняется