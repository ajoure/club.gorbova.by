

# PATCH 10.2 fix — три правки в AiDocumentsHistoryView.tsx

## Что уже правильно

Код уже использует отдельный `<TableBody>` для каждого batch и standalone — структура `table > thead + N×tbody` валидна. Это закрывает пункт 1 из замечаний.

## Три правки

### 1. Сортировка — корректный comparator (строка 113)

Текущий код:
```ts
result.sort((a, b) => (b.maxCreatedAt > a.maxCreatedAt ? 1 : -1));
```
При равных значениях возвращает -1 вместо 0. Исправить на:
```ts
result.sort((a, b) =>
  new Date(b.maxCreatedAt).getTime() - new Date(a.maxCreatedAt).getTime()
);
```

### 2. Сортировка child rows внутри batch (строка 106)

Перед `result.push` для batch отсортировать `docs` по `created_at` DESC:
```ts
docs.sort((a, b) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
);
```

### 3. Семантика таблицы — уже ок

Проверено: batch рендерится как `<TableBody key={entry.batchId}>` (строка 212), standalone как `<TableBody key={entry.doc.id}>` (строка 278). Каждая запись — отдельный `tbody`. Структура валидна, правка не нужна.

## Файлы

| Действие | Файл | Строки |
|----------|------|--------|
| Edit | `src/components/ai-documents/AiDocumentsHistoryView.tsx` | 106, 113 |

