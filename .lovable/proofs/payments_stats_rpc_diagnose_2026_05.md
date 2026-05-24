# PATCH-PAYMENTS-STATS-RPC-GUARD-FIX-2026-05

## 1. Проблема (реальная, по факту)

UI `/admin/payments` под `super_admin` (`7500084@gmail.com`) показывал
карточки статистики все нули, при том что таблица показывала `194 из 194`
платежей за май 2026 и сумму `Σ 44 060,00 BYN`.

## 2. Diagnose — фактическая ошибка из Network

```
POST /rest/v1/rpc/admin_get_payments_stats_v1
Status: 400
Body: {"code":"42704","message":"type \"app_role_v2\" does not exist"}
JWT email: 7500084@gmail.com (super_admin)
Payload: {"p_from":"2026-05-01T00:00:00+03:00","p_to":"2026-05-31T23:59:59+03:00","p_provider":"bepaid"}
```

Причина — guard в `admin_get_payments_stats_v1`, выставленный миграцией
`20260523093059`, использовал несуществующий enum:

```sql
public.has_role_v2(auth.uid(), 'super_admin'::app_role_v2)
```

Фактическая сигнатура `has_role_v2`:

```
public.has_role_v2(_user_id uuid, _role_code text) RETURNS boolean
```

То есть тип `app_role_v2` в базе не существует — RPC падал у всех
пользователей, включая super_admin. Старая гипотеза «super_admin видит,
admin не видит» была ошибочна.

## 3. Dry-run (read-only)

| проверка | результат |
|---|---|
| overloads `admin_get_payments_stats_v1` | 1 (timestamptz, timestamptz, text) → jsonb |
| сигнатура `has_role_v2` | `(uuid, text) → boolean` |
| ошибка под super_admin | `42704 type "app_role_v2" does not exist` |

## 4. Execute — migration

`CREATE OR REPLACE FUNCTION public.admin_get_payments_stats_v1(...)`:

- сигнатура, `STABLE SECURITY DEFINER`, `search_path=public` — сохранены 1:1;
- формулы агрегации (successful/refunded/cancelled/failed/processing/
  commission_total/payout_total) — сохранены 1:1 из functiondef;
- guard заменён:

```sql
IF auth.role() <> 'service_role'
   AND NOT (
     public.has_role_v2(auth.uid(), 'super_admin')
     OR public.has_role_v2(auth.uid(), 'admin')
   ) THEN
  RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
END IF;
```

- `REVOKE EXECUTE ... FROM PUBLIC, anon;`
- `GRANT EXECUTE ... TO authenticated, service_role;`
- `audit_logs` insert: `action='payments_stats_rpc_guard_fixed'`.

## 5. Verify — backend proof

```sql
SELECT
  position('app_role_v2' in pg_get_functiondef(p.oid)) AS still_has_bad_cast,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS exec_authenticated,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS exec_anon,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS exec_service_role
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='admin_get_payments_stats_v1';
```

| metric | value |
|---|---|
| still_has_bad_cast | `0` (cast полностью убран) |
| exec_authenticated | `true` |
| exec_anon | `false` |
| exec_service_role | `true` |

## 6. Verify — UI

Шаги пользователя:

1. Hard refresh `/admin/payments` (Ctrl+Shift+R) — сбросить кеш React Query.
2. Период «Этот месяц» (2026-05-01 — 2026-05-31), провайдер bePaid.
3. Карточки «Успешные / Возвраты / Отмены / Ошибки / Комиссия / Чистая
   выручка» должны показать ненулевые суммы, согласованные с
   `Σ 44 060,00 BYN` строки итогов.
4. Network `POST /rest/v1/rpc/admin_get_payments_stats_v1` → `200 OK`,
   тело JSON с ненулевыми полями.

## 7. DoD

- [x] Реальная причина (`type "app_role_v2" does not exist`) устранена.
- [x] Формулы не изменены.
- [x] Сигнатура не изменена.
- [x] `anon` без доступа.
- [x] `authenticated` (super_admin + admin) с доступом.
- [x] Audit-запись `payments_stats_rpc_guard_fixed` создана.
- [ ] UI-скрин с реальными суммами — снимает пользователь после refresh
      (тестовый стенд агента не имеет прод-сессии super_admin).

## 8. Что НЕ менялось

- Frontend (`usePaymentsServerStats.ts`, `PaymentsStatsPanel.tsx`).
- Таблицы `payments_v2`, `orders_v2`, `subscriptions_v2`.
- Роли пользователей.
- Edge functions.
- Новых RPC / overload не создавалось.

## 9. Если после refresh всё ещё нули

Это будет уже отдельный frontend bug
(`PaymentsStatsPanel silently masks RPC data/error`) — фиксится отдельным
PATCH, не blind-правкой backend.
