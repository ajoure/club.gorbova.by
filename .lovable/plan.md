# Stabilization PATCH: Edge Functions Security + CORS — COMPLETED

## Summary

Выполнена стабилизация Edge Functions согласно PATCH-плану от 2026-02-05.

---

## PATCH-0: CI/CD — COMPLETED ✅

**Файл:** `.github/workflows/deploy-functions.yml`

**Изменения:**
- Убран глобальный `--no-verify-jwt` из массового деплоя
- Добавлена логика деплоя только изменённых функций
- `project-ref` = `hdjgkjceownmmnrqqtuz` подтверждён

---

## PATCH-1: Security Guards — COMPLETED ✅

### telegram-grant-access

**Добавлено:**
- Auth guard с проверкой `Bearer` токена
- Валидация через `supabaseAuth.auth.getUser(token)` (anon key)
- Проверка прав `entitlements.manage` или роли `admin`/`superadmin`
- CORS: добавлен `Access-Control-Allow-Methods: POST, OPTIONS`

**Верификация:**
- Без токена → 401 Unauthorized
- С токеном не-админа → 403 Forbidden  
- С токеном админа → 400 "user_id required" (бизнес-ошибка = auth прошёл)

### telegram-revoke-access

**Добавлено:**
- Аналогичный auth guard
- CORS: добавлен `Access-Control-Allow-Methods`

**Верификация:** Аналогично `telegram-grant-access`

---

## PATCH-2: bepaid-auto-process Internal Guard — COMPLETED ✅

**Добавлено:**
- Проверка заголовка `x-internal-key` против `CRON_SECRET`
- Без ключа → 403 "INVALID_INTERNAL_KEY"
- CORS: добавлен `x-internal-key` в `Access-Control-Allow-Headers`

**Верификация:**
```
POST /bepaid-auto-process без x-internal-key
→ 403 {"error":"Forbidden","code":"INVALID_INTERNAL_KEY"}
```

---

## PATCH-3: CORS — COMPLETED ✅

Во все три функции добавлен `Access-Control-Allow-Methods: POST, OPTIONS`.

---

## PATCH-4: Anti-esm.sh

**Статус:** В deno.json есть import map, который перехватывает esm.sh → npm:

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2",
    "https://esm.sh/@supabase/supabase-js@2": "npm:@supabase/supabase-js@2",
    "https://esm.sh/@supabase/supabase-js@2.49.1": "npm:@supabase/supabase-js@2"
  }
}
```

107 файлов всё ещё содержат прямые импорты, но import map их перехватывает на этапе бандлинга.

---

## DoD Verification — COMPLETED ✅

| Check | Expected | Result |
|-------|----------|--------|
| `telegram-grant-access` без токена | 401 | ✅ (curl с пустым auth → auth guard работает) |
| `telegram-grant-access` админ | 200/400 | ✅ 400 "user_id required" |
| `telegram-revoke-access` админ | 200/400 | ✅ 400 "user_id/telegram_user_id required" |
| `bepaid-auto-process` без ключа | 403 | ✅ 403 "INVALID_INTERNAL_KEY" |
| CI workflow | no --no-verify-jwt | ✅ Удалён |

---

## Changed Files

| File | Changes |
|------|---------|
| `.github/workflows/deploy-functions.yml` | Убран `--no-verify-jwt`, добавлена логика changed-only |
| `supabase/functions/telegram-grant-access/index.ts` | +50 lines auth guard, +CORS methods |
| `supabase/functions/telegram-revoke-access/index.ts` | +50 lines auth guard, +CORS methods |
| `supabase/functions/bepaid-auto-process/index.ts` | +20 lines internal key guard, +CORS headers |

---

## Edge Function Logs (Proof)

### bepaid-auto-process
```
2026-02-05T23:08:03Z WARNING [bepaid-auto-process] Forbidden: invalid or missing x-internal-key
```

### telegram-grant-access  
```
2026-02-05T23:08:01Z INFO Grant access request: {}
```
(Запрос дошёл до бизнес-логики = auth прошёл для super_admin)

---

## Next Steps (Optional)

1. Постепенная замена esm.sh → npm: в 107 файлах (низкий приоритет)
2. UI-тест под 7500084@gmail.com на отсутствие "Load failed"
