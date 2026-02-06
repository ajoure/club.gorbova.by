
# FIX: admin-manual-charge — Edge Function не задеплоена (404)

## Диагноз

**Подтверждённая причина ошибки:**
```
POST /functions/v1/admin-manual-charge → 404 NOT_FOUND
{"code":"NOT_FOUND","message":"Requested function was not found"}
```

| Проверка | Результат |
|----------|-----------|
| Network request URL | ✅ Правильный project_ref `hdjgkjceownmmnrqqtuz` |
| Network request headers | ✅ Authorization, apikey присутствуют |
| Edge Function logs | ❌ Нет логов — функция не существует |
| curl POST /admin-manual-charge | ❌ 404 NOT_FOUND |
| functions.registry.txt | ❌ Функция НЕ включена |

**Вывод:** Функция `admin-manual-charge` не включена в registry и не деплоится CI. Это критическая P0 функция для админ-панели.

---

## План исправления

### Шаг 1: Добавить функцию в registry

**Файл:** `supabase/functions.registry.txt`

```diff
# P1 — Important (31)
admin-payments-diagnostics
+ admin-manual-charge
auth-actions
```

### Шаг 2: Исправить технический долг в функции

**Файл:** `supabase/functions/admin-manual-charge/index.ts`

**Изменение 1:** Import (строка 1)
```diff
- import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
+ import { createClient } from 'npm:@supabase/supabase-js@2';
```

**Изменение 2:** CORS headers (строки 4-7)
```diff
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
- 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
+ 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
+ 'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
```

### Шаг 3: Задеплоить функцию

После изменений функция будет автоматически задеплоена.

### Шаг 4: Верификация

```text
1. curl POST /admin-manual-charge → 401/403 (вместо 404)
2. В UI: "Списать деньги" → работает или показывает бизнес-ошибку
```

---

## Итого изменяемых файлов

| Файл | Изменение |
|------|-----------|
| `supabase/functions.registry.txt` | +1 строка: `admin-manual-charge` |
| `supabase/functions/admin-manual-charge/index.ts` | npm: import + CORS headers |

---

## DoD (Definition of Done)

| Проверка | Критерий |
|----------|----------|
| Функция задеплоена | `curl POST /admin-manual-charge` → НЕ 404 |
| CORS работает | OPTIONS preflight возвращает `access-control-allow-headers` с `x-supabase-client-*` |
| UI работает | Кнопка "Списать деньги" не показывает "Failed to send a request" |
| Бизнес-логика | При правильных данных списание проходит, при неправильных — понятная ошибка |
