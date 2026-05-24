да, согласен, с учетом правок:

1. План правильный: теперь причина уже конкретная — RPC падает из-за `app_role_v2`, а не из-за отсутствия admin в guard.

&nbsp;

2. В Execute не делать blind CREATE OR REPLACE, пока не скопирован полный текущий functiondef.

Нужно сохранить расчетную часть 1:1:

- сначала `pg_get_functiondef`;

- затем заменить только guard;

- формулы не переписывать вручную.

&nbsp;

3. В proof обязательно добавить:

- было: ошибка `type "app_role_v2" does not exist`;

- стало: HTTP 200 под [7500084@gmail.com](mailto:7500084@gmail.com);

- `pg_get_functiondef` больше не содержит `app_role_v2`.

&nbsp;

4. Проверить не только май 2026, но и текущий выбранный диапазон UI.

Если UI передает другие `p_from/p_to`, verify должен использовать именно payload из Network.

&nbsp;

5. Audit-запись не должна ломать миграцию.

Если insert в audit_logs невозможен из миграции из-за RLS/actor constraints — не останавливать фикс RPC, но зафиксировать это в proof и сделать audit через доступный system path.

&nbsp;

6. Frontend пока не менять.

Но если после backend HTTP 200 UI всё равно показывает нули — сразу зафиксировать как отдельный frontend bug:

`PaymentsStatsPanel silently masks RPC data/error`.

Итоговая команда:

План принимаю с правками.

&nbsp;

Разрешаю выполнить PATCH-PAYMENTS-STATS-RPC-GUARD-FIX-2026-05.

&nbsp;

Scope:

- исправить только guard в существующем `public.admin_get_payments_stats_v1(timestamptz,timestamptz,text)`;

- убрать невалидный `::app_role_v2`;

- разрешить `super_admin OR admin OR service_role`;

- сохранить все формулы статистики 1:1;

- не создавать новую RPC и не создавать overload.

&nbsp;

Перед execute:

- подтвердить ровно один overload;

- сохранить полный `pg_get_functiondef`;

- проверить `has_role_v2` signature;

- проверить, что ошибка под [7500084@gmail.com](mailto:7500084@gmail.com) именно `type "app_role_v2" does not exist`.

&nbsp;

Execute:

- `CREATE OR REPLACE FUNCTION` только с заменой guard;

- `REVOKE EXECUTE FROM PUBLIC, anon`;

- `GRANT EXECUTE TO authenticated, service_role`;

- audit/log proof.

&nbsp;

Verify:

- functiondef не содержит `app_role_v2`;

- RPC под [7500084@gmail.com](mailto:7500084@gmail.com) возвращает HTTP 200 и ненулевой JSON;

- admin тоже HTTP 200;

- non-admin получает 42501;

- anon не имеет доступа;

- UI `/admin/payments` показывает реальные суммы;

- таблица платежей не изменилась;

- формулы не изменены.

&nbsp;

Запрещено:

- новые функции/overloads;

- изменение платежных данных;

- изменение ролей;

- изменение формул;

- anon access;

- frontend patch без отдельного подтверждения, кроме диагностики.

&nbsp;

Proof:

.lovable/proofs/payments_stats_rpc_diagnose_2026_[05.md](http://05.md)

&nbsp;

План:

## 1. Проблема

В реальном UI под пользователем `7500084@gmail.com` карточки статистики платежей показывают нули. Это подтверждается скрином и network-снимком.

Ключевой факт: текущий RPC-вызов под вашим JWT падает не из-за отсутствия роли `admin`, а с ошибкой:

```json
{"code":"42704","message":"type \"app_role_v2\" does not exist"}
```

Значит предыдущая теория «super_admin видит, admin не видит» для вашей реальности неверна. Сейчас ломается сам guard RPC из-за несуществующего enum/type cast:

```sql
'super_admin'::app_role_v2
```

Из-за ошибки RPC React Query не получает данные, а карточки отображают дефолтные нули.

## 2. Диагностика — уже подтвержденные факты

### UI / Network

- Route: `/admin/payments`.
- Дата: `2026-05-01 — 2026-05-31`.
- В таблице видно `194 из 194`, сумма строки `Σ 44 060,00 BYN`, то есть данные платежей в UI есть.
- Карточки статистики сверху показывают `0,00` и `0 шт`.
- Network request:
  - `POST /rest/v1/rpc/admin_get_payments_stats_v1`
  - Status: `400`
  - Body: `type "app_role_v2" does not exist`
  - JWT email: `7500084@gmail.com`.

### Code/RPC source

Миграция `20260523093059_5b459f41-1c3d-4154-bb0c-e7c2568d21bf.sql` содержит:

```sql
IF auth.role() <> 'service_role'
   AND NOT public.has_role_v2(auth.uid(), 'super_admin'::app_role_v2) THEN
```

Это и есть фактическая причина текущего падения.

### Frontend call

`src/hooks/usePaymentsServerStats.ts` вызывает:

```ts
supabase.rpc('admin_get_payments_stats_v1', {
  p_from,
  p_to,
  p_provider: 'bepaid',
})
```

`src/components/admin/payments/PaymentsStatsPanel.tsx` при отсутствии `serverStats` показывает нули.

## 3. Предлагаемое решение

Сделать PATCH в два безопасных уровня.

### Уровень A — исправить реальную поломку RPC

В миграции `CREATE OR REPLACE FUNCTION public.admin_get_payments_stats_v1(...)`:

- сохранить текущую сигнатуру:
  ```sql
  (p_from timestamptz, p_to timestamptz, p_provider text DEFAULT 'bepaid') RETURNS jsonb
  ```
- сохранить `STABLE SECURITY DEFINER` и `SET search_path TO 'public'`;
- сохранить тело расчетов 1:1;
- заменить невалидный cast:
  ```sql
  'super_admin'::app_role_v2
  ```
  на строковый вызов, совместимый с фактическим `has_role_v2`:
  ```sql
  public.has_role_v2(auth.uid(), 'super_admin')
  ```

### Уровень B — права для всех администраторов

После того как RPC перестанет падать под `super_admin`, расширить guard до:

```sql
IF auth.role() <> 'service_role'
   AND NOT (
     public.has_role_v2(auth.uid(), 'super_admin')
     OR public.has_role_v2(auth.uid(), 'admin')
   ) THEN
  RAISE EXCEPTION 'forbidden: admin role required'
    USING ERRCODE = '42501';
END IF;
```

Это чинит не только текущего `super_admin`, но и обычных `admin`, не открывая RPC для `anon` или не-админов.

## 4. Изменяемые компоненты

### Database/RPC

- `public.admin_get_payments_stats_v1(timestamptz, timestamptz, text)` — только guard, без изменения формул.
- Grants:
  - `REVOKE EXECUTE ... FROM PUBLIC, anon;`
  - `GRANT EXECUTE ... TO authenticated, service_role;`

### Proof

Обновить/создать:

- `.lovable/proofs/payments_stats_rpc_diagnose_2026_05.md`

Если файла в репозитории реально нет, создать его заново с текущими фактами, а не ссылаться на несуществующий proof.

### UI code

Frontend не менять, если после RPC-fix карточки начинают получать данные.
Если UI всё равно показывает нули при успешном RPC, тогда отдельным минимальным frontend-патчем добавить явное состояние ошибки в `PaymentsStatsPanel`, чтобы ошибка RPC не маскировалась под нулевые суммы.

## 5. Что не будет изменено

- Формулы статистики.
- Фильтры `p_from`, `p_to`, `p_provider`.
- Таблицы `payments_v2`, `orders_v2`, `subscriptions_v2`.
- Роли пользователей.
- Платежные данные.
- Edge functions.
- Новые RPC не создаются.
- Доступ `anon` не добавляется.

## 6. Dry-run / симуляция до выполнения

Перед миграцией выполнить read-only проверки:

1. Проверить, что существует ровно один overload:
  ```sql
   SELECT n.nspname, p.proname, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'admin_get_payments_stats_v1';
  ```
2. Проверить фактическую сигнатуру `has_role_v2`, чтобы не угадывать типы:
  ```sql
   SELECT pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'has_role_v2';
  ```
3. Симулировать новый guard без изменения данных:
  ```sql
   SELECT
     public.has_role_v2('<ваш_user_id>'::uuid, 'super_admin') AS is_super_admin,
     public.has_role_v2('<ваш_user_id>'::uuid, 'admin') AS is_admin;
  ```
4. Сравнить ожидаемые агрегаты напрямую по `payments_v2` за май 2026 с тем, что должен вернуть RPC после фикса.

## 7. Execute

Выполнить одну миграцию:

- `CREATE OR REPLACE FUNCTION public.admin_get_payments_stats_v1(...)` с исправленным guard `super_admin OR admin` без `::app_role_v2`.
- `REVOKE EXECUTE FROM PUBLIC, anon`.
- `GRANT EXECUTE TO authenticated, service_role`.
- Audit-запись в `audit_logs`:
  - action: `payments_stats_rpc_guard_fixed`
  - meta: причина `app_role_v2 cast removed`, guard `admin|super_admin`, формулы не менялись.

## 8. Verify после выполнения

### Backend proof

1. `pg_get_functiondef` больше не содержит `app_role_v2`.
2. Guard содержит `has_role_v2(auth.uid(), 'super_admin') OR has_role_v2(auth.uid(), 'admin')`.
3. `anon` не имеет EXECUTE.
4. `authenticated` имеет EXECUTE.
5. REST RPC под вашим JWT (`7500084@gmail.com`) возвращает HTTP 200 и ненулевой JSON за `2026-05-01 — 2026-05-31`.
6. Если есть доступный обычный `admin` без `super_admin`, REST RPC под ним тоже возвращает HTTP 200.
7. Не-админ получает `42501`.

### UI proof со скринами

1. Открыть preview `/admin/payments`.
2. Авторизоваться через `Login as Developer`, пароль `123456`, если preview попросит.
3. Под текущей сессией открыть платежи за май 2026.
4. Сделать скрин до/после или после-fix:
  - карточки статистики показывают реальные суммы;
  - таблица всё еще показывает `194 из 194`;
  - сумма карточек согласуется с backend RPC/direct aggregate.
5. Проверить клик по карточке-фильтру: статистика не ломает фильтрацию таблицы.

## 9. STOP-guards

Остановиться без миграции, если:

- найдено больше одного overload `admin_get_payments_stats_v1`;
- `has_role_v2` принимает не `text`/совместимый string role code;
- direct aggregate по `payments_v2` за май 2026 не совпадает с ожидаемой логикой текущей функции;
- миграция требует изменения формул или платежных таблиц;
- после миграции `anon` получает EXECUTE;
- UI после backend HTTP 200 всё еще показывает нули — тогда не делать второй blind-fix, а диагностировать frontend отдельно.

## 10. DoD

Задача считается закрытой только если:

- текущий `super_admin` больше не получает `type "app_role_v2" does not exist`;
- карточки статистики на `/admin/payments` показывают реальные суммы, а не нули;
- `admin` и `super_admin` имеют доступ к статистике;
- `anon` и не-админы заблокированы;
- формулы статистики не изменены;
- proof содержит:
  - реальную ошибку из network;
  - before/after guard;
  - backend SQL/REST verify;
  - UI screenshots;
  - audit id/time;
  - вывод, что исправлена фактическая причина, а не только гипотеза про admin-role.

## 11. Риски и зависимости

- Главный риск — снова сделать blind-fix на роли, не устранив runtime error. Поэтому первым DoD является отсутствие `app_role_v2` в functiondef и HTTP 200 под вашим JWT.
- UI может дополнительно маскировать ошибки как нули; если это подтвердится после backend-fix, будет отдельный frontend-patch на явное состояние ошибки.
- Скриншоты являются UI-proof, но финальное подтверждение должно включать backend-proof, потому что UI сам по себе не доказывает корректность прав и формул.