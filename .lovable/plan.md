
# PATCH: Сверка платежей bePaid + Улучшение UI (Финальная версия)

## Актуальное состояние (факт на 26.01.2026)

### Эталон bePaid (01.01-25.01.2026)
| Категория | Количество | Сумма BYN | Комиссия BYN |
|-----------|------------|-----------|--------------|
| Платеж Успешный | **388** | **51,973.13** | 1,061.78 |
| Платеж Неуспешный | 152 | 22,792.00 | 0 |
| Возврат средств | 19 | 2,585.00 | 63.28 |
| Отмена | 81 | 628.00 | 0 |
| **ИТОГО** | **640** | | **1,125.06** |

### Текущее состояние БД (payments_v2)
| Категория | Количество | Сумма BYN |
|-----------|------------|-----------|
| Успешные (succeeded, payment, >0) | 328 | 45,846.13 |
| Неуспешные (failed) | 87 | 15,561.00 |
| Возвраты (refund/refunded) | 28 | 2,169.00 |
| Отмены (void/canceled) | 16 | 414.00 |
| **ИТОГО** | **464** | |

### Разрыв к цели
| Метрика | Факт | Цель | Дельта |
|---------|------|------|--------|
| Всего транзакций | 464 | 640 | **-176** |
| Успешных платежей | 328 | 388 | **-60** |
| Сумма успешных | 45,846.13 | 51,973.13 | **-6,127 BYN** |

---

## Причины расхождения (анализ)

### 1. Не материализованные записи из очереди

В `payment_reconcile_queue` есть **168 уникальных UID**, которых нет в `payments_v2`:

| status_normalized | Отсутствуют в БД | Уже есть в БД |
|-------------------|------------------|---------------|
| succeeded | 71 | 0 |
| canceled | 56 | 0 |
| failed | 40 | 28 |
| refunded | 1 | 0 |
| **Итого** | **168** | 91 (дубли) |

**После материализации:** 464 + 168 = **632 транзакции**

### 2. Остаток: 8 транзакций

`640 - 632 = 8` транзакций отсутствуют и в БД, и в очереди → нужно импортировать напрямую из файла bePaid.

### 3. Транзакции без UID

Найдено **2 записи** в `payments_v2` без `provider_payment_id`:
- `32012a14-...`: 100 BYN, succeeded, без profile
- `caf2d8ed-...`: 250 BYN, succeeded, без profile

Эти записи нужно либо связать с UID из bePaid, либо удалить как дубли.

### 4. Дубли в очереди

91 запись в очереди уже имеет соответствующую запись в `payments_v2` — это нормально (ранее материализованы), их можно пометить как `processed`.

---

## План выполнения

### Блок 1: Улучшение UI статистической панели (iOS Glass Morphism)

**Файл:** `src/components/admin/payments/PaymentsStatsPanel.tsx`

**Изменения:**
1. Более выраженный стеклянный эффект с `backdrop-blur-2xl`
2. Внутреннее свечение (shine gradient)
3. Тонкая анимация hover с `scale` и `glow`
4. Улучшенная типографика:
   - Суммы крупнее (2xl → 3xl)
   - Акцентные цвета насыщеннее
5. Добавить `group-hover:shadow-lg` для интерактивности

```tsx
// Новый дизайн StatCard
<div className="group relative overflow-hidden rounded-2xl transition-all duration-300 hover:scale-[1.02]">
  {/* Outer glow on hover */}
  <div className="absolute -inset-0.5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-sm bg-emerald-500/20" />
  
  {/* Main card */}
  <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/70 dark:bg-black/40 backdrop-blur-2xl p-5 shadow-lg">
    {/* Inner shine gradient */}
    <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-transparent pointer-events-none" />
    
    {/* Content */}
    <div className="relative z-10">...</div>
  </div>
</div>
```

---

### Блок 2: Улучшение UI выбора таймзоны

**Проблема:** Текущий toggle "My TZ / UTC / Provider" неинформативен и плохо выглядит.

**Решение:** Заменить на компактный Select с IANA таймзонами.

**Файл:** `src/components/admin/payments/PaymentsTabContent.tsx`

**Новый компонент:** `TimezoneSelector.tsx`

```tsx
// Популярные таймзоны для выбора
const COMMON_TIMEZONES = [
  { value: 'Europe/Minsk', label: 'Минск (UTC+3)', short: 'MSK' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)', short: 'MSK' },
  { value: 'Europe/Warsaw', label: 'Варшава (UTC+1)', short: 'CET' },
  { value: 'Europe/London', label: 'Лондон (UTC+0)', short: 'GMT' },
  { value: 'UTC', label: 'UTC', short: 'UTC' },
  { value: 'Europe/Paris', label: 'Париж (UTC+1)', short: 'CET' },
  { value: 'Africa/Cairo', label: 'Каир (UTC+2)', short: 'EET' },
  // ... больше зон
];

// UI: компактный Select рядом с фильтрами
<Select value={selectedTimezone} onValueChange={setSelectedTimezone}>
  <SelectTrigger className="w-[140px] h-8">
    <Clock className="h-3 w-3 mr-1" />
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {COMMON_TIMEZONES.map(tz => (
      <SelectItem key={tz.value} value={tz.value}>
        {tz.label}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

**Интеграция:**
- Заменить `ToggleGroup` на `Select` с таймзонами
- Сохранять выбор в `localStorage` для персистентности
- По умолчанию: `Europe/Minsk` (время провайдера bePaid)

---

### Блок 3: Материализация 168 недостающих транзакций

**Функция:** `admin-materialize-queue-payments`

**Проблема:** Функция работает только со статусом `completed` в очереди, а у нас записи в статусе `pending`.

**Решение:**
1. Обновить записи в очереди: `pending` → `completed` для тех, у кого есть `bepaid_uid`
2. Запустить материализацию

**SQL для подготовки:**
```sql
-- Перевести pending записи с UID в completed для материализации
UPDATE payment_reconcile_queue
SET status = 'completed'
WHERE paid_at >= '2026-01-01' AND paid_at < '2026-01-26'
  AND status = 'pending'
  AND bepaid_uid IS NOT NULL;
```

**Вызов Edge Function:**
```json
{
  "dry_run": false,
  "from_date": "2026-01-01",
  "to_date": "2026-01-26",
  "limit": 200
}
```

**Ожидаемый результат:** +168 транзакций → 632 в БД

---

### Блок 4: Импорт 8 недостающих транзакций из файла bePaid

После материализации 168 записей останется разрыв в 8 транзакций.

**Действия:**
1. Запустить `bepaid-reconcile-file` с файлом bePaid
2. Получить список `missing_in_db` (8 UID)
3. Импортировать их через существующий механизм импорта

**Ожидаемый результат:** 632 + 8 = **640 транзакций**

---

### Блок 5: Исправление 2 транзакций без UID

| ID | Сумма | Действие |
|----|-------|----------|
| `32012a14-...` | 100 BYN | Найти в bePaid по сумме/дате или удалить |
| `caf2d8ed-...` | 250 BYN | Найти в bePaid по сумме/дате или удалить |

**Метод:**
1. Сопоставить с файлом bePaid по (сумма + дата + email/карта)
2. Если найдено соответствие — обновить `provider_payment_id`
3. Если не найдено — удалить как дубли

---

### Блок 6: Инструменты администратора (русификация)

**Файл:** `src/components/admin/payments/AdminToolsMenu.tsx` (создать)

**Переименование инструментов:**

| Текущее название | Новое название | Описание |
|------------------|----------------|----------|
| Fix False Payments | Исправить ошибочные платежи | Исправляет транзакции, которые отмечены успешными, но failed в bePaid |
| Fix Payments Integrity | Проверить целостность данных | Находит несоответствия сумм между платежами и сделками |
| Backfill 2026 Orders | Связать платежи со сделками | Создаёт сделки для "сиротских" платежей 2026 года |

**UI: Меню-шестерёнка**

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon">
      <Settings className="h-4 w-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="w-64">
    <DropdownMenuLabel>Инструменты обслуживания</DropdownMenuLabel>
    <DropdownMenuSeparator />
    
    <DropdownMenuItem onClick={() => setFixFalsePaymentsOpen(true)}>
      <Wrench className="h-4 w-4 mr-2" />
      <div className="flex flex-col">
        <span>Исправить ошибочные платежи</span>
        <span className="text-xs text-muted-foreground">DRY-RUN по умолчанию</span>
      </div>
    </DropdownMenuItem>
    
    <DropdownMenuItem onClick={() => setIntegrityCheckOpen(true)}>
      <CheckCircle className="h-4 w-4 mr-2" />
      Проверить целостность данных
    </DropdownMenuItem>
    
    <DropdownMenuItem onClick={() => setBackfillOrdersOpen(true)}>
      <Link className="h-4 w-4 mr-2" />
      Связать платежи со сделками
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

### Блок 7: Edge Function admin-fix-false-payments — UI интеграция

**Функция существует**, но нет UI для вызова.

**Создать:** `src/components/admin/payments/FalsePaymentsFixDialog.tsx`

```tsx
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Диалог с:
// 1. Текстовым полем для ввода UID (один на строку)
// 2. Кнопка "Проверить (DRY-RUN)"
// 3. Отображение результатов: какие платежи найдены, что будет изменено
// 4. Кнопка "Выполнить" с подтверждением

// Важно: DRY-RUN по умолчанию!
// Показывать предупреждение, что доступы могут быть отозваны
```

---

## Порядок выполнения

| # | Действие | Файлы | Результат |
|---|----------|-------|-----------|
| 1 | Улучшить дизайн PaymentsStatsPanel (iOS Glass) | `PaymentsStatsPanel.tsx` | Красивая панель статистики |
| 2 | Заменить TZ toggle на Select | `PaymentsTabContent.tsx`, `TimezoneSelector.tsx` | Выбор таймзоны IANA |
| 3 | Создать меню инструментов (шестерёнка) | `AdminToolsMenu.tsx` | Русские названия, единая точка входа |
| 4 | Создать UI для admin-fix-false-payments | `FalsePaymentsFixDialog.tsx` | DRY-RUN + EXECUTE |
| 5 | SQL: перевести pending → completed | Миграция | Подготовка к материализации |
| 6 | Материализовать 168 транзакций | Вызов Edge Function | 632 в БД |
| 7 | Импортировать 8 недостающих | Через импорт | 640 в БД |
| 8 | Исправить 2 транзакции без UID | SQL / UI | Все записи с UID |

---

## Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `src/components/admin/payments/PaymentsStatsPanel.tsx` | EDIT — iOS Glass дизайн |
| `src/components/admin/payments/PaymentsTabContent.tsx` | EDIT — заменить TZ toggle на Select |
| `src/components/admin/payments/TimezoneSelector.tsx` | CREATE — компонент выбора таймзоны |
| `src/components/admin/payments/AdminToolsMenu.tsx` | CREATE — меню инструментов |
| `src/components/admin/payments/FalsePaymentsFixDialog.tsx` | CREATE — UI для исправления платежей |

---

## DoD (Definition of Done)

### После UI изменений:
- [ ] Панель статистики в стиле iOS Glass Morphism
- [ ] Выбор таймзоны через Select с IANA зонами
- [ ] Время в таблице меняется при смене TZ
- [ ] Инструменты под шестерёнкой с русскими названиями

### После данных:
```sql
-- 1) Всего = 640
SELECT COUNT(*) FROM payments_v2
WHERE provider = 'bepaid' AND paid_at >= '2026-01-01' AND paid_at < '2026-01-26';

-- 2) Успешные = 388, сумма = 51,973.13
SELECT COUNT(*), ROUND(SUM(amount)::numeric, 2)
FROM payments_v2
WHERE provider = 'bepaid' 
  AND paid_at >= '2026-01-01' AND paid_at < '2026-01-26'
  AND status = 'succeeded' AND transaction_type = 'payment' AND amount > 0;

-- 3) Нет транзакций без UID
SELECT COUNT(*) FROM payments_v2
WHERE provider = 'bepaid' 
  AND paid_at >= '2026-01-01' AND paid_at < '2026-01-26'
  AND (provider_payment_id IS NULL OR provider_payment_id = '');
-- Ожидаемо: 0
```

---

## Техническая деталь: Почему material-materialize не работает

Функция `admin-materialize-queue-payments` обрабатывает только записи со статусом `completed`:

```typescript
// Строка 116-119 в admin-materialize-queue-payments
let query = supabase
  .from('payment_reconcile_queue')
  .select('*')
  .eq('status', 'completed')  // ← ТОЛЬКО completed!
```

А в очереди записи имеют статус `pending`. Поэтому нужно сначала обновить статус через SQL миграцию.
