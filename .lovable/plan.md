План: исправление счётчика «Показано X из Y» в разделе Сделки

## Диагноз (read-only)

Скриншот пользователя: URL `?statuses=paid&product=de36a695...&pipeline=a0000001-...-008`, заголовок «Показано: 13 из 32». Кнопки «Показать ещё» нет.

Что реально происходит в `src/pages/admin/AdminDeals.tsx`:

1. **Загрузка работает корректно.** `useInfiniteQuery` тянет страницы по `PAGE_SIZE=100` через PostgREST. Серверный фильтр уже включает `pipeline_id`, `tariff_id`, `product_id`, `extraFilters.statuses` (строки 165–251, 517).
2. **На сервере по этим фильтрам действительно 13 строк** (paid + продукт «Подходный налог ИП» + pipeline «Подходный налог ИП»). Поэтому первая страница вернула 13, `hasNextPage=false`, кнопка «Показать ещё» правильно скрыта (строка 1535).
3. **Проблема — только в знаменателе «из 32».** `totalCount` берётся из `tabCounts` через RPC `get_deal_tab_counts` (строка 398), которая считает сделки **только** по `search`, `product_id` и диапазону дат. Она **не учитывает**:
   - `activePipelineId` (фильтр по воронке);
   - `selectedTariffIds` (фильтр по тарифам);
   - `extraFilters.statuses` (фильтр-табы «Оплачен / Ожидает / …» из URL `statuses=`);
   - остальные `extraFilters` (provider, source, contact, price range, stageId, reconcileSource, includeSynthetic, createdFrom/To).
4. Дополнительно, в `useMemo` для `totalCount` (строки 823–831) `switch (activePreset)` вообще не имеет case-ов для `paid/pending/failed` — но это сейчас не критично, потому что preset `all` и так показывает `tabCounts.all`.

Итог: бага «не показываются все сделки» нет. Есть **баг отображения**: знаменатель «из 32» соответствует «всего сделок по продукту», а не «всего сделок по текущему набору фильтров». Это ровно то, что пользователь воспринял как «13 из 32, добавить нельзя».

## Что меняем

### 1. Источник правды для знаменателя

Делаем знаменатель «из N» консистентным с тем, что реально применяется к запросу. Самый дешёвый и надёжный путь — попросить PostgREST вернуть exact count тем же запросом, который уже строится в `buildDealsQuery`, и использовать его как `totalCount`.

Изменения в `src/pages/admin/AdminDeals.tsx`:

- В ветке «Default mode» (строки 516–527) добавить к запросу `{ count: "exact", head: false }` (через `.select(..., { count: "exact" })` в самом `buildDealsQuery`) и вернуть из `queryFn` поле `totalCount` из `count`.
- В ветке «search mode» (строки 463–514) — обернуть RPC `search_deal_rows` дополнительным параметром или вторым лёгким RPC `search_deal_count`, который возвращает только `int` с тем же набором аргументов (`p_search`, `p_product_id`, `p_date_from`, `p_date_to`, `p_preset`). Если расширение RPC дороже — на первом шаге fallback: `totalCount = filtered.length` пока загружено < PAGE_SIZE, иначе `undefined` (тогда показываем «Показано: N» без «из»).
- В `useInfiniteQuery` сохранять `totalCount` из первой страницы в локальный стейт/мемо (берём `dealsData?.pages[0]?.totalCount`).
- Заменить вычисление `totalCount` (строки 823–831) на этот «server-truth» count.

### 2. Поведение UI

- «Показано: X из Y» — Y теперь = реальное количество строк под текущие фильтры (pipeline + tariff + product + preset + extraFilters.statuses + даты + поиск).
- Условие скрытия кнопки «Показать ещё» (строки 1528–1572) упрощается: больше не нужен флаг `filtersBeyondTabCounts`, так как `totalCount` всегда консистентен. Логика становится:
  - если `loadedCount >= totalCount` И `!hasNextPage` → скрыть;
  - иначе показать «Показать ещё N (осталось M)», где `M = totalCount - loadedCount`.
- Tab-счётчики на табах «Все / Триал / Отменённые / Импортированные» (`DEAL_PRESETS`, строки 735–740) **оставляем как есть** — это сводные числа по продукту/датам, они должны игнорировать pipeline/tariff, иначе теряют смысл.

### 3. Регресс-проверка по другим разделам

Проверить и при необходимости применить ту же модель «server-truth count = same query as data» (или явно подписать «по продукту», чтобы не путать пользователя):

- `/admin/orders-v2` (если есть аналогичный счётчик) — проверить.
- `/admin/contacts` — `Показано` присутствует, проверить, что Y совпадает с применёнными фильтрами.
- `/admin/payments` (`PaymentsTabContent`, `LinksTabContent`, `BepaidSubscriptionsTabContent`, `BepaidStatementTabContent`) — проверить совпадение Y с фильтрами; при расхождении — выровнять по тому же принципу.
- `/admin/forms/*` — проверить.

В этих разделах ничего не трогаем, если счётчик уже корректный; правки точечные.

## Технические детали

- `buildDealsQuery` (строки 165–251) меняем сигнатуру/реализацию так, чтобы возвращался запрос с `select(..., { count: "exact" })`. Все существующие фильтры остаются нетронутыми.
- В `queryFn` (PostgREST-ветка):
  ```text
  const { data, error, count } = await query
    .order("deal_date", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(pageParam, pageParam + PAGE_SIZE - 1);
  return { rows: data || [], nextOffset: ..., totalCount: count ?? undefined };
  ```
- Для search-режима — на первом шаге допускаем `totalCount: undefined` и аккуратно деградируем UI: «Показано: N» без «из», кнопка «Показать ещё» работает по `hasNextPage`. Расширение RPC делаем отдельной задачей, если потребуется точный счётчик в поиске.
- `useMemo` для `totalCount` теперь читает `dealsData?.pages?.[0]?.totalCount`.
- Условие «Показать ещё» переписываем на основе нового `totalCount`.

## Что НЕ трогаем

- Серверные фильтры — уже корректны.
- Tab-counts RPC `get_deal_tab_counts` — оставляем без изменений.
- Структуру таблиц, RPC, edge functions, миграции.
- Board-режим (Kanban) — там своя загрузка.

## DoD

- На скрине пользователя (paid + продукт + pipeline) счётчик показывает «Показано: 13 из 13», кнопка «Показать ещё» скрыта.
- На «Все периоды / Все / без pipeline / без tariff» по тому же продукту — счётчик показывает «13 из 32» → станет «X из X_total_по_фильтрам» (например «32 из 32»).
- При смене pipeline/tariff/preset/статуса/диапазона дат — Y моментально пересчитывается и совпадает с реальным количеством.
- Регресс-чек: открыть 3 другие воронки и 3 других продукта — счётчик и кнопка «Показать ещё» ведут себя консистентно, кнопка появляется ровно тогда, когда `loaded < total`.
- В Kanban-режиме поведение не изменилось.
- В отчёте указать: какие файлы изменены, какие RPC/таблицы/edge functions затронуты (ожидается: только UI + опционально новый read-only RPC `search_deal_count`, без изменений схемы).
