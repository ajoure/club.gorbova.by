
# План исправления: Синхронизация, фильтры и дизайн платежей

## Выявленные проблемы

### 1. Ошибка "no unique or exclusion constraint matching the ON CONFLICT specification" (224 ошибки)
**Причина:** В таблице `payments_v2` есть три **partial unique index** с условием `WHERE provider_payment_id IS NOT NULL`:
- `uq_payments_v2_provider_payment`
- `idx_payments_v2_unique_provider_payment_id`
- `idx_payments_v2_provider_uid`

PostgreSQL не позволяет использовать `onConflict` с partial indexes напрямую в Supabase JS SDK. Нужно использовать `.insert()` с обработкой ошибки дубликата, либо проверять существование записи перед вставкой.

**Решение:**
1. Перед INSERT проверить существование записи по `provider_payment_id`
2. Если существует — выполнить UPDATE вместо INSERT
3. Убрать `upsert()` и использовать явную логику INSERT/UPDATE

---

### 2. Контакты не привязываются к новым платежам (203 записи без profile_id)
**Причина:** Карты новых плательщиков (например, 8263) **не зарегистрированы** ни в `card_profile_links`, ни в `payment_methods`. Функция `findProfileByCard` возвращает `null`.

**Текущие данные:**
- card_last4 = 8263: 0 записей в card_profile_links
- card_last4 = 8263: 0 записей в payment_methods

**Решение:** Это **ожидаемое поведение** — автосвязывание работает только для уже известных карт. Чтобы связать новую карту:
1. Вручную привязать карту к контакту через UI "Привязать контакт"
2. После этого будущие платежи с этой картой будут автоматически связаны

Однако можно улучшить UX: показывать badge "Неизвестная карта" и quick-action для привязки.

---

### 3. Счётчик не совпадает: 661 vs 682 (21 отсутствует)
**Данные БД:**
- payments_v2 (origin=bepaid): 486
- payments_v2 (origin=statement_sync): 203
- **Итого:** 689 (больше чем 682 в выписке!)

**Проблема:** 7 дубликатов были созданы — те же UID существуют и в `bepaid`, и в `statement_sync`. А 21 ошибка = попытка создать дубликаты.

**Решение:** Логика sync должна проверять все origins при определении "create vs update":
```typescript
// Вместо: .eq('origin', 'bepaid')
// Использовать: .in('origin', ['bepaid', 'statement_sync', 'import'])
```

---

### 4. Таймзона отображается неправильно (Минск показывает Варшаву)
**Проверка:** 
- paid_at в БД: `2026-01-26 20:35:34+00` (UTC)
- Минск (UTC+3): должно быть `23:35:34`
- Варшава (UTC+1 зимой): должно быть `21:35:34`

**Возможные причины:**
1. Неправильный label в COMMON_TIMEZONES — **проверено, labels корректны**
2. localStorage хранит старое значение — **возможно**
3. Баг в селекторе — отображает один label, но передаёт другой value

**Решение:** Добавить отладку и проверить что `selectedTimezone` действительно соответствует выбранной таймзоне. Возможно, нужно сбросить localStorage.

---

### 5. Не работают клики на плашки статистики как фильтры
**Сравнение:**
- `BepaidStatementSummary` — карточки кликабельны, устанавливают `typeFilter`
- `PaymentsStatsPanel` — карточки **статичные**, не поддерживают клики

**Решение:** Добавить в `PaymentsStatsPanel`:
1. Props `activeFilter` и `onFilterChange`
2. Обработчик кликов на каждую карточку
3. Визуальное выделение активной карточки (ring)
4. Интеграция фильтра в `PaymentsTabContent`

---

### 6. Чёрный дизайн плашек — нужно сделать стеклянными/прозрачными
**Текущий стиль в PaymentsStatsPanel:**
```
bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/70
```

**Новый стиль (стеклянный/прозрачный):**
```
bg-gradient-to-br from-slate-500/10 to-slate-600/5 
border-slate-500/20
backdrop-blur-xl
```

Аналогично стилю в `BepaidStatementSummary`.

---

## Порядок изменений

### 1. Edge Function: Исправить логику INSERT vs UPDATE
**Файл:** `supabase/functions/sync-payments-with-statement/index.ts`

```typescript
// Заменить upsert() на явную проверку + insert/update

// При action='create':
// 1. Сначала проверить существование по UID в ЛЮБОМ origin
const { data: existing } = await supabaseAdmin
  .from('payments_v2')
  .select('id, origin')
  .eq('provider', 'bepaid')
  .eq('provider_payment_id', change.uid)
  .maybeSingle();

if (existing) {
  // Запись уже существует — выполнить UPDATE
  const { error: updateError } = await supabaseAdmin
    .from('payments_v2')
    .update({ ... })
    .eq('id', existing.id);
  stats.applied++;
  continue;
}

// 2. Иначе INSERT
const { error: insertError } = await supabaseAdmin
  .from('payments_v2')
  .insert({ ... });
```

### 2. Edge Function: Расширить поиск для определения create vs update
**Файл:** `supabase/functions/sync-payments-with-statement/index.ts` (строки 447-458)

```typescript
// Загружать ВСЕ payments по UID, не только origin='bepaid'
const { data: payments } = await supabaseAdmin
  .from('payments_v2')
  .select('*, profiles:profile_id(id, full_name, email)')
  .eq('provider', 'bepaid')
  // Убрать: .eq('origin', 'bepaid')
  .gte('paid_at', `${from_date}T00:00:00`)
  .lte('paid_at', `${to_date}T23:59:59`);
```

### 3. UI: Добавить кликабельные фильтры в PaymentsStatsPanel
**Файл:** `src/components/admin/payments/PaymentsStatsPanel.tsx`

1. Добавить новые props:
```typescript
interface PaymentsStatsPanelProps {
  // ... existing
  activeFilter?: 'successful' | 'refunded' | 'cancelled' | 'failed' | null;
  onFilterChange?: (filter: 'successful' | 'refunded' | 'cancelled' | 'failed' | null) => void;
}
```

2. Сделать StatCard кликабельным:
```typescript
function StatCard({ ..., onClick, isActive, isClickable = true }: StatCardProps) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "...",
        isClickable && "cursor-pointer hover:scale-[1.02]",
        isActive && "ring-2 ring-primary"
      )}
    >
```

3. Интегрировать в PaymentsTabContent с новым состоянием `statsFilter`.

### 4. UI: Обновить дизайн карточек на стеклянный
**Файл:** `src/components/admin/payments/PaymentsStatsPanel.tsx`

Заменить тёмный gradient на светлый стеклянный:
```typescript
// Было:
"bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/70"

// Станет:
"bg-gradient-to-br from-slate-500/10 to-slate-600/5 backdrop-blur-xl border-slate-500/20"
```

Аналогично цветам в BepaidStatementSummary.

### 5. UI: Исправить TimezonеSelector (проверка)
**Файл:** `src/components/admin/payments/PaymentsTabContent.tsx`

Добавить отладочный console.log:
```typescript
const handleTimezoneChange = (tz: string) => {
  console.log('[TZ] Changing timezone to:', tz);
  setSelectedTimezone(tz);
  persistTimezone(tz);
};
```

Если проблема в localStorage, предложить кнопку "Сбросить настройки".

---

## Технические детали

### Partial Unique Index в PostgreSQL

Индекс `uq_payments_v2_provider_payment`:
```sql
CREATE UNIQUE INDEX ... ON payments_v2 (provider, provider_payment_id) 
WHERE provider_payment_id IS NOT NULL
```

Supabase JS `.upsert({ ... }, { onConflict: 'provider,provider_payment_id' })` ожидает **constraint**, а не partial index. Поэтому возникает ошибка.

### Статистика транзакций

| Источник | Количество |
|----------|-----------|
| bepaid_statement_rows | 682 |
| payments_v2 (origin=bepaid) | 486 |
| payments_v2 (origin=statement_sync) | 203 |
| payments_v2 (ВСЕГО) | 689 |
| Дубликаты (UID в обоих origins) | ~7 |

---

## DoD (Definition of Done)

- [ ] Ошибки "ON CONFLICT" устранены (0 ошибок при синхронизации)
- [ ] Количество транзакций совпадает с выпиской (682)
- [ ] Клики на карточки статистики работают как фильтры
- [ ] Дизайн карточек — стеклянный/прозрачный (не чёрный)
- [ ] Таймзона отображается корректно (Минск = UTC+3)
- [ ] Автосвязывание работает для известных карт
