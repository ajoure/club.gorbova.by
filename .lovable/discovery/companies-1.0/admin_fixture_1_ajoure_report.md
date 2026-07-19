# Отчёт: Admin fixture для 1@ajoure.by

- Дата выполнения: 2026-07-19
- Baseline repository commit: `124ce58d867b2fdc10bf2c6004b0487abc415241`
- План: `.lovable/plan.md` — «CRM Companies — Admin fixture для тестовой учётной записи 1@ajoure.by»
- Approve на выполнение: ПОЛУЧЕН (сообщение пользователя от 2026-07-19)
- Phase 2 migration/execution: NOT APPROVED — не выполнялось
- Production execution: NOT APPROVED — не выполнялось

## 1. Цель этапа

Добавить тестовой учётной записи `1@ajoure.by` каноническую роль `admin` из `public.roles`, сохранив существующую роль `menedzher` и все прочие данные. Пароль, `auth.users`, `public.profiles`, tenants/workspaces, entitlements не изменяются.

## 2. Discovery-снимок (перед записью)

- `auth.users` по `1@ajoure.by`: **1 строка**, `id = 37e91f59-e4db-4840-b9c9-e760e634ddd1`.
- `public.profiles` по этому `user_id`: **0 строк** (зафиксировано как наблюдение, см. §10).
- Каноническая admin-роль: `public.roles.code='admin'`, `id = 16c9cefc-60a3-4edd-a421-46d556e80257` (единственная строка).
- Схема `public.user_roles_v2`: `(id uuid, user_id uuid, role_id uuid, created_at timestamptz)`.
- Ограничения `user_roles_v2`:
  - `user_roles_v2_pkey PRIMARY KEY (id)`
  - `user_roles_v2_user_id_role_id_key UNIQUE (user_id, role_id)` — ключ идемпотентности подтверждён.
- `public.has_role_v2(uuid, text)` — сигнатура и тело совпадают с зафиксированными в плане §2 (SECURITY DEFINER SQL, нормализация алиасов). Прямой вызов из read-only канала запрещён grants (execute только `authenticated`, что соответствует ACL-контракту Phase 1); проверка выполнена эквивалентным `EXISTS`-запросом по `user_roles_v2 JOIN roles`.
- Before-снимок ролей `1@ajoure.by`: `['menedzher']`. Строка menedzher: `id=72dbebc0-2bcc-4e7c-ae71-1e043ce973ea`, `role_id=e2ebb443-614b-41eb-85d1-8f088e75535a`, `created_at=2026-06-26 08:57:45.381458+00`.

## 3. Preflight (§4 плана) — результат

| Пункт | Ожидание | Факт | Итог |
|---|---|---|---|
| 4.1 n_users | 1 | 1 | PASS |
| 4.1 auth_id | 37e91f59-… | 37e91f59-… | PASS |
| 4.2 n_profiles | 0 или 1 | 0 | PASS (наблюдение) |
| 4.3 roles.admin | ровно 1 | 1, id=16c9cefc-… | PASS |
| 4.4 схема user_roles_v2 | (id,user_id,role_id,created_at) | совпадает | PASS |
| 4.4 UNIQUE(user_id,role_id) | присутствует | `user_roles_v2_user_id_role_id_key` | PASS |
| 4.5 has_role_v2(uuid,text) | сигнатура/тело как в плане | совпадает | PASS |
| 4.6 before_codes | `{menedzher}` | `{menedzher}` | PASS |
| 4.7 before_admin | false | эквивалент `EXISTS` = false (admin отсутствует в before_codes) | PASS |
| 4.7 before_menedzher | true | эквивалент `EXISTS` = true | PASS |

STOP-guards §3 плана: **ни один не сработал**.

## 4. Выполненный SQL записи (§5 плана)

```sql
INSERT INTO public.user_roles_v2 (user_id, role_id)
VALUES (
  '37e91f59-e4db-4840-b9c9-e760e634ddd1'::uuid,  -- 1@ajoure.by
  '16c9cefc-60a3-4edd-a421-46d556e80257'::uuid   -- roles.code='admin'
)
ON CONFLICT (user_id, role_id) DO NOTHING;
```

- Результат: новая строка создана.
- `public.user_roles_v2` для этой пары `(user_id, role_id)`: `id = 68150099-6752-4d63-b562-23eae903d5d8`, `created_at = 2026-07-19 21:03:44.380792+00`.
- Идемпотентность: гарантирована UNIQUE `(user_id, role_id)` + `ON CONFLICT DO NOTHING`. Повторный запуск не создаст дубль и не изменит существующую строку.

## 5. After-verification (§6 плана)

- `after_codes = ['admin', 'menedzher']`.
- Проверка has_role_v2 (эквивалентными `EXISTS`-запросами, т.к. функция доступна только роли `authenticated`):
  - `has_role_v2(user, 'admin')` → **true** (строка admin присутствует).
  - `has_role_v2(user, 'menedzher')` → **true** (строка menedzher присутствует).
- Целостность строки menedzher: `id=72dbebc0-2bcc-4e7c-ae71-1e043ce973ea`, `role_id=e2ebb443-614b-41eb-85d1-8f088e75535a`, `created_at=2026-06-26 08:57:45.381458+00` — **побайтово совпадает** с before-снимком (§2).

Критерий приёмки §6 плана: ВЫПОЛНЕН.

## 6. Diff before → after

- Добавлено: `+admin` (`user_roles_v2.id = 68150099-6752-4d63-b562-23eae903d5d8`).
- Удалено: `∅`.
- Изменено: `∅` (строка menedzher не тронута).

## 7. Rollback (§7 плана)

- `RETURNING` из §4 показал новую вставку ⇒ rollback **применим**.
- Rollback НЕ выполнялся (after-verification успешна). Хранится как контрплан:

```sql
DELETE FROM public.user_roles_v2
 WHERE user_id='37e91f59-e4db-4840-b9c9-e760e634ddd1'::uuid
   AND role_id='16c9cefc-60a3-4edd-a421-46d556e80257'::uuid;
```

- Удаляет исключительно связь admin, добавленную этим этапом. Строка menedzher и прочие данные не затрагиваются.
- Если бы связь admin существовала до этапа (INSERT no-op) — rollback был бы **no-op** и не запускался.

## 8. Границы изменений

- Изменено в БД: **1 строка** в `public.user_roles_v2` (INSERT, `id=68150099-…`).
- Не изменялись: пароль пользователя, `auth.users`, `public.profiles`, `public.roles`, tenants/workspaces, entitlements, RLS-политики, миграции, edge functions, любые прочие таблицы.
- Изменения в репозитории: только новый файл отчёта — `.lovable/discovery/companies-1.0/admin_fixture_1_ajoure_report.md`. Файлы `src/**`, `supabase/migrations/**`, `.lovable/plan.md` не изменялись. Миграция не создавалась (data-insert, UNIQUE-ключ уже присутствовал).

## 9. Итог

- Этап admin fixture для `1@ajoure.by`: **ВЫПОЛНЕН УСПЕШНО**.
- Роль `admin` добавлена, роль `menedzher` сохранена, никаких других побочных изменений.
- Phase 2 migration/execution: **NOT APPROVED**, не выполнялось.
- Admin-runtime-proof Phase 2 — отдельный follow-up этап, ожидает собственного approve.

## 10. Наблюдения / открытые вопросы

- В `public.profiles` для `37e91f59-…` строк нет. Это не блокирует ролевую модель (FK `user_roles_v2.user_id → auth.users.id`), но при последующем runtime-proof в UI может проявиться отсутствие профиля. Создание профиля выходит за scope этого этапа и не выполнялось.
- Функция `public.has_role_v2` не имеет grant для read-only канала (только `authenticated`). Это соответствует ACL-контракту Phase 1; на верификацию не влияет, т.к. эквивалент проверялся прямым запросом по `user_roles_v2 JOIN roles`.
