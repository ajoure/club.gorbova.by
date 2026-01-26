

# Исправление импорта Выписки BePaid — парсер дат

## Проблема

1. **Данные сохранены**: 640 строк успешно импортированы в `bepaid_statement_rows`
2. **Даты = NULL**: Все поля `paid_at`, `created_at_bepaid`, `payout_date` пустые
3. **Причина**: Парсер не понимает формат bePaid: `2026-01-03 19:07:25 +0300`
4. **Результат**: Фильтр по датам не находит записи, UI показывает "Нет данных"

## Решение

### 1. Исправить парсер дат (BepaidStatementImportDialog.tsx)

Добавить поддержку формата bePaid с таймзоной:

```typescript
// Новый формат для bePaid
// "2026-01-03 19:07:25 +0300"
const formats = [
  "yyyy-MM-dd HH:mm:ss xxxx",  // bePaid: "2026-01-03 19:07:25 +0300"
  "yyyy-MM-dd HH:mm:ss",       // без таймзоны
  "dd.MM.yyyy HH:mm:ss",
  "dd.MM.yyyy HH:mm",
  "dd.MM.yyyy",
  "yyyy-MM-dd",
];
```

**Также добавить fallback**: если date-fns не справляется, использовать `new Date(value)` напрямую — JavaScript умеет парсить `2026-01-03 19:07:25 +0300`.

### 2. Повторный импорт

После исправления парсера:
1. Загрузить тот же файл `1-25-4.xlsx` снова
2. Upsert по UID обновит все 640 записей
3. Даты заполнятся корректно
4. Данные появятся в UI

### 3. Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/components/admin/payments/BepaidStatementImportDialog.tsx` | Исправить `parseExcelDate()` |

### 4. Изменения в parseExcelDate

```typescript
function parseExcelDate(value: unknown): string | null {
  if (!value) return null;
  
  // Excel serial date number
  if (typeof value === 'number') {
    const excelDate = XLSX.SSF.parse_date_code(value);
    if (excelDate) {
      return new Date(excelDate.y, excelDate.m - 1, excelDate.d, excelDate.H || 0, excelDate.M || 0, excelDate.S || 0).toISOString();
    }
  }
  
  // String date
  if (typeof value === 'string') {
    const trimmed = value.trim();
    
    // Method 1: Try native Date parsing (handles "2026-01-03 19:07:25 +0300" well)
    const nativeDate = new Date(trimmed);
    if (!isNaN(nativeDate.getTime())) {
      return nativeDate.toISOString();
    }
    
    // Method 2: Try ISO format
    const isoDate = parseISO(trimmed);
    if (isValid(isoDate)) return isoDate.toISOString();
    
    // Method 3: Try common formats
    const formats = ['dd.MM.yyyy HH:mm:ss', 'dd.MM.yyyy HH:mm', 'dd.MM.yyyy', 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd'];
    for (const fmt of formats) {
      try {
        const parsed = parse(trimmed, fmt, new Date());
        if (isValid(parsed)) return parsed.toISOString();
      } catch {
        // continue
      }
    }
  }
  
  return null;
}
```

**Ключевое изменение**: Добавить `new Date(trimmed)` в начало — это гарантированно распарсит формат bePaid.

## Порядок выполнения

1. ✏️ Исправить `parseExcelDate` в `BepaidStatementImportDialog.tsx`
2. 📤 Повторно импортировать файл `1-25-4.xlsx`
3. ✅ Данные появятся в таблице (даты будут заполнены)

## DoD

- После импорта в SQL:
  ```sql
  SELECT COUNT(*) FROM bepaid_statement_rows WHERE paid_at IS NOT NULL;
  -- Ожидаемо: 640 (вместо 0)
  ```
- UI показывает 640 транзакций за январь 2026

