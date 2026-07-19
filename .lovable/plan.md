# План: CRM Companies — Admin fixture для тестовой учётной записи 1@ajoure.by

Статус: PLAN ONLY. Требуется отдельный approve. Ни файлы, ни БД до approve не изменяются.

Baseline repository commit: `68c00477bc633b44f651e0b7f77de4b764b2fe20`.
Production execution: NOT APPROVED. Phase 2 migration/execution: не выполняется.

## 1. Цель

Добавить каноническую роль `admin` тестовой учётной записи `1@ajoure.by` (для последующего admin-runtime-proof Phase 2), не затрагивая пароль, `auth.users`, профиль, tenant/workspace, entitlements и текущие роли. Действие идемпотентное, обратимое, покрыто before/after верификацией.

## 2. Read-only discovery (уже выполнено, зафиксировано)

- `auth.users.id` для `1@ajoure.by` = **`37e91f59-e4db-4840-b9c9-e760e634ddd1`** (единственная строка).
- `public.profiles` по этому id: **0 строк** (профиль отсутствует).
- Текущие связи в `public.user_roles_v2` для этого `user_id`:
  - `id=72dbebc0-2bcc-4e7c-ae71-1e043ce973ea`, `role_id=e2ebb443-614b-41eb-85d1-8f088e75535a` (`menedzher`), `created_at=2026-06-26 08:57:45.381458+00`.
- Каноническая роль `admin` в `public.roles`: **`id=16c9cefc-60a3-4edd-a421-46d556e80257`**, `code='admin'`.
- Схема `public.user_roles_v2`: `id uuid`, `user_id uuid`, `role_id uuid`, `created_at timestamptz`. UNIQUE-ограничения будут перепроверены на preflight (см. §4).
- `public.has_role_v2(_user_id uuid, _role_code text)` — SECURITY DEFINER SQL, читает `user_roles_v2 JOIN roles` и нормализует алиасы (`super-admin`/`superadmin` → `super_admin`, `employee` — виртуальный код). Соответствует ожидаемой семантике.

## 3. STOP-условия (перепроверяются на preflight; при срабатывании — остановка без записи)

- по `1@ajoure.by` найдено ≠1 строки в `auth.users`;
- в `public.profiles` для этого `user_id` найдено >1 строки (0 — допустимо, будет зафиксировано в отчёте как наблюдение);
- в `public.roles` не найдена ровно одна строка с `code='admin'`;
- схема `public.user_roles_v2` отличается от `(id, user_id, role_id, created_at)` либо отсутствует UNIQUE, покрывающий `(user_id, role_id)`;
- сигнатура `public.has_role_v2(uuid, text)` отличается от зафиксированной в §2;
- запрошено изменение пароля, `auth.users`, профиля, tenant/workspace, entitlements;
- предложение подменить `admin` на `manager`/`curator`/`client` либо создать новую роль.

## 4. Preflight (read-only, транзакционно, без записи)

```sql
BEGIN;
SET LOCAL statement_timeout = '15s';

-- 4.1 Пользователь единственен
SELECT COUNT(*) AS n_users FROM auth.users WHERE email='1@ajoure.by'; -- ожидается 1
SELECT id FROM auth.users WHERE email='1@ajoure.by';                  -- ожидается 37e91f59-...

-- 4.2 Профиль (наблюдение, не блокер если 0)
SELECT COUNT(*) FROM public.profiles WHERE id='37e91f59-e4db-4840-b9c9-e760e634ddd1';

-- 4.3 Каноническая admin-роль
SELECT id, code FROM public.roles WHERE code='admin'; -- ожидается 16c9cefc-...

-- 4.4 Схема user_roles_v2 и UNIQUE(user_id, role_id)
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema='public' AND table_name='user_roles_v2' ORDER BY ordinal_position;
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid='public.user_roles_v2'::regclass AND contype IN ('u','p');

-- 4.5 Сигнатура has_role_v2
SELECT pg_get_functiondef(p.oid) FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='has_role_v2';

-- 4.6 Before-снимок ролей пользователя
SELECT r.code
  FROM public.user_roles_v2 ur JOIN public.roles r ON r.id=ur.role_id
 WHERE ur.user_id='37e91f59-e4db-4840-b9c9-e760e634ddd1'
 ORDER BY r.code;

-- 4.7 Пред-проверки has_role_v2
SELECT public.has_role_v2('37e91f59-e4db-4840-b9c9-e760e634ddd1','admin')     AS before_admin;      -- ожидается false
SELECT public.has_role_v2('37e91f59-e4db-4840-b9c9-e760e634ddd1','menedzher') AS before_menedzher;  -- ожидается true

ROLLBACK;
```

Если любой пункт не совпадает с §2/§3 — STOP, отчёт без изменений БД.

## 5. Точный SQL записи (idempotent)

Один INSERT со стандартным `ON CONFLICT DO NOTHING` по паре `(user_id, role_id)`. Никаких прочих полей, никаких обновлений существующих строк.

```sql
BEGIN;
SET LOCAL statement_timeout = '15s';

INSERT INTO public.user_roles_v2 (user_id, role_id)
VALUES (
  '37e91f59-e4db-4840-b9c9-e760e634ddd1'::uuid,  -- 1@ajoure.by
  '16c9cefc-60a3-4edd-a421-46d556e80257'::uuid   -- roles.code='admin'
)
ON CONFLICT (user_id, role_id) DO NOTHING
RETURNING id, user_id, role_id, created_at;

COMMIT;
```

Идемпотентность:
- ключ идемпотентности — UNIQUE `(user_id, role_id)` в `public.user_roles_v2` (подтверждается на preflight §4.4);
- `ON CONFLICT DO NOTHING` → повторный запуск не создаёт дубль и не перезаписывает существующую строку;
- `RETURNING` пуст ⇔ связь уже была ⇒ этап no-op и rollback (§7) ничего не удаляет;
- запись содержит только `(user_id, role_id)`; `id`, `created_at` заполняются дефолтами; прочие роли (`menedzher` и любые другие) не читаются и не изменяются;
- пароль, `auth.users`, `public.profiles`, tenants/workspaces, entitlements — не затрагиваются.

## 6. After-verification (read-only)

```sql
-- 6.1 Набор ролей после
SELECT r.code
  FROM public.user_roles_v2 ur JOIN public.roles r ON r.id=ur.role_id
 WHERE ur.user_id='37e91f59-e4db-4840-b9c9-e760e634ddd1'
 ORDER BY r.code;

-- 6.2 has_role_v2
SELECT public.has_role_v2('37e91f59-e4db-4840-b9c9-e760e634ddd1','admin')     AS after_admin;      -- true
SELECT public.has_role_v2('37e91f59-e4db-4840-b9c9-e760e634ddd1','menedzher') AS after_menedzher;  -- true

-- 6.3 Сохранность прежних ролей: множественное сравнение
--   after_codes ⊇ before_codes ∪ {'admin'} и after_codes = before_codes ∪ {'admin'}
--   т.е. добавилась ровно одна роль 'admin', ничего не удалено и не изменено.

-- 6.4 Целостность строки menedzher: id/role_id/created_at не изменились
SELECT id, role_id, created_at
  FROM public.user_roles_v2
 WHERE user_id='37e91f59-e4db-4840-b9c9-e760e634ddd1'
   AND role_id='e2ebb443-614b-41eb-85d1-8f088e75535a';
-- ожидается id=72dbebc0-2bcc-4e7c-ae71-1e043ce973ea, created_at=2026-06-26 08:57:45.381458+00
```

Критерий приёмки: 6.1 = before ∪ {'admin'}; 6.2 обе `true`; 6.4 строка menedzher побайтово идентична before-снимку.

## 7. Rollback (условный, только связь этого этапа)

```sql
BEGIN;
SET LOCAL statement_timeout = '15s';

-- Удалить только строку admin для этого user_id.
-- Если admin была до этапа (RETURNING §5 был пуст) — rollback не запускается (no-op).
DELETE FROM public.user_roles_v2
 WHERE user_id='37e91f59-e4db-4840-b9c9-e760e634ddd1'::uuid
   AND role_id='16c9cefc-60a3-4edd-a421-46d556e80257'::uuid
RETURNING id;

COMMIT;
```

Решение о запуске rollback принимается на основании `RETURNING` из §5: непусто ⇒ rollback удаляет ровно одну добавленную связь; пусто ⇒ rollback не запускается. Строка `menedzher` и любые прочие роли не затрагиваются никогда.

## 8. Audit / proof (на русском)

Формируется отчёт `.lovable/discovery/companies-1.0/admin_fixture_1_ajoure_report.md` со следующими секциями:

1. Цель, baseline commit `68c00477…`, статус approve.
2. Discovery-снимок (§2): UUID пользователя, отсутствие профиля, список ролей before, id канонической `admin`.
3. Полные результаты preflight (§4) c пометками PASS/STOP.
4. Точный выполненный SQL (§5) и `RETURNING`-результат (added / already-present).
5. After-снимок (§6): множество ролей, значения `has_role_v2`, подтверждение сохранности строки `menedzher`.
6. Diff before/after: `+admin`, `−<пусто>`.
7. Rollback plan (§7) и решение (executed / no-op) с обоснованием.
8. Заявление, что пароль/`auth.users`/профиль/tenants/entitlements не изменялись.

Репозиторий: изменяется только новый файл отчёта `.lovable/discovery/companies-1.0/admin_fixture_1_ajoure_report.md`. Никаких изменений в `src/**`, `supabase/migrations/**`, `.lovable/plan.md` и прочих файлах. Миграции не создаются (запись выполняется как data-insert, не как schema-migration; UNIQUE-ключ уже существует).

## 9. Порядок выполнения (после отдельного approve)

1. Preflight §4 → PASS или STOP.
2. Insert §5 (одна транзакция).
3. After-verification §6.
4. Формирование отчёта §8.
5. При провале §6 — немедленный rollback §7 и фиксация инцидента в отчёте.

## 10. Наблюдения / открытые вопросы

- `public.profiles` для `37e91f59-…` отсутствует. Это не блокер для `user_roles_v2` (FK идёт на `auth.users`), но фиксируется в §8 как наблюдение. Создание профиля выходит за scope этого этапа и не выполняется.
- Admin-runtime-proof Phase 2 остаётся отдельным follow-up этапом и не входит в этот план.

Запрашиваю отдельный approve на выполнение.