# да, согласен, с учетом правок:

&nbsp;

1. **PATCH 3 по dropdown positioning сформулировать безопаснее.**
  Не утверждать заранее, что проблема точно только в transform + draggable listeners. Это рабочая гипотеза, но в плане лучше писать:
  &nbsp;
  - проверить DropdownMenuTrigger,
  - проверить Portal,
  - проверить transform на draggable wrapper,
  - проверить scope {...listeners} / {...attributes},
  - после этого применить минимальный fix без деградации drag&drop.
    Иначе подрядчик может жёстко переделать структуру карточки там, где проблема была только в trigger scope.
  &nbsp;
2. **Не убирать transform с корневой draggable-карточки без необходимости.**
  В плане надо явно написать:
  сначала попробовать минимальный fix:
  &nbsp;
  - вынести DropdownMenuTrigger из drag handle scope,
  - добавить stopPropagation / preventDefault на action-zone,
  - проверить стандартный popover/dropdown компонент.
    Только если это не решает баг — менять DOM-структуру карточки глубже.
  &nbsp;
3. **PATCH 2 по backfill уточнить по условию UPDATE.**
  Сейчас написано WHERE status = 'paid' AND pipeline_stage_id IS NULL.
  Нужно сделать корректнее:
  &nbsp;
  - обновлять paid, у которых **нет корректной closed_won стадии**,
  - не ломать уже вручную расставленные валидные сделки.
    Лучше формулировка:
  - status = 'paid'
  - и либо pipeline_stage_id IS NULL,
  - либо pipeline_stage_id не указывает на stage c stage_type='closed_won'.
    Иначе часть оплаченных сделок может остаться вне Успешно, если раньше им вручную назначили другую стадию.
  &nbsp;
4. **Dry-run / Verify расширить ещё одной метрикой.**
  Добавить:
  &nbsp;
  - сколько paid уже были в closed_won,
  - сколько paid были не в closed_won,
  - сколько реально обновлено execute-ом.
    Это даст прозрачный proof, что backfill не тронул лишнее.
  &nbsp;
5. **PATCH 1: полный fetch не должен ломать производительность молча.**
  В план нужно добавить:
  &nbsp;
  - сначала убрать data-truncation для counts/totals;
  - если full render 2847 карточек тормозит UI, оставить follow-up на virtualization;
  - но totals и grouping обязаны считаться по полному dataset уже сейчас.
    То есть performance-risk зафиксировать, но не блокировать fix.
  &nbsp;
6. **После PATCH 1 обязательно проверить колонку Без стадии.**
  Сейчас после полного fetch она может резко вырасти по высоте и начать ломать UX/scroll.
  В DoD добавить:
  &nbsp;
  - board остаётся usable после загрузки полного dataset,
  - scroll/column rendering не ломаются,
  - dropdown “Переместить” по-прежнему позиционируется корректно в длинной колонке.
  &nbsp;
7. **PATCH 4 не считать “автоматически корректным” без proof.**
  Да, summary использует массив из hook, но после PATCH 1+2 всё равно нужен отдельный proof:
  &nbsp;
  - total deals = полному scope,
  - paid в Успешно,
  - non-paid в Без стадии,
  - totals сверху совпадают с фактическими counts по колонкам.
  &nbsp;
8. **DoD дополнить явным proof на bugfix dropdown.**
  Не просто “меню открывается не в углу”, а:
  &nbsp;
  - клик по Переместить,
  - меню появилось под кнопкой,
  - выбрать стадию,
  - сделка переместилась,
  - refresh,
  - сделка осталась в новой стадии.
  &nbsp;
9. **В целом сам план хороший и логичный.**
  По сути вектор правильный:
  &nbsp;
  - убрать truncation 500,
  - выполнить controlled backfill paid -> Успешно,
  - починить dropdown positioning.
    После правок выше этот patch можно исполнять.
  &nbsp;

&nbsp;

&nbsp;

План: финальный fix-патч — лимит 500 + backfill + dropdown positioning

## Диагностика


| Проблема                          | Root cause                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board показывает макс 500 сделок  | `.limit(500)` в `useDealsBoard.ts` строка 68                                                                                                                      |
| Paid сделки не в Успешно          | Backfill не выполнен, все `pipeline_stage_id = NULL`                                                                                                              |
| Меню «Переместить» улетает в угол | `useDraggable` listeners на родительском div перехватывают pointer events; `transform` стиль на карточке ломает positioning context для Portal-based DropdownMenu |


## Изменения

### PATCH 1 — Убрать limit(500), полный fetch

**Файл**: `src/hooks/useDealsBoard.ts`

Заменить `.limit(500)` на цикл батчевого fetch через `.range()`:

- Батч = 1000 записей
- Цикл до `data.length < PAGE_SIZE`
- Все остальные фильтры (product, tariff, search, pipeline OR) сохраняются

### PATCH 2 — Controlled backfill paid → Успешно

Выполнить через database tool:

1. Dry-run: SELECT counts (paid, non-paid, already assigned)
2. UPDATE `orders_v2` SET `pipeline_id`, `pipeline_stage_id` WHERE `status = 'paid'` AND `pipeline_stage_id IS NULL`
3. INSERT audit log: `deal.bulk_backfill_success_stage` с meta
4. Verify: повторный SELECT для proof

### PATCH 3 — Исправить позиционирование dropdown «Переместить»

**Файл**: `src/components/admin/deals/KanbanDealCard.tsx`

Root cause: `useDraggable` привязывает `onPointerDown`/`onKeyDown` listeners через `{...listeners}` к корневому div. Когда DropdownMenu открывается, pointer events перехватываются draggable, а transform на карточке смещает positioning context для Portal.

Исправление:

- Вынести блок hover-actions (`div` строки 143-185) из-под `{...listeners}` scope — сделать его отдельным элементом, который не наследует drag listeners
- Конкретно: разделить карточку на две зоны:
  - Верхняя (drag zone): `ref={setNodeRef}`, `{...attributes}`, `{...listeners}`, `style={transform}`
  - Нижняя (actions zone): без listeners, без transform — нормальный DOM для DropdownMenu
- Либо альтернативно: обернуть только контент карточки (строки 96-140) в drag handle через `{...listeners}`, а actions div оставить вне drag scope
- Добавить `onPointerDown={(e) => e.stopPropagation()}` на actions div для предотвращения drag initiation при клике по кнопкам

Это решит и positioning (Portal anchor будет в нормальном DOM без transform), и interaction (клик по dropdown не начнёт drag).

### PATCH 4 — Summary пересчёт

Никаких изменений кода не нужно — summary уже считается по `deals` массиву из hook. После PATCH 1+2 массив будет полным → summary автоматически корректен.

## Файлы


| Действие | Файл                                                                       |
| -------- | -------------------------------------------------------------------------- |
| Edit     | `src/hooks/useDealsBoard.ts` — убрать limit(500), batch fetch              |
| Edit     | `src/components/admin/deals/KanbanDealCard.tsx` — fix dropdown positioning |
| Data     | `orders_v2` — backfill paid → Успешно                                      |
| Data     | `audit_logs` — INSERT backfill record                                      |


## DoD

1. Board загружает все сделки (не 500)
2. Paid сделки в колонке Успешно
3. Не-paid сделки в Без стадии
4. Summary totals корректны по полному dataset
5. Audit log backfill записан
6. Меню «Переместить» открывается от кнопки на карточке, не в углу экрана
7. Dropdown корректно работает внутри scrollable board
8. После refresh данные и состояние сохраняются