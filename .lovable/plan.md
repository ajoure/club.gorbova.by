
# План: Исправление системы создания сделок и выдачи доступов

## Обнаруженные проблемы

### Проблема 1: Сделки создаются с датой "сейчас" вместо даты платежа

**Затронутые компоненты:**

| Компонент | Проблема |
|-----------|----------|
| `admin-backfill-2026-orders` | Создаёт заказы без явного `created_at` → устанавливается `now()` |
| `bepaid-auto-process` | Не передаёт `created_at = paidAt` при создании заказа |
| `bepaid-webhook` | Аналогичная проблема — заказы создаются с текущей датой |
| `CreateDealFromPaymentDialog` | Устанавливает `created_at: accessStart.toISOString()` — корректно |

**Влияние:** 55 заказов от 26 января имеют неправильную дату создания, хотя платежи были от 4-25 января.

### Проблема 2: Выдача доступа всегда от текущей даты

**Затронутые компоненты:**

| Компонент | Проблема |
|-----------|----------|
| `grant-access-for-order` | Строка 87: `let accessStartAt = now;` — всегда текущая дата |
| `GrantAccessFromDealDialog` | Использует `now` как начало доступа без привязки к дате платежа/сделки |

**Влияние:** Подписки и entitlements создаются с датой начала "сегодня", игнорируя реальную дату оплаты.

### Проблема 3: Фиксированный срок 30 дней без возможности редактирования

**Затронутые компоненты:**

| Компонент | Проблема |
|-----------|----------|
| `GrantAccessFromDealDialog` | Поле дней редактируемо, но нет выбора даты начала |
| `grant-access-for-order` | Не принимает `accessStartAt` как параметр |

---

## План исправления

### Часть 1: Исправление создания сделок с правильной датой

#### 1.1 Исправить `admin-backfill-2026-orders`

**Файл:** `supabase/functions/admin-backfill-2026-orders/index.ts`

**Изменение:** Добавить `created_at: payment.paid_at` при создании заказа

```typescript
// Строка ~240
const { data: newOrder, error: insertError } = await supabase
  .from('orders_v2')
  .insert({
    // ... существующие поля ...
    created_at: payment.paid_at,  // ДОБАВИТЬ: дата создания = дата платежа
    meta: {
      // ...
    },
  })
```

#### 1.2 Исправить `bepaid-auto-process`

**Файл:** `supabase/functions/bepaid-auto-process/index.ts`

**Изменение:** Добавить `created_at: paidAt` при создании заказа

```typescript
// Строка ~663
const { data: newOrder, error: orderError } = await supabase
  .from('orders_v2')
  .insert({
    // ... существующие поля ...
    created_at: paidAt,  // ДОБАВИТЬ: дата создания = дата платежа
  })
```

#### 1.3 Исправить `bepaid-webhook`

**Файл:** `supabase/functions/bepaid-webhook/index.ts`

**Изменение:** Добавить `created_at: transaction.paid_at || now.toISOString()` при создании заказа

```typescript
// Строка ~2984
const { data: order, error } = await supabase
  .from('orders_v2')
  .insert({
    // ... существующие поля ...
    created_at: transaction.paid_at || now.toISOString(),  // ДОБАВИТЬ
  })
```

---

### Часть 2: Исправление выдачи доступа с правильной датой

#### 2.1 Модифицировать `grant-access-for-order` для приёма даты начала

**Файл:** `supabase/functions/grant-access-for-order/index.ts`

**Изменения:**

1. Добавить новый параметр `customAccessStartAt`
2. Использовать дату из заказа как fallback
3. Сохранить существующую логику продления

```typescript
// Строка ~26-32 — добавить параметр
const { 
  orderId, 
  customAccessDays,
  customAccessStartAt,    // НОВЫЙ: опциональная дата начала
  extendFromCurrent = true,
  grantTelegram = true,
  grantGetcourse = true,
} = await req.json();

// Строка ~85-108 — изменить логику определения даты начала
// Calculate access period
const now = new Date();

// Determine base start date:
// 1. If customAccessStartAt provided — use it
// 2. Otherwise use order.created_at (deal date)
// 3. Fallback to now if nothing available
let baseStartDate = now;
if (customAccessStartAt) {
  baseStartDate = new Date(customAccessStartAt);
} else if (order.created_at) {
  baseStartDate = new Date(order.created_at);
}

// Check for existing active subscription for this product to extend from
let accessStartAt = baseStartDate;
let existingProductSub = null;

if (extendFromCurrent) {
  const { data: activeSub } = await supabase
    .from("subscriptions_v2")
    .select("id, access_end_at, status, tariff_id, auto_renew")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .eq("status", "active")
    .order("access_end_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (activeSub?.access_end_at && new Date(activeSub.access_end_at) > now) {
    // Extend from end of current access
    accessStartAt = new Date(activeSub.access_end_at);
    existingProductSub = activeSub;
    console.log(`Extending from existing access end: ${activeSub.access_end_at}`);
  }
}
```

---

### Часть 3: Улучшение UI для полного контроля администратора

#### 3.1 Улучшить `GrantAccessFromDealDialog`

**Файл:** `src/components/admin/GrantAccessFromDealDialog.tsx`

**Изменения:**

1. Добавить выбор даты начала доступа (Calendar)
2. Использовать дату сделки как значение по умолчанию
3. Передавать `customAccessStartAt` в `grant-access-for-order`

```tsx
// Новые состояния
const [customStartDate, setCustomStartDate] = useState<Date | null>(null);

// Дефолтное значение — дата создания сделки
useEffect(() => {
  if (deal.created_at) {
    setCustomStartDate(new Date(deal.created_at));
  }
}, [deal.created_at]);

// В calculation useMemo — использовать customStartDate
const calculation = useMemo(() => {
  // Базовая дата — либо customStartDate, либо сейчас
  const baseDate = customStartDate || new Date();
  // ... остальная логика
}, [customStartDate, accessDays, ...]);

// В UI — добавить поле выбора даты
<div className="space-y-2">
  <Label>Дата начала доступа</Label>
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" className="w-full justify-start text-left">
        <CalendarIcon className="mr-2 h-4 w-4" />
        {customStartDate ? format(customStartDate, "dd.MM.yyyy") : "Выберите дату"}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0">
      <Calendar
        mode="single"
        selected={customStartDate}
        onSelect={setCustomStartDate}
        locale={ru}
      />
    </PopoverContent>
  </Popover>
</div>

// В mutation — передавать customAccessStartAt
const { data, error } = await supabase.functions.invoke("grant-access-for-order", {
  body: {
    orderId: deal.id,
    customAccessDays: customDays,
    customAccessStartAt: customStartDate?.toISOString(),  // НОВОЕ
    extendFromCurrent,
    grantTelegram,
    grantGetcourse,
  },
});
```

#### 3.2 Расширить `deal.created_at` в пропсах

**Файл:** `src/components/admin/DealDetailSheet.tsx`

Добавить `created_at` в объект `deal`, передаваемый в `GrantAccessFromDealDialog`:

```tsx
<GrantAccessFromDealDialog
  deal={{
    ...deal,
    created_at: deal.created_at,  // Добавить если отсутствует
  }}
  // ...
/>
```

---

### Часть 4: Инструмент исправления исторических данных

#### 4.1 SQL-скрипт для исправления сделок от 26 января

```sql
-- DRY RUN: Показать какие сделки будут исправлены
SELECT 
  o.id,
  o.order_number,
  o.created_at as current_created_at,
  p.paid_at as correct_date,
  o.meta->>'source' as source
FROM orders_v2 o
JOIN payments_v2 p ON p.order_id = o.id
WHERE DATE(o.created_at) = '2026-01-26'
  AND o.meta->>'source' = 'admin-backfill-2026-orders'
  AND p.paid_at < '2026-01-26'
ORDER BY p.paid_at;

-- EXECUTE: Исправить даты
UPDATE orders_v2 o
SET created_at = p.paid_at
FROM payments_v2 p
WHERE p.order_id = o.id
  AND DATE(o.created_at) = '2026-01-26'
  AND o.meta->>'source' = 'admin-backfill-2026-orders'
  AND p.paid_at < '2026-01-26';
```

#### 4.2 SQL-скрипт для исправления подписок с неправильными датами

```sql
-- DRY RUN: Показать подписки с access_start_at = 26.01
SELECT 
  s.id,
  s.access_start_at,
  s.access_end_at,
  o.created_at as order_created,
  p.paid_at as payment_date
FROM subscriptions_v2 s
JOIN orders_v2 o ON o.id = s.order_id
LEFT JOIN payments_v2 p ON p.order_id = o.id
WHERE DATE(s.access_start_at) = '2026-01-26'
  AND p.paid_at < '2026-01-26';

-- EXECUTE: Пересчитать access_start_at и access_end_at
UPDATE subscriptions_v2 s
SET 
  access_start_at = p.paid_at,
  access_end_at = p.paid_at + (s.access_end_at - s.access_start_at)
FROM payments_v2 p
WHERE p.order_id = s.order_id
  AND DATE(s.access_start_at) = '2026-01-26'
  AND p.paid_at < '2026-01-26';
```

---

## Файлы для изменения

| Файл | Тип изменения |
|------|---------------|
| `supabase/functions/admin-backfill-2026-orders/index.ts` | Добавить `created_at: payment.paid_at` |
| `supabase/functions/bepaid-auto-process/index.ts` | Добавить `created_at: paidAt` |
| `supabase/functions/bepaid-webhook/index.ts` | Добавить `created_at: transaction.paid_at` |
| `supabase/functions/grant-access-for-order/index.ts` | Добавить параметр `customAccessStartAt`, использовать `order.created_at` как fallback |
| `src/components/admin/GrantAccessFromDealDialog.tsx` | Добавить выбор даты начала, передавать её в API |
| `src/components/admin/DealDetailSheet.tsx` | Передавать `created_at` в пропсы диалога |

---

## Результат

1. **Новые сделки** — автоматически создаются с датой платежа
2. **Выдача доступа** — начинается от даты сделки (или выбранной администратором)
3. **Полный контроль** — администратор может изменить дату начала, количество дней
4. **Исторические данные** — можно исправить SQL-скриптами

---

## Технические детали

### Приоритет даты начала доступа

```
1. customAccessStartAt (от администратора)
   ↓ если не указано
2. order.created_at (дата сделки)
   ↓ если не указано
3. now() (текущая дата)
```

### Логика продления подписок

```
Если extendFromCurrent = true И есть активная подписка:
  accessStartAt = access_end_at активной подписки
  
Иначе:
  accessStartAt = дата из приоритета выше
```

### Валидация в UI

- Нельзя выдать доступ ghost-контактам (без user_id)
- Нельзя выдать доступ, если срок истёк (end_date < now)
- Предупреждение если дата начала в прошлом
