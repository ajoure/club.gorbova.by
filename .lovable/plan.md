
# СПРИНТ PAYMENTS: Полная сверка bePaid + Улучшение UI

## Текущее состояние базы данных (01-25 января 2026, Europe/Minsk)

### Фактические цифры:
| Источник | Уникальных UID | Строк | Статус |
|----------|----------------|-------|--------|
| payments_v2 | **462** | 464 | 2 дубля по UID |
| payment_reconcile_queue | **253** | 253 | 162 НЕТ в payments_v2 |
| **Unified (теоретически)** | **624** | | 462 + 162 |
| **Эталон bePaid** | **640** | | ЦЕЛЬ |
| **Разрыв** | **-16** | | Нужно найти |

### Проблемы, выявленные в базе:
1. **2 платежа без UID** (provider_payment_id = NULL):
   - `32012a14-...`: 100 BYN, succeeded
   - `caf2d8ed-...`: 250 BYN, succeeded
2. **162 UID в очереди** не материализованы в payments_v2
3. **16 UID** отсутствуют полностью (ни в payments_v2, ни в queue)

---

## PATCH-1: Staging таблица (statement_lines)

**Статус:** Таблица `statement_lines` уже существует с нужной структурой.

**Текущие поля:**
- `provider`, `stable_key` (UNIQUE)
- `raw_data` (JSONB)
- `parsed_amount`, `parsed_currency`, `parsed_status`, `parsed_paid_at`
- `transaction_type`, `card_last4`, `customer_email`
- `source`, `source_timezone`
- `payment_id`, `order_id` (FK для связи после материализации)

**Доработка:** Добавить поле `provider_payment_id` для хранения UID из bePaid напрямую, чтобы не парсить из stable_key.

---

## PATCH-2 + PATCH-3: Диалог "Сверка с эталоном bePaid"

### Новый компонент: `ReconcileFileDialog.tsx`

**Функционал:**
1. **Загрузка файла** (CSV/XLSX) с транзакциями bePaid
2. **Парсинг** каждой строки и извлечение UID
3. **Сверка** с unified view (payments_v2 + queue)
4. **Полный отчёт** без лимита 50:
   - Matched (UID + amount + status совпадают)
   - Missing (в файле есть, в базе нет)
   - Mismatch (UID есть, но разные amount/status/paid_at)
   - Extra (в базе есть, в файле нет)
5. **Кнопка EXECUTE** (после DRY-RUN):
   - Missing: upsert в payments_v2, создать order при необходимости
   - Mismatch: обновить amount/status в payments_v2
   - Extra: пометить `integrity_status='suspect_extra'`

**UI диалога:**
```text
┌─────────────────────────────────────────────────────────────────────────┐
│  Сверка с эталоном bePaid                                         [X]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. ЗАГРУЗКА ФАЙЛА                                                      │
│     [Выбрать файл]  transactions_jan_2026.xlsx                          │
│     Найдено: 640 транзакций                                             │
│                                                                         │
│  2. ПЕРИОД СВЕРКИ                                                       │
│     С: [01.01.2026]  По: [25.01.2026]  TZ: [Europe/Minsk v]            │
│                                                                         │
│  3. РЕЗУЛЬТАТ СВЕРКИ                                                    │
│     ┌────────────┬──────────┬────────────────┬─────────────────────┐   │
│     │ Категория  │ Кол-во   │ Сумма BYN      │ Действие            │   │
│     ├────────────┼──────────┼────────────────┼─────────────────────┤   │
│     │ Matched    │ 608      │ 49,123.13      │ Без изменений       │   │
│     │ Missing    │ 16       │ 2,850.00       │ Добавить            │   │
│     │ Mismatch   │ 12       │ 1,200.00       │ Исправить           │   │
│     │ Extra      │ 4        │ 350.00         │ Пометить            │   │
│     └────────────┴──────────┴────────────────┴─────────────────────┘   │
│                                                                         │
│  4. ДЕТАЛИ (раскрываемые секции)                                        │
│     ▼ Missing (16)                                                      │
│       • abc123... | 250 BYN | Успешный | 15.01.2026                    │
│       • def456... | 100 BYN | Неуспешный | 20.01.2026                  │
│       ...                                                               │
│                                                                         │
│     ▼ Mismatch (12)                                                     │
│       • xyz789... | Файл: 250 BYN | БД: 200 BYN | Δ50                   │
│       ...                                                               │
│                                                                         │
│  [Скачать отчёт CSV]                                                    │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  whoami: 1@ajoure.by | super_admin                                      │
│                                                                         │
│  [Запустить сверку (DRY-RUN)]        [Применить исправления (EXECUTE)]  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Обновление Edge Function: `bepaid-reconcile-file`

**Изменения:**
1. Добавить параметр `include_queue: true` для сверки с unified view
2. Убрать лимит `.slice(0, 50)` — возвращать полный список
3. Добавить проверку hasValidAccess() перед отзывом доступов
4. Записывать `reconcile_run_id` в audit_logs

---

## PATCH-4: UID-only дедупликация

### Инварианты:
1. `provider_payment_id` = единственный stable UID
2. `tracking_id` НЕ использовать как ключ
3. UNIQUE constraint на `(provider, provider_payment_id)`

### Действия:
1. Проверить наличие UNIQUE constraint
2. Найти и исправить 2 записи без UID
3. Создать RPC `get_payment_duplicates` если отсутствует

---

## PATCH-5: Улучшение дизайна статистических карточек

### Проблемы текущего дизайна (по скриншоту):
1. Текст "BYN" обрезается на некоторых карточках
2. Недостаточно воздушный/стеклянный эффект
3. Карточки слишком плотные

### Новый дизайн iOS Glass Morphism:

```tsx
function StatCard({ title, amount, count, icon, colorClass, glowColor, currency = "BYN", subtitle }) {
  return (
    <div className="group relative overflow-hidden rounded-3xl transition-all duration-500 hover:scale-[1.03] hover:-translate-y-1">
      {/* Outer glow on hover - larger and softer */}
      <div className={`absolute -inset-1 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl ${glowColor}`} />
      
      {/* Main card - more glass effect */}
      <div className="relative overflow-hidden rounded-3xl border border-white/30 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur-3xl p-6 shadow-2xl shadow-black/5 dark:shadow-black/30">
        
        {/* Inner shine gradient - stronger */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/60 via-white/20 to-transparent dark:from-white/15 dark:via-white/5 pointer-events-none" />
        
        {/* Top edge highlight */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/30" />
        
        {/* Left edge highlight */}
        <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-white/60 via-transparent to-transparent dark:from-white/20" />
        
        {/* Content */}
        <div className="relative z-10 flex flex-col gap-3">
          {/* Header with icon */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-[0.2em]">
              {title}
            </p>
            <div className={`p-2.5 rounded-2xl bg-gradient-to-br ${glowColor.replace('/20', '/10')} backdrop-blur-xl border border-white/30 dark:border-white/10 shadow-lg`}>
              {icon}
            </div>
          </div>
          
          {/* Amount - larger, breathing room */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-3xl font-bold tracking-tight tabular-nums ${colorClass}`}>
              {amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-sm font-semibold text-muted-foreground/60">
              {currency}
            </span>
          </div>
          
          {/* Count and subtitle */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
            <span className="font-semibold tabular-nums">{count.toLocaleString('ru-RU')} шт</span>
            {subtitle && (
              <>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>{subtitle}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### Ключевые изменения:
- `rounded-3xl` вместо `rounded-2xl` — более мягкие углы
- `backdrop-blur-3xl` — усиленное размытие
- `bg-white/80` — больше прозрачности
- `p-6` вместо `p-5` — больше padding
- `text-3xl` вместо `text-2xl` — крупнее суммы
- `flex-wrap` для amount+currency — не обрезается
- Двойной highlight (top + left edge) — iOS-эффект
- `hover:-translate-y-1` — эффект "всплывания"
- `shadow-2xl` — более глубокая тень

---

## PATCH-6: Инструменты админа

### Добавить в AdminToolsMenu:
1. **"Сверка с эталоном bePaid"** — открывает ReconcileFileDialog
2. Активировать disabled пункты:
   - "Проверить целостность данных"
   - "Связать платежи со сделками"

### UI доработки:
- Добавить `whoami` (email, uid, roles) в каждый диалог
- Адаптивность на мобилке

---

## PATCH-7: Audit + DoD

### Audit logs:
```sql
INSERT INTO audit_logs (action, actor_type, actor_label, meta)
VALUES (
  'payments.reconcile_run',
  'system',
  'bepaid-reconcile-file',
  jsonb_build_object(
    'requested_by_user_id', :user_id,
    'requested_by_email', :email,
    'file_count', 640,
    'matched', 608,
    'missing', 16,
    'mismatch', 12,
    'extra', 4,
    'run_id', :run_id
  )
);
```

### Финальные DoD SQL:
```sql
-- 1) Дублей UID = 0
SELECT provider_payment_id, COUNT(*) 
FROM payments_v2 
WHERE provider = 'bepaid' 
GROUP BY provider_payment_id 
HAVING COUNT(*) > 1;
-- Ожидаемо: пустой результат

-- 2) Orphan payments = 0
SELECT COUNT(*) FROM payments_v2
WHERE provider = 'bepaid'
  AND status = 'succeeded'
  AND profile_id IS NOT NULL
  AND order_id IS NULL
  AND paid_at >= '2025-12-31 21:00:00'
  AND paid_at < '2026-01-25 21:00:00';
-- Ожидаемо: 0

-- 3) Всего = 640
SELECT COUNT(DISTINCT provider_payment_id)
FROM payments_v2
WHERE provider = 'bepaid'
  AND paid_at >= '2025-12-31 21:00:00'
  AND paid_at < '2026-01-25 21:00:00';
-- Ожидаемо: 640
```

---

## Файлы для создания/изменения

| Файл | Действие | Описание |
|------|----------|----------|
| `src/components/admin/payments/PaymentsStatsPanel.tsx` | EDIT | iOS Glass дизайн карточек |
| `src/components/admin/payments/ReconcileFileDialog.tsx` | CREATE | Диалог сверки с файлом |
| `src/components/admin/payments/AdminToolsMenu.tsx` | EDIT | Добавить пункт "Сверка" |
| `supabase/functions/bepaid-reconcile-file/index.ts` | EDIT | Убрать лимит 50, добавить queue |

---

## Порядок выполнения

| # | Действие | Результат |
|---|----------|-----------|
| 1 | Обновить дизайн PaymentsStatsPanel | Красивые iOS Glass карточки |
| 2 | Создать ReconcileFileDialog | UI для загрузки файла и сверки |
| 3 | Добавить пункт в AdminToolsMenu | Доступ к сверке через шестерёнку |
| 4 | Обновить Edge Function | Полные списки без лимита |
| 5 | **Вы загружаете файл bePaid** | Получаем 640 UID |
| 6 | Запускаете DRY-RUN | Видите missing/mismatch/extra |
| 7 | Запускаете EXECUTE | Данные синхронизированы |
| 8 | Проверка DoD SQL | 640 = 640, суммы бьются |

---

## Следующий шаг после одобрения плана

После реализации UI вам нужно будет:
1. Загрузить файл bePaid (640 транзакций)
2. Система покажет точный список missing/mismatch/extra
3. Вы решаете, применять ли исправления
4. После EXECUTE — финальная проверка по DoD SQL
