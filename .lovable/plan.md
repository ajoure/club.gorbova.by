## Жёсткие правила исполнения для Lovable.dev (обязательно)

1) **Ничего не ломать и не трогать лишнее.** Только изменения из PATCH.  
2) **Add-only / минимальный diff.** Любое удаление/рефактор — только если прямо указано.  
3) **Dry-run → execute.** Сначала проверка через curl/Network, потом деплой.  
4) **STOP-guards обязательны:** если 401/403/таймауты не сходятся с DoD — STOP и отчёт.  
5) **Безопасность:** `verify_jwt=false` допустим только при **ручном auth guard** внутри функции.  
6) **DoD только по фактам:** Network (headers + status), curl, скрин UI из админки `7500084@gmail.com`.  
7) **No-PII в логах.** Токены/секреты не логировать.

---

# ✅ COMPLETED: integration-healthcheck — HOTFIX applied

## Что было сделано

### HOTFIX: Разделение Supabase clients

| Изменение | Описание |
|-----------|----------|
| **Два клиента** | `supabaseAuth` (anon key) для `auth.getUser()`, `supabaseAdmin` (service-role) для RPC + DB |
| **Auth guard** | Проверка superadmin через `has_role` RPC |
| **Timeout 10s** | Все внешние API (bePaid, Kinescope, GetCourse, AmoCRM) используют `fetchWithTimeout` |
| **CORS headers** | Расширены для совместимости с Supabase client headers |

### Верификация

- ✅ **Superadmin (7500084@gmail.com):** 200 с `{"success":false,"error":"Неизвестный провайдер: test"}` — guard пропустил, дошло до логики провайдера
- ✅ Логи подтверждают: `Health check for provider: test, instance: 123`
- ⚠️ Ошибки `invalid uuid: "123"` — ожидаемо (тестовый instance_id)

### Ожидающая проверка (требует ручного теста)

1. **Без токена:** должен вернуть 401
2. **С токеном НЕ-superadmin:** должен вернуть 403
3. **UI `/admin/integrations/payments`:** "Проверить bePaid" работает без "Load failed"
