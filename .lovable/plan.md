

# План: Исправление System Health + Healthcheck Dashboard + Audit Log

## Диагностика (что найдено)

### 1. Почему "Здоровье системы" показывает 0/0 проверок

**Root Cause подтверждён логами:**
```
[NIGHTLY] Completed in 1201ms. Status: completed. Passed: 0/0
POST | 404 | .../functions/v1/nightly-payments-invariants
```

**Функция `nightly-payments-invariants` НЕ ЗАДЕПЛОЕНА на production**, хотя:
- Папка `supabase/functions/nightly-payments-invariants/` существует
- Код на 493 строки полностью готов
- Функция `nightly-system-health` вызывает её через `supabase.functions.invoke()`
- Получает 404 → возвращает пустой `invariants: []` → summary `0/0`

### 2. Ошибка telegram-webhook с bot_id

**В логах Edge Functions:**
```
Bot not found for id: 6a924080-7aa3-4f9b-9459-ab453b67f700
```

**В базе данных:**
- Единственный активный бот: `id: 1a560e98-574e-4fd9-82ab-4b7bbdc300b4` (@gorbovabybot)
- Bot ID `6a924080-...` **не существует** в таблице `telegram_bots`

**Причина:** Telegram webhook URL сконфигурирован с устаревшим/несуществующим `bot_id` в query string:
```
/functions/v1/telegram-webhook?bot_id=6a924080-7aa3-4f9b-9459-ab453b67f700
```

### 3. Отсутствует Healthcheck Dashboard для TIER-1 функций

Текущая страница `/admin/system-health` отображает только бизнес-инварианты (INV-1...INV-15), но **не проверяет доступность критических Edge Functions в реальном времени**.

### 4. Таблица audit_logs уже существует

Структура:
- `id`, `actor_user_id`, `action`, `target_user_id`, `meta`, `created_at`, `actor_type`, `actor_label`

---

## Шаги реализации

### STEP 1: Deploy `nightly-payments-invariants` (CRITICAL)

**Действие:** Задеплоить функцию `nightly-payments-invariants` через Lovable deploy

**DoD:**
- `curl POST .../nightly-payments-invariants` → НЕ 404
- После нажатия "Запустить проверку" в UI → summary показывает `15/15` или аналогичное (не `0/0`)

### STEP 2: Добавить `nightly-payments-invariants` и `nightly-system-health` в CI Smoke Checks

**Файл:** `.github/workflows/deploy-functions.yml`

**Изменения:**
```yaml
TIER1_FUNCTIONS=(
  # Существующие...
  "payment-method-verify-recurring"
  "bepaid-list-subscriptions"
  "bepaid-get-subscription-details"
  "bepaid-create-token"
  "admin-payments-diagnostics"
  "integration-healthcheck"
  # ДОБАВИТЬ:
  "nightly-system-health"
  "nightly-payments-invariants"
)
```

**DoD:** CI smoke-check проверяет обе функции и падает при 404.

### STEP 3: Исправить telegram-webhook bot_id

**Варианты решения:**

**Вариант A (Рекомендуется):** Перерегистрировать webhook на правильный bot_id
```bash
# Из Telegram API (один раз вручную или через edge function)
curl -X POST "https://api.telegram.org/bot{BOT_TOKEN}/setWebhook" \
  -d "url=https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/telegram-webhook?bot_id=1a560e98-574e-4fd9-82ab-4b7bbdc300b4"
```

**Вариант B:** Проверить, нужен ли старый bot_id, и либо создать запись в `telegram_bots`, либо удалить webhook

**DoD:** Логи `telegram-webhook` не содержат "Bot not found".

### STEP 4: Добавить вкладку "Edge Functions Health" в /admin/system-health

**Новые файлы:**
- `src/components/admin/system-health/EdgeFunctionsHealth.tsx`
- `src/hooks/useEdgeFunctionsHealth.ts`

**Функциональность:**

1. **Список TIER-1 функций с реалтайм-проверкой:**
   - `payment-method-verify-recurring`
   - `bepaid-list-subscriptions`
   - `bepaid-get-subscription-details`
   - `bepaid-create-token`
   - `admin-payments-diagnostics`
   - `integration-healthcheck`
   - `nightly-system-health`
   - `nightly-payments-invariants`
   - `telegram-webhook`
   - `telegram-admin-chat`

2. **Для каждой функции:**
   - Статус: ✅ Reachable / ❌ NOT_FOUND / ⚠️ Error
   - Latency (ms)
   - Last check timestamp
   - Кнопка "Проверить" для индивидуальной проверки

3. **Кнопка "Проверить все":**
   - Параллельно вызывает OPTIONS для всех функций
   - Группирует результаты по статусу

**Изменения в существующих файлах:**
- `src/pages/admin/AdminSystemHealth.tsx` — добавить вкладку "Edge Functions"

### STEP 5: Улучшить audit_logs usage tracking

**Добавить action types для отслеживания:**
- `edge_function.deploy` — запись о деплое функции (из CI)
- `edge_function.health_check` — результат healthcheck
- `admin.config_change` — изменения конфигурации

**Миграция не требуется** — таблица уже существует с нужной структурой.

**Добавить UI компонент:**
- `src/components/admin/system-health/AuditLogViewer.tsx`
- Фильтр по action type
- Показывать последние 50 записей с пагинацией

---

## Структура файлов

```text
src/
├── hooks/
│   └── useEdgeFunctionsHealth.ts        # NEW: хук для проверки функций
├── components/admin/system-health/
│   ├── EdgeFunctionsHealth.tsx          # NEW: компонент healthcheck
│   ├── AuditLogViewer.tsx               # NEW: просмотр audit логов
│   ├── SystemHealthOverview.tsx         # существующий
│   ├── InvariantCheckCard.tsx           # существующий
│   └── HealthRunHistory.tsx             # существующий
└── pages/admin/
    └── AdminSystemHealth.tsx            # MODIFY: добавить вкладки

.github/workflows/
└── deploy-functions.yml                 # MODIFY: добавить nightly-* в TIER-1
```

---

## Технические детали

### useEdgeFunctionsHealth.ts

```typescript
const TIER1_FUNCTIONS = [
  { name: 'payment-method-verify-recurring', category: 'payments' },
  { name: 'bepaid-list-subscriptions', category: 'payments' },
  { name: 'nightly-system-health', category: 'system' },
  { name: 'nightly-payments-invariants', category: 'system' },
  { name: 'telegram-webhook', category: 'telegram' },
  // ...
];

// Проверка через OPTIONS (не требует auth)
async function checkFunction(name: string): Promise<{
  status: 'ok' | 'not_found' | 'error';
  latency: number;
  error?: string;
}>;
```

### EdgeFunctionsHealth.tsx

- Таблица с колонками: Функция | Категория | Статус | Latency | Последняя проверка
- Автообновление каждые 60 секунд (опционально)
- Группировка по категориям (payments, telegram, system)

---

## DoD (Доказательства выполнения)

| Проверка | Ожидаемый результат |
|----------|---------------------|
| UI "Здоровье системы" после нажатия "Запустить проверку" | Summary показывает 15/X проверок (не 0/0) |
| Вкладка "Edge Functions" | Все TIER-1 функции показывают ✅ Reachable |
| `nightly-payments-invariants` curl | HTTP 200/401 (не 404) |
| Логи `telegram-webhook` | Нет "Bot not found" ошибок |
| CI smoke-checks | Включают `nightly-system-health` и `nightly-payments-invariants` |

---

## Приоритет

1. **P0 (Blocker):** Deploy `nightly-payments-invariants` — без этого вся система здоровья не работает
2. **P1:** Добавить в CI smoke-checks — предотвращение регрессии
3. **P1:** Исправить telegram-webhook bot_id — устранение ошибок в логах
4. **P2:** Edge Functions Health dashboard — улучшение мониторинга
5. **P3:** AuditLogViewer — улучшение отслеживания

