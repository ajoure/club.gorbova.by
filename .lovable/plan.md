да, согласен, с учетом правок:

&nbsp;

1. **Add-only**
  &nbsp;
  - Все ниже только добавляется к текущему плану.
  - Ничего из уже сделанных и подтверждённых частей kanban не откатывать: bulk actions, selection flow, palette, color change, routing, pipeline selector.
  &nbsp;
2. **Единый DnD-контур — только с явным типом draggable**
  &nbsp;
  - В одном DndContext обязательно ввести явный тип active item:
    &nbsp;
    - type: "stage"
    - type: "deal"
    &nbsp;
  - В onDragStart / onDragOver / onDragEnd жёстко развести ветки по типам.
  - Нельзя допустить, чтобы reorder стадий перехватывал drag сделок или наоборот.
  &nbsp;
3. **Reorder только для open-стадий**
  &nbsp;
  - В sortable list включать только open стадии.
  - __unassigned, closed_won, closed_lost должны оставаться вне sortable sequence и всегда фиксироваться.
  - После reorder open-стадий итоговый порядок должен собираться как:
    &nbsp;
    - __unassigned
    - все open в новом порядке
    - closed_won
    - closed_lost
    &nbsp;
  &nbsp;
4. **Proof по сохранению порядка**
  &nbsp;
  - Проверить не только board-view, но и:
    &nbsp;
    - refresh;
    - переход list ↔ board;
    - смену pipeline;
    - возврат в ту же pipeline.
    &nbsp;
  - Порядок должен оставаться одинаковым везде.
  &nbsp;
5. **Full-height fix — отдельно проверить wrapper и inner column**
  &nbsp;
  - У SortableStageWrapper и у самой KanbanColumn должна быть одинаковая full-height/flex геометрия:
    &nbsp;
    - h-full
    - min-h-0
    - корректный flex/self-stretch
    &nbsp;
  - Нельзя чинить только outer wrapper или только inner column.
  - DoD: пустая open-стадия визуально тянется вниз так же, как Отказ и Успешно.
  &nbsp;
6. **Published click bug — считать закрытым только по published**
  &nbsp;
  - Preview-proof недостаточен.
  - Обязательный порядок проверки:
    &nbsp;
    - lovable preview;
    - published после Publish;
    - hard refresh published;
    - повторный тест после повторного открытия страницы.
    &nbsp;
  - Если preview работает, а published нет — патч не закрыт.
  &nbsp;
7. **Click-to-open — проверить 3 зоны карточки**
  &nbsp;
  - Отдельно проверить:
    &nbsp;
    - click по контенту карточки;
    - click рядом с left handle;
    - click рядом с move button.
    &nbsp;
  - Сделка должна открываться по обычному одиночному клику именно по content-zone.
  - Drag должен стартовать только из handle.
  &nbsp;
8. **Regression guard по массовому выделению**
  &nbsp;
  - После перехода на единый DnD обязательно проверить, что selection mode не ломается:
    &nbsp;
    - вход через checkbox стадии;
    - partial selection;
    - select-all по одной стадии;
    - выход через x;
    - floating bar.
    &nbsp;
  - Это нужно явно включить в verify.
  &nbsp;
9. **Regression guard по move button**
  &nbsp;
  - После унификации DnD перепроверить:
    &nbsp;
    - dropdown “Переместить” открывается от кнопки;
    - не зависает;
    - закрывается нормально;
    - не ломает click по карточке.
    &nbsp;
  &nbsp;
10. **Regression guard по createStage**

&nbsp;

&nbsp;

&nbsp;

- В этой задаче createStage не планируешь менять, но так как проблема ранее уже всплывала, в verify всё равно добавить:
  &nbsp;
  - создание 2 стадий подряд;
  - сохранение правильного порядка;
  - отсутствие ошибок constraint.
  &nbsp;
- Это нужно как smoke-check после переделки drag/order слоя.

&nbsp;

&nbsp;

&nbsp;

11. **Published-proof по длинным колонкам**

&nbsp;

&nbsp;

&nbsp;

- Проверять не на короткой колонке, а именно на длинных:
  &nbsp;
  - Gorbova Club
  - ЗАКРОЙ ГОД
  - Ценный бухгалтер
  &nbsp;
- Нужен факт, что в длинной колонке карточка открывается без промаха и без drag-конфликта.

&nbsp;

&nbsp;

&nbsp;

12. **Не закрывать патч без явного вывода о причине расхождения среды**

&nbsp;

&nbsp;

&nbsp;

- Если published bug исчезнет только после hard refresh, это тоже зафиксировать.
- Если причина — stale deploy / cache / publish lag, это должно быть прямо отражено в отчёте, а не замолчано.

&nbsp;

&nbsp;

&nbsp;

13. **DoD дополнить**

&nbsp;

&nbsp;

&nbsp;

- open-стадии реально drag-and-drop reorder;
- drag deals не сломан;
- click-to-open работает в preview и published;
- пустые open-стадии full-height;
- selection mode и bulk bar не сломаны;
- move dropdown не сломан;
- порядок стадий одинаков после refresh и между list/board;
- нет незакрытого расхождения “preview ok / published broken”.

&nbsp;

&nbsp;

В таком виде план нормальный и уже достаточный для узкого follow-up патча.

&nbsp;

План:

1. Проблема

Не закрыты 3 дефекта kanban:

- open-стадии не перетаскиваются;
- в published-среде сделки в длинных колонках не открываются по клику, хотя в preview открываются;
- open-стадии без сделок визуально обрезаны по высоте, из-за чего теряется tinted-фон.

2. Диагностика

- `docs/ENGINEERING_RULES.md` прочитан, работаю по цепочке Diagnose → Plan → Dry run → Execute → Verify.
- По коду в `DealsKanbanBoard.tsx` stage reorder собран через вложенные `DndContext`: внешний для стадий, внутренний для сделок.
- `SortableStageWrapper` рендерится внутри внутреннего `DndContext`, из-за чего sortable-логика стадий привязана к конфликтующему dnd-контексту. Это наиболее вероятный root cause, почему stage drag сейчас фактически не стартует.
- Второй root cause по визуалу пустых стадий тоже найден: open-стадии завернуты в дополнительный wrapper `<div ref={setNodeRef} style={style}>`, а fixed closed-стадии — нет. Из-за этого wrapper ломает flex-stretch по высоте, поэтому пустые open-колонки короче, чем «Отказ».
- `KanbanDealCard.tsx` уже ушёл от full-height overlay handle, но published/preview расходятся. По коду root cause не доказан окончательно, поэтому blind-fix запрещён. Нужно отдельно проверять production-only расхождение: актуальность publish, кеш фронтенда и реальный hit-area карточки в production bundle.
- `public/sw.js` есть, но fetch-кеширования там нет. Значит service worker сам по себе не выглядит главным доказанным root cause клика, хотя published-proof всё равно обязателен.
- Скрин подтверждает именно геометрическую проблему стадий: open-пустые колонки не дотягиваются вниз, а closed-колонки растянуты корректно.

3. Предлагаемое решение

- Починить drag стадий не косметически, а архитектурно:
  - убрать конфликт вложенных drag-контекстов;
  - перевести board на один канонический `DndContext` для stage + deal drag с явным разделением типов active item;
  - `SortableContext` оставить только для open-стадий;
  - в `onDragStart/onDragEnd` развести сценарии `stage` и `deal`.
- Восстановить правильную геометрию колонок:
  - сделать так, чтобы sortable-wrapper не ломал flex-stretch;
  - wrapper и сама колонка должны занимать одинаковую полную высоту ряда;
  - пустые open-стадии должны визуально тянуться вниз так же, как «Отказ».
- Закрыть published-only bug по click-to-open:
  - сохранить разделение drag handle и content-zone;
  - проверить, не ломает ли click production bundle / stale publish;
  - если preview ok, а published нет — считать patch незакрытым и чинить именно причину расхождения, а не объявлять фикс успешным.

4. Изменяемые компоненты

- `src/components/admin/deals/DealsKanbanBoard.tsx` — убрать конфликт nested DnD, перевести на единый DnD flow, сохранить перенос сделок и добавить корректный reorder стадий.
- `src/components/admin/deals/SortableStageWrapper.tsx` — привести wrapper к корректной full-height/flex-геометрии и data-контракту для stage drag.
- `src/components/admin/deals/KanbanColumn.tsx` — обеспечить полную высоту стадии и корректную работу внутри sortable-wrapper.
- `src/components/admin/deals/KanbanColumnHeader.tsx` — stage handle оставить компактным и безопасным.
- `src/components/admin/deals/KanbanDealCard.tsx` — при необходимости точечно доразвести content-zone / secondary-actions / drag-handle без нового визуального рефактора.

5. Что не будет изменено

- Selection mode, если в dry-run не подтвердится, что он ломает click.
- Палитра цветов и подбор цвета.
- createStage / reorder SQL-логика, если при этом патче не всплывёт новый связанный дефект.
- List-view, кроме обязательной проверки сохранённого порядка стадий.

6. Dry-run

Перед execute:

- проверить фактическую связь `useSortable`/`SortableContext`/вложенного `DndContext` и зафиксировать, какой контекст сейчас реально обслуживает stage drag;
- проверить геометрию wrapper у open-стадий против fixed closed-стадий;
- проверить hit-area карточки: content, handle, move-button, checkbox;
- отдельно проверить published vs preview:
  - preview внутри lovable;
  - published после Update/Publish;
  - hard refresh published;
  - зафиксировать отдельно, если preview работает, а published нет.

7. Execute

- Пересобрать kanban drag-архитектуру в один `DndContext` с различением типов drag item.
- Сохранить reorder только для open-стадий; `__unassigned`, `closed_won`, `closed_lost` оставить фиксированными.
- Поправить sortable-wrapper/column layout так, чтобы open-пустые колонки тянулись на полную высоту ряда.
- Точечно доработать click-to-open только если dry-run подтвердит production hit-area проблему после унификации drag-контекста.
- После этого сделать published-proof, а не ограничиваться preview-proof.

8. STOP-guards

Остановиться, если:

- выяснится, что published отстаёт от preview не из-за кода, а из-за неактуального deploy/caching layer;
- единый `DndContext` начинает ломать уже рабочий drag сделок;
- фикс высоты колонок меняет текущую цветовую модель или ломает scroll;
- click bug в published не воспроизводится на актуальном published build после hard refresh, и тогда нужен отдельный вывод про расхождение среды, а не слепой UI-patch.

9. DoD

Патч считать закрытым только если одновременно подтверждено:

- open-стадии реально перетаскиваются через handle;
- closed-стадии и «Без стадии» остаются фиксированными;
- новый порядок стадий сохраняется после refresh и одинаков в board-view и list-view;
- сделки открываются по одиночному клику:
  - в preview;
  - в published после Update/Publish и hard refresh;
  - минимум в сценариях `Gorbova Club`, `Закрой год`, `Ценный бухгалтер` в длинных колонках;
- drag сделки стартует только из handle и не ломает click по content;
- пустые open-стадии визуально растянуты вниз и сохраняют полный tinted-фон, как closed-стадии;
- нет ситуации “preview работает, published нет” без отдельного найденного и исправленного root cause.

10. Риски и зависимости

- Главный риск — текущий nested DnD конфликт может быть системной причиной сразу двух симптомов: stage drag и production click regression.
- Published-proof зависит от того, что фронтенд действительно обновлён через publish, а не только preview.
- Любой частичный фикс без проверки published нельзя считать завершением патча.

11. Требуется дополнительная информация

Дополнительных данных от вас не нужно. Следующий шаг — выполнить узкий follow-up patch по трём зонам: stage drag, published click-to-open, full-height empty stages, а затем дать proof отдельно для preview и published.