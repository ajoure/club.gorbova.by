
# Исправления диалога синхронизации с Выпиской bePaid

## Проблемы и решения

### 1. Скролл не работает

**Причина**: `ScrollArea` не имеет фиксированной высоты, а `DialogContent` с `flex flex-col` не правильно ограничивает контейнер.

**Решение**: Добавить явную высоту для `ScrollArea` и исправить CSS:

```tsx
// Изменить в DialogContent
<DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden">

// Изменить контейнер ScrollArea  
<ScrollArea className="h-[400px] border rounded-lg">
```

---

### 2. Добавить детальную статистику (3 строки)

**Текущее состояние**: Показывает только 4 числа (В выписке, В payments, Совпало, Расхождений)

**Требуется**: 3 строки сравнения:

| Метрика | В выписке bePaid | В payments_v2 | После синхронизации |
|---------|------------------|---------------|---------------------|
| Всего транзакций | 682 | 471 | 682 |
| Успешные платежи | 600 | 450 | 600 |
| Возвраты | 50 | 45 | 50 |
| Отмены | 20 | 15 | 20 |
| Ошибки | 12 | 11 | 12 |
| Сумма успешных | 50 000 | 48 000 | 50 000 |
| Комиссия | 1 200 | — | 1 200 |

**Изменения**:

1. **Edge Function** - добавить расчёт детальной статистики:
   ```typescript
   interface DetailedStats {
     total: number;
     succeeded: { count: number; amount: number };
     refunded: { count: number; amount: number };
     cancelled: { count: number; amount: number };
     failed: { count: number; amount: number };
     commission_total: number;
   }
   
   interface SyncStats {
     statement_stats: DetailedStats;   // Выписка bePaid
     payments_stats: DetailedStats;    // Текущие payments_v2
     projected_stats: DetailedStats;   // После синхронизации
     // ... existing fields
   }
   ```

2. **UI компонент** - добавить таблицу сравнения:
   ```text
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ Сравнение данных                                                        │
   ├─────────────┬───────────────┬───────────────┬──────────────────────────┤
   │ Метрика     │ Выписка 🟢    │ Payments 🔴   │ После синхронизации →    │
   ├─────────────┼───────────────┼───────────────┼──────────────────────────┤
   │ Всего       │     682       │     471       │        682               │
   │ Успешные    │ 600 (50000₽)  │ 450 (48000₽)  │   600 (50000₽)           │
   │ Возвраты    │  50 (2500₽)   │  45 (2300₽)   │    50 (2500₽)            │
   │ Отмены      │  20 (1000₽)   │  15 (800₽)    │    20 (1000₽)            │
   │ Ошибки      │  12 (600₽)    │  11 (550₽)    │    12 (600₽)             │
   │ Комиссия    │    1200₽      │      —        │      1200₽               │
   └─────────────┴───────────────┴───────────────┴──────────────────────────┘
   ```

---

### 3. Нормализация transaction_type (КРИТИЧНО!)

**Проблема**: На скриншоте видно:
- `refund → Отмена` 
- `payment → Платеж`

Система уже нормализовала данные в `payments_v2` к английским значениям (`void`, `refund`), но синхронизация записывает русские названия из выписки.

**Риски**:
- Миграция `20260121145301` уже привела все к `void`/`refund`
- Если записать "Платеж", "Отмена" — это **сломает консистентность**
- Хотя код использует `includes()` для детекции, лучше хранить унифицированные значения

**Решение**: Добавить нормализацию `transaction_type` в Edge Function:

```typescript
// Новая функция в sync-payments-with-statement
function normalizeTransactionType(rawType: string | null): string {
  if (!rawType) return 'payment';
  const t = rawType.toLowerCase().trim();
  
  // Refund
  if (t.includes('возврат') || t.includes('refund')) return 'refund';
  
  // Cancellation
  if (t.includes('отмен') || t.includes('void') || t.includes('cancel')) return 'void';
  
  // Payment (default)
  return 'payment';
}

// Использование в create/update:
transaction_type: normalizeTransactionType(stmt.transaction_type),
```

**Отображение в UI**: Показывать понятные названия для пользователя:
```typescript
const TX_TYPE_LABELS = {
  'payment': 'Платёж',
  'refund': 'Возврат',
  'void': 'Отмена',
};
```

---

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `supabase/functions/sync-payments-with-statement/index.ts` | Добавить `normalizeTransactionType()`, расширить stats |
| `src/components/admin/payments/SyncWithStatementDialog.tsx` | Исправить scroll, добавить таблицу сравнения статистики |

---

## Детальные изменения

### Edge Function

1. Добавить функцию `normalizeTransactionType()`:
```typescript
function normalizeTransactionType(rawType: string | null): string {
  if (!rawType) return 'payment';
  const t = rawType.toLowerCase().trim();
  
  if (t.includes('возврат') || t.includes('refund')) return 'refund';
  if (t.includes('отмен') || t.includes('void') || t.includes('cancel')) return 'void';
  
  return 'payment';
}
```

2. Добавить расчёт детальной статистики:
```typescript
function calculateDetailedStats(rows: any[], isStatement: boolean): DetailedStats {
  const stats = {
    total: rows.length,
    succeeded: { count: 0, amount: 0 },
    refunded: { count: 0, amount: 0 },
    cancelled: { count: 0, amount: 0 },
    failed: { count: 0, amount: 0 },
    commission_total: 0,
  };
  
  for (const row of rows) {
    const status = normalizeStatus(row.status);
    const txType = normalizeTransactionType(row.transaction_type);
    const amount = Math.abs(row.amount || 0);
    
    // По transaction_type определяем категорию
    if (txType === 'refund') {
      stats.refunded.count++;
      stats.refunded.amount += amount;
    } else if (txType === 'void') {
      stats.cancelled.count++;
      stats.cancelled.amount += amount;
    } else if (status === 'failed') {
      stats.failed.count++;
      stats.failed.amount += amount;
    } else if (status === 'succeeded') {
      stats.succeeded.count++;
      stats.succeeded.amount += amount;
    }
    
    if (isStatement) {
      stats.commission_total += row.commission_total || 0;
    }
  }
  
  return stats;
}
```

3. Использовать `normalizeTransactionType` при записи:
```typescript
// Line 586 (create)
transaction_type: normalizeTransactionType(stmt.transaction_type),

// Line 612 (update)
transaction_type: normalizeTransactionType(stmt.transaction_type),
```

### UI Компонент

1. Исправить scroll:
```tsx
<ScrollArea className="h-[400px] border rounded-lg">
```

2. Добавить интерфейс и таблицу сравнения:
```tsx
interface DetailedStats {
  total: number;
  succeeded: { count: number; amount: number };
  refunded: { count: number; amount: number };
  cancelled: { count: number; amount: number };
  failed: { count: number; amount: number };
  commission_total: number;
}

// В компоненте добавить:
{stats && stats.statement_stats && (
  <div className="border rounded-lg overflow-hidden">
    <table className="w-full text-sm">
      <thead className="bg-muted/50">
        <tr>
          <th className="text-left p-2">Метрика</th>
          <th className="text-center p-2 text-emerald-600">Выписка 🟢</th>
          <th className="text-center p-2 text-red-500">Payments 🔴</th>
          <th className="text-center p-2 text-blue-600">После →</th>
        </tr>
      </thead>
      <tbody>
        {/* Rows for each metric */}
      </tbody>
    </table>
  </div>
)}
```

3. Показывать понятные названия типов транзакций:
```tsx
const TX_TYPE_LABELS: Record<string, string> = {
  'payment': 'Платёж',
  'refund': 'Возврат',
  'void': 'Отмена',
};

// В renderChange для transaction_type
<span className="text-red-500">{TX_TYPE_LABELS[diff.current] || diff.current}</span>
→
<span className="text-emerald-600">{TX_TYPE_LABELS[diff.statement] || diff.statement}</span>
```

---

## Порядок выполнения

1. ✏️ **Edge Function** — добавить `normalizeTransactionType()`, использовать при create/update
2. ✏️ **Edge Function** — добавить `calculateDetailedStats()`, вернуть в response
3. ✏️ **UI** — исправить scroll (добавить `h-[400px]`)
4. ✏️ **UI** — добавить таблицу сравнения статистики
5. ✏️ **UI** — добавить человекопонятные лейблы для типов транзакций

---

## DoD

- [ ] Скролл работает в списке изменений
- [ ] Показываются 3 строки статистики: Выписка / Payments / После синхронизации
- [ ] Transaction type нормализуется к `payment`/`refund`/`void` при записи
- [ ] В UI показываются понятные названия: Платёж, Возврат, Отмена
