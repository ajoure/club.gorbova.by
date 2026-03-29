

# План: Исправить логику фильтров по продуктам на странице «Сделки»

## Проблема

На странице `AdminDeals.tsx` счётчики на product-pills (например, «ЗАКРОЙ ГОД 8», «Gorbova Club 99+») вычисляются **независимо от активного пресета и поиска**. Это создаёт расхождение: пользователь видит на pill одно число, а после клика на неё — другое количество записей.

### Корневая причина (строки 365-375)

`productCounts` вычисляется из **сырого `deals`** (только с фильтром `VALID_DEAL_STATUSES`), но **не учитывает**:
- активный пресет (Триал / Отменённые / Импортированные)
- текстовый поиск
- дополнительные фильтры из QuickFilters

А `filteredDeals` (строки 345-362) — уже пропускает данные через все эти фильтры. В итоге pills показывают глобальные числа, а таблица — отфильтрованные.

## Решение

Пересчитывать `productCounts` **из `filteredDeals`** (но без product-фильтра, чтобы pills отражали, сколько записей будет видно при клике).

### Изменение 1: `productCounts` — считать из отфильтрованных данных

Вместо текущего:
```ts
const productCounts = useMemo(() => {
  const validDeals = deals.filter(d => VALID_DEAL_STATUSES.includes(...));
  // counts from ALL valid deals
}, [deals]);
```

Сделать:
```ts
const productCounts = useMemo(() => {
  // filteredDeals уже прошли preset + search + quickFilters
  // Но нужно убрать product filter, чтобы показать сколько будет при клике
  let base = dealsWithIndex; // уже VALID_DEAL_STATUSES
  
  if (debouncedSearch) {
    base = base.filter(d => matchSearchIndex(debouncedSearch, d.search_index));
  }
  base = applyFilters(base, activeFilters, getDealFieldValue);
  
  const counts = new Map<string, number>();
  base.forEach(d => {
    if (d.product_id) counts.set(d.product_id, (counts.get(d.product_id) || 0) + 1);
  });
  return counts;
}, [dealsWithIndex, debouncedSearch, activeFilters, getDealFieldValue]);
```

Это одно изменение в `AdminDeals.tsx` (строки 364-375).

### Результат

- При табе «Все» — pills показывают общее число по продукту (как сейчас, но корректно)
- При табе «Триал» — pills показывают только trial-сделки по каждому продукту
- При поиске — pills обновляются в реальном времени
- Клик на pill всегда показывает ровно столько записей, сколько указано на badge

