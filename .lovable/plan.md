да, согласен, с учетом правок:

&nbsp;

1. Не обещать “полностью серверный режим” для вкладки Все в текущем PATCH.  
Для site / preorders / training — да, делаем серверные фильтры, count и пагинацию.  
Для Все у вас всё равно остаётся cross-source merge из 3 разных источников, значит:  

  - либо это явно помечается как aggregated MVP mode;
  - либо не называем это полноценной server-side pagination для mixed tab.  
  Иначе в отчёте будет архитектурное расхождение.
2. &nbsp;
3. То же самое для вкладки По продуктам.  
Если она строится поверх aggregate-результата из нескольких источников, это не чисто серверная группировка.  
Оставить можно, но в плане явно написать:  

  - single-source tabs → server paginated/filterable
  - Все и По продуктам → aggregated mode поверх уже серверно отфильтрованных source-tabs данных
4. &nbsp;
5. Поиск для site_form_submissions нужно описать аккуратнее.  
Сейчас в формах клиентские поля часто лежат в form_data/metadata, а не в нормализованных колонках.  
Нельзя в плане писать поиск по name/email/phone как будто это везде одинаковые поля.  
Нужна source-specific логика:  

  - preorders → прямой server search по колонкам
  - training → search через profile/email/full_name
  - site_forms → только по тем полям, которые реально доступны/индексируемы (metadata, profile, resolved profile/email, и т.д.)  
  Если часть поиска по site forms пока не получается серверно — так и зафиксировать, не притворяться, что он уже универсальный.
6. &nbsp;
7. Фильтр product_id для site forms через metadata->>product_id — проверить синтаксис PostgREST заранее.  
Если точный JSON-path filter работает нестабильно/неудобно, не городить хрупкую магию.  
Тогда:  

  - для single-source site_form tab допускается ограниченный server-side filter;
  - либо отдельный fallback до следующего PATCH.  
  Это надо вынести в dry-run, чтобы не сломать запросы.
8. &nbsp;
9. page и pageSize лучше не класть в общий filters object как обычные бизнес-фильтры без правил reset.  
Нужна явная логика:  

  - изменение search/product/period/source/reset filters → сбрасывает page=1
  - переключение вкладки → сбрасывает page=1
  - изменение sort → сбрасывает page=1  
  Иначе пользователь быстро попадёт на пустые страницы.
10. &nbsp;
11. Сортировку не надо обещать одинаково для всех вкладок.  
Для single-source tabs допустима серверная сортировка.  
Для Все:  

  - базовая каноническая сортировка created_at desc, id
  - если хотите client/status sorting, это либо post-merge sort, либо откладываем.  
  Не раздувать scope.
12. &nbsp;
13. FormsByProductTabContent не должен тянуть “все записи без ограничений” незаметно.  
При текущих объёмах это терпимо, но в плане нужно прямо отметить:  

  - grouped tab пока работает как aggregated grouped mode;
  - если dataset вырастет, следующим шагом нужен отдельный grouped backend path / counts.  
  Иначе будет ложное ощущение, что проблема уже решена архитектурно.
14. &nbsp;
15. Экспорт лучше делать не через pageSize: 99999, а через явный режим exportMode.  
Это правильнее и чище:  

  - export использует те же filters
  - но отключает UI pagination
  - и делает отдельную выборку под export scope  
  Не привязывать export к магическому огромному лимиту без явного режима.
16. &nbsp;
17. Период-фильтры — да, добавить в UI, но не забыть timezone-consistency.  
Для period_to использовать конец дня детерминированно и одинаково по всем источникам.  
Иначе разные записи в разных таблицах начнут выпадать на границе суток.
18. В FormsHubTable основной row click оставить единым действием “open detail”.  
Отдельные action-buttons оставить только для:  

  - открыть контакт
  - открыть сделку  
  И не дублировать кнопку “открыть detail” внутри строки, если именно она создаёт ощущение нестабильного клика.
19. &nbsp;
20. Добавить в DoD отдельный пункт про source-specific correctness:  

  - site_form
  - preorder
  - training  
  должны каждый отдельно пройти проверку:
  - filters
  - counts
  - sorting
  - details
  - export
21. &nbsp;
22. Добавить явную пометку в плане:  
этот PATCH — стабилизация и подготовка к росту, а не финальный unified backend layer.  
Это важно, чтобы потом не оказалось, что “серверный режим” был обещан шире, чем реально реализован.

&nbsp;

&nbsp;

Итог: план хороший и рабочий, но его нужно чуть уточнить, чтобы:

&nbsp;

- не переобещать server-side там, где остаётся cross-source aggregate,
- не сделать хрупкий поиск/фильтр по JSON,
- не сломать pagination UX.

&nbsp;

&nbsp;

Копируемая формулировка для [lovable.dev](http://lovable.dev):

Дополни план PATCH 1 следующими правками:

&nbsp;

1. Не называть вкладку `Все` полностью server-side paginated в текущем PATCH. Для mixed cross-source tab это aggregated mode поверх 3 источников. Полноценный unified backend layer сейчас не строим.

2. То же правило применить к вкладке `По продуктам`: это grouped aggregated mode, а не чистая серверная группировка.

3. Поиск делать source-specific, без ложного обещания универсального поиска по одинаковым полям:

   - preorders: прямой search по колонкам

   - training: через profile/full_name/email

   - site_forms: только по реально доступным/канонически резолвимым полям

4. Для `site_form` product filter через `metadata->>product_id` сначала проверить точный рабочий PostgREST/Supabase syntax в dry-run.

5. `page` и `pageSize` должны сбрасываться на `page=1` при смене фильтров, sort и tab.

6. Серверную сортировку обещать только для single-source tabs. Для `Все` оставить базовую каноническую сортировку `created_at desc, id`.

7. Экспорт делать через явный `exportMode`, а не через магический `pageSize: 99999`.

8. Период-фильтры реализовать детерминированно с единым end-of-day handling.

9. В строке таблицы единый row-click = open detail; отдельные action buttons только для contact/deal navigation.

10. В DoD отдельно подтвердить корректность по каждому source:

   - site_form

   - preorder

   - training

&nbsp;

# План: PATCH 1 — стабилизация `/admin/forms`

## Контекст

Текущие объёмы данных: 15 site_forms + 29 preorders + 63 training = 107 записей. При таких объёмах создавать RPC/VIEW — overengineering. Правильная стратегия: **перевести фильтрацию на серверные `.eq()/.gte()/.ilike()` в Supabase SDK**, убрать client-side merge как единственный режим, добавить пагинацию и total counts через `{ count: 'exact' }`. Это даёт серверную фильтрацию без новых таблиц/RPC.

## Шаги

### 1. Рефакторинг `useFormsHubData` — серверные фильтры и пагинация

Переписать хук с новой сигнатурой:

```
interface FormsHubResult {
  rows: FormsHubRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}
```

**Серверные фильтры** (применяются в `.select()` до `.limit()`):

- `period_from` → `.gte("created_at", period_from)`
- `period_to` → `.lte("created_at", period_to + "T23:59:59")`
- `search` → `.or('name.ilike.%q%,email.ilike.%q%,phone.ilike.%q%')` (адаптировано под каждый источник)
- `product_id` → для site_forms через `metadata->>product_id`, для training через join
- `has_deal` → для site_forms `.not("order_id", "is", null)` / `.is("order_id", null)`

**Пагинация**: `.range(offset, offset + pageSize - 1)` + `{ count: 'exact' }` в select

**Детерминированная сортировка**: `.order("created_at", { ascending: false })` как primary, `.order("id")` как tiebreaker

**Для "all" tab**: три параллельных запроса с одинаковыми фильтрами → merge + sort на клиенте только для cross-source tab. Для single-source tabs — чисто серверный результат.

### 2. Добавить `page` и `pageSize` в `FormsHubFilters`

```
page: number;       // default 1
pageSize: number;   // default 50
```

### 3. Добавить пагинатор в `FormsHubTable`

Под таблицей: `< Prev | Page X of Y | Next >` + total count. Reuse pattern из CRM deals list если есть, иначе простой компонент.

### 4. Добавить period-фильтры в `FormsHubFiltersPanel`

Два input type="date" для `period_from` и `period_to`. Уже есть в `FormsHubFilters`, но UI-элементы не отрисованы.

### 5. Добавить сортировку в таблицу

Использовать existing `SortPill` компонент. Сортируемые колонки: Дата, Клиент, Статус. Сортировка передаётся в хук и применяется серверно через `.order()`.

### 6. Вкладка «По продуктам» — привести к общему data layer

Сейчас `FormsByProductTabContent` вызывает `useFormsHubData(filters)` без пагинации и потом группирует на клиенте. Это корректно для текущих объёмов. Оставить как есть, но:

- убрать `limit(500)` → использовать новый серверно-фильтрованный результат
- total count показывать в header каждой группы

### 7. Вкладка «Экспорт» — от серверной выборки

Сейчас `FormsExportTabContent` использует тот же `useFormsHubData`. Экспорт должен:

- запрашивать ВСЕ записи (без pageSize limit) через отдельный вызов с `pageSize: 99999`
- или вызывать тот же хук но без пагинации (специальный флаг `exportMode: true`)

### 8. UX-полировка кликов

В `FormsHubTable` строка кликабельна целиком (`onClick` на `<TableRow>`). Проблема «иногда не попадает» может быть из-за двойного handler (row click + button click с stopPropagation). Убрать отдельную кнопку ExternalLink или сделать её только для "открыть в новом контексте" (контакт/сделка), а row click = open detail.

## Файлы


| Файл                                                      | Действие                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/hooks/useFormsHubData.ts`                            | Рефакторинг: серверные фильтры, пагинация, total counts, deterministic sort |
| `src/components/admin/forms/FormsHubFilters.tsx`          | Добавить period inputs, sort pills                                          |
| `src/components/admin/forms/FormsHubTable.tsx`            | Добавить пагинатор, sort state                                              |
| `src/components/admin/forms/FormsAllTabContent.tsx`       | Пробросить page/sort state                                                  |
| `src/components/admin/forms/FormsSiteTabContent.tsx`      | Пробросить page/sort state                                                  |
| `src/components/admin/forms/FormsTrainingTabContent.tsx`  | Пробросить page/sort state                                                  |
| `src/components/admin/forms/FormsByProductTabContent.tsx` | Убрать limit(500), показать counts                                          |
| `src/components/admin/forms/FormsExportTabContent.tsx`    | Export от серверной выборки, exportMode flag                                |


## Scope guard

- Новых таблиц НЕ создавать
- Новых RPC/View НЕ создавать (при 107 записях — overhead)
- Training details = только existing `StudentProgressModal`
- Site form details = только existing form dialog
- Preregistration details = только existing detail sheet
- Redirects не трогать

## DoD

1. Фильтры period, search, product, has_deal, has_account применяются серверно через Supabase SDK `.eq()/.gte()/.ilike()`
2. Пагинация работает с total count
3. Детерминированная сортировка `created_at desc, id`
4. Вкладка «По продуктам» показывает группы с counts
5. Вкладка «Экспорт» экспортирует серверную выборку
6. Period-фильтры (от/до) отображаются в UI
7. Details открываются стабильно
8. `limit(500)` убран, заменён на пагинацию
9. Accepted MVP-поведение не сломано