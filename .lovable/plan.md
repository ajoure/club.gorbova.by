

## Диагноза: Почему reminders = 0 отправок

**Корневая причина найдена и подтверждена вызовом функции:**

Строка 859 в `subscription-renewal-reminders/index.ts`:
```
console.log(`...paymentLink=${!!paymentLinkUrl}`);
```
Переменная `paymentLinkUrl` **не существует** — она осталась от предыдущего рефакторинга. Это вызывает `ReferenceError` в секции "expiring without SBS" (строки 746-860), который **не ловится try/catch внутри цикла** и выбрасывается наверх в глобальный catch, возвращая HTTP 500.

**Важно:** Функция реально работает — она находит кандидатов (7d=1, 3d=3, 1d=0), отправляет напоминания, логирует "already sent today". Но после секции стандартных напоминаний она крашится на строке 859, и:
- audit_logs запись `subscription.reminders_cron_completed` **не создается** (код до неё не доходит)
- HTTP ответ = 500, поэтому edge function logs показывали "No logs" ранее (retention)

## План исправления

### 1. Исправить битую ссылку на переменную (1 строка)
**Файл:** `supabase/functions/subscription-renewal-reminders/index.ts`, строка 859

Заменить:
```typescript
console.log(`Expiring-without-SBS for user ${userId}: sent=${telegramResult.sent}, paymentLink=${!!paymentLinkUrl}`);
```
На:
```typescript
console.log(`Expiring-without-SBS for user ${userId}: sent=${telegramResult.sent}, oneTime=${!!ncOneTimeUrl}, sub=${!!ncSubscriptionUrl}`);
```

Переменные `ncOneTimeUrl` и `ncSubscriptionUrl` определены выше (строки 821-822) и являются корректными для этого контекста.

### 2. Деплой и верификация
- Деплой функции
- Вызвать вручную с `{"source":"manual_fix_test"}`
- Проверить: HTTP 200, в audit_logs появится `subscription.reminders_cron_completed`
- Проверить: в telegram_logs появятся записи `SEND_REMINDER` со статусами success/skipped

### Что НЕ трогаем
- Логику выборки кандидатов (subscriptions_v2.access_end_at) — она корректна, кандидаты есть
- Cron job (jobid=17, 06:00 UTC) — работает, status=succeeded
- Бот (@gorbovabybot) — найден, токен есть
- Timezone helper — работает корректно

