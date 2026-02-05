
# План: Исправление ошибки импорта CSV выписки bePaid

## Проблема
При нажатии "Проверить (Dry-run)" появляется ошибка:
> **Ошибка проверки — Failed to send a request to the Edge Function**

## Причина
Edge Function `admin-import-bepaid-statement-csv` **не задеплоена**, потому что:
1. **НЕ зарегистрирована** в `supabase/config.toml`
2. Использует нестабильный импорт `esm.sh` (может вызывать timeout при деплое)

---

## Решение

### PATCH-1: Зарегистрировать функцию в config.toml

**Файл**: `supabase/config.toml`

Добавить в конец:
```toml
[functions.admin-import-bepaid-statement-csv]
verify_jwt = false
```

---

### PATCH-2: Исправить импорт Supabase-клиента

**Файл**: `supabase/functions/admin-import-bepaid-statement-csv/index.ts`

**Было (строка 3)**:
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
```

**Стало**:
```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
```

---

### PATCH-3: Задеплоить функцию

Выполнить:
```
supabase--deploy_edge_functions: ["admin-import-bepaid-statement-csv"]
```

---

## Техническая сводка

| Файл | Строка | Изменение |
|------|--------|-----------|
| `supabase/config.toml` | конец | Добавить регистрацию функции |
| `supabase/functions/admin-import-bepaid-statement-csv/index.ts` | 3 | `esm.sh` → `npm:` |

---

## Проверка (DoD)

1. `/admin/payments` → вкладка "Выписка BePaid" → "Импорт CSV" → выбрать файлы → "Проверить (Dry-run)" → **НЕТ ошибки "Failed to send a request"**
2. В Network: запрос к `/admin-import-bepaid-statement-csv` возвращает **200** (не 404)
3. Dry-run показывает результат проверки файлов
