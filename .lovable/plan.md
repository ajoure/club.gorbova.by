## Отчет о диагностике

**Симптом:** В верхней синей плашке `/admin/payments` все 6 карточек («Успешные», «Возвраты», «Отмены», «Ошибки», «Комиссия», «Чистая выручка») показывают `0,00 / 0 шт`, хотя нижний счётчик честно говорит «18 из 5187 платежей».

**Причина (root cause):**
- Хук `src/hooks/usePaymentsServerStats.ts` зовёт RPC `public.admin_get_payments_stats_v1` через клиент `supabase` под JWT роли `authenticated`.
- Миграция `supabase/migrations/20260202222330_d045ee33-...sql:307` выполнила:
  ```sql
  REVOKE EXECUTE ON FUNCTION public.admin_get_payments_stats_v1 FROM authenticated;
  ```
- Последующая миграция `20260205094248_...sql` пересоздала функцию через `CREATE OR REPLACE` и выдала EXECUTE только `service_role` (`-- Grant execute to service_role (keep existing policy)`), не вернув грант authenticated.
- В `information_schema.routine_privileges` для функции сейчас пусто → клиентский вызов получает `permission denied`, реакт-квери ловит ошибку, `serverStats=undefined`, ветка `if (!serverStats)` отдаёт нули → плашка показывает «0,00».
- Сама RPC по данным корректна: в `payments_v2` 5155 строк bepaid в диапазоне 2020–2026, агрегация работает (проверено напрямую — отказ только из-за грантов).

## План исправления

Минимальный, узкий патч — вернуть доступ для админа, не меняя бизнес-логику RPC и UI.

### Шаг 1. Миграция: восстановить EXECUTE + добавить guard внутри функции
Файл: `supabase/migrations/<новый>_restore_admin_payments_stats_grant.sql`

1. `GRANT EXECUTE ON FUNCTION public.admin_get_payments_stats_v1(timestamptz, timestamptz, text) TO authenticated;`
2. Внутрь тела функции добавить проверку роли в начале (без изменения сигнатуры и возвращаемой формы):
   ```sql
   IF NOT public.has_role_v2(auth.uid(), 'super_admin')
      AND auth.role() <> 'service_role' THEN
     RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
   END IF;
   ```
   Это сохраняет default-deny: обычные authenticated не получают доступ к статистике, только super_admin (что соответствует RBAC v2 SOT). `service_role` (бэкенд/edge) проходит как раньше.
3. Аудит-запись `audit_logs` (system actor): `action='restore_admin_payments_stats_grant'`, `meta={migration, reason, previous_revoke_migration}`.

### Шаг 2. Проверка (Verify)
- В UI на `/admin/payments` под админом плашка отображает ненулевые суммы и счётчики для диапазона 2020-01-01 — 2026-05-22.
- Под non-admin (если есть) RPC отдаёт 42501 — карточки покажут 0,00 (это допустимо, такие пользователи не должны видеть админскую страницу вовсе).
- В DevTools Network нет 400/403 от `/rest/v1/rpc/admin_get_payments_stats_v1` под super_admin.

### Что НЕ меняется
- `usePaymentsServerStats.ts`, `PaymentsStatsPanel.tsx`, `PaymentsTabContent.tsx`, фильтры, формулы — без правок.
- Структура и поля результата JSONB — без правок.
- Логика payments_v2 / провайдер `bepaid` — без правок.
- Грант для `admin_get_payments_page_v1` (которая используется таблицей) не трогаем — она и так работает.

## DoD
- [ ] Миграция применена; `routine_privileges` для `admin_get_payments_stats_v1` содержит `authenticated EXECUTE`.
- [ ] Под super_admin плашка показывает реальные суммы во всех 6 карточках.
- [ ] Не super_admin получает 42501 (RPC недоступна) — данные таблицы и других виджетов не страдают.
- [ ] Audit-запись `restore_admin_payments_stats_grant` присутствует.
