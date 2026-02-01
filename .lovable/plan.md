
# План исправления bePaid Preflight — ВЫПОЛНЕНО ✅

## Результат

| Проверка | Статус | Детали |
|----------|--------|--------|
| Shop ID | ✅ | 33524 (из integration_instances) |
| Secret Key | ✅ | 64 символа |
| Preflight | ✅ | `ok: true, charge_capability: true` |
| Provider Check | ✅ | `token_validation` |

## Preflight ответ (2026-02-01T23:25:38Z)

```json
{
  "ok": true,
  "build_id": "prereg-cron:2026-02-02T11:30:00Z",
  "host_used": "gateway.bepaid.by",
  "shop_id_masked": "335**",
  "shop_id_source": "integration_instances",
  "http_status": 400,
  "provider_check": "token_validation",
  "charge_capability": true,
  "provider_error": null
}
```

## Логика проверки

1. Отправляем запрос с невалидным токеном на `/transactions/payments`
2. bePaid возвращает 400 "Token does not exist" — это означает, что credentials приняты
3. Если бы credentials были неверные — получили бы 401/403

## Изменения в коде

**Файл:** `supabase/functions/preregistration-charge-cron/index.ts`

- Убран несуществующий endpoint `GET /shops/{id}`
- Убрана тестовая авторизация с картой (не поддерживается аккаунтом)
- Добавлена проверка через невалидный токен + проверка recent payments в БД

## Следующие шаги

1. ✅ Preflight работает — credentials валидны
2. ⏳ Настроить CRON для 09:00/21:00 Europe/Minsk (1-4 февраля)
3. ⏳ Протестировать execute=1 в разрешённом окне
