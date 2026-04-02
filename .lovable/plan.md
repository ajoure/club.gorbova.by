

# План: Сортировка продуктов по алфавиту по умолчанию

## Проблема
На странице `/admin/products-v2` продукты отображаются в произвольном порядке при загрузке. Нужно по умолчанию сортировать по имени (А → Я).

## Решение

### Файл: `src/pages/admin/AdminProductsV2.tsx` (строка 333)

Добавить `defaultSortKey` и `defaultSortDirection` в вызов `useTableSort`:

```typescript
const { sortedData, sortKey, sortDirection, handleSort } = useTableSort({
  data: searchFiltered,
  defaultSortKey: "name",
  defaultSortDirection: "asc",
  getFieldValue: (item: any, key: string) => {
    // ... без изменений
  },
});
```

Хук `useTableSort` уже поддерживает оба параметра — никаких других изменений не требуется. Существующие кнопки сортировки продолжат работать как раньше.

