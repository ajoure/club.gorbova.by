# План (PLAN-ONLY, READ-ONLY): follow-up PR #316 — secure broadcast dispatcher cron

Вердикт: **FAIL (BLOCKED — источник недоступен для валидации)**. Ничего не изменено: SQL-мутаций, миграций, деплоя, изменений cron/секретов/данных и Publish не выполнялось.

## 0. Причина FAIL (блокирующая, не дефект кода)
Точный head SHA `ceb27572ccb01de2d28d9e806d85927441347a49` **недоступен из managed-окружения**:
- managed git remote — зеркало Lovable, оно на `fbfd793ec96866bbcaf5d11137a72292d51f8ed4`; `git fetch origin ceb27572…` → `upload-pack: not our ref`, `refs/pull/316/head` отсутствует;
- GitHub-remote/токена в песочнице нет, публичного адреса репозитория в дереве нет.

Поэтому построчная валидация трёх файлов PR (`20260815120000_secure_broadcast_dispatcher_cron.sql`, `process-scheduled-broadcasts/index.ts`, `src/lib/broadcastCronAuthContract.test.ts`) физически невозможна: их содержимого в managed-дереве нет. Чтобы выдать PASS/FAIL по пунктам 1–6, нужен один из вариантов: (а) merge PR в main и managed sync точного merged SHA (тогда ревизия делается по дереву до применения миграции — миграция не применяется автоматически), либо (б) присылка полного diff/содержимого трёх файлов в чат.

## 1. Что подтверждено read-only по managed-каталогу (валидно уже сейчас)
Сигнатуры и права (`pg_proc`):
- `vault.create_secret(new_secret text, new_name text, new_description text, new_key_id uuid) RETURNS uuid`, SECURITY DEFINER, EXECUTE у `postgres`, `service_role`, `supabase_admin`. Вызов из миграции (роль `postgres`) допустим.
- `vault.decrypted_secrets` / `vault.secrets` — чтение доступно владельцу миграции; текущие имена секретов: `subscription_charge_cron_secret`, `phase4_worker_shared_secret`, `email_queue_service_role_key`, 2× `acq:stripe:stripe_poland:*`. Имени `broadcast_dispatcher_cron_secret` **нет** — ветка «создать, если отсутствует» действительно сработает один раз.
- `net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) RETURNS bigint`.
- `cron.schedule(job_name text, schedule text, command text)` и `cron.schedule(schedule text, command text)`; `cron.unschedule(job_name text)` и `(job_id bigint)`.
- **`cron.alter_job` существует только в форме `(job_id bigint, schedule text, command text, database text, username text, active boolean)` — перегрузки по `jobname` нет.** Если миграция вызывает `cron.alter_job(jobname := …)` — это ошибка `function does not exist` и миграция упадёт. Корректны только: `cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='process-scheduled-broadcasts-every-minute'), command := …)` либо пара `unschedule(jobname)` + `schedule(jobname, …)` (шаблон `20260731091000_harden_subscription_charge_cron.sql`).

Состояние цели:
- job **44** `process-scheduled-broadcasts-every-minute`, `* * * * *`, `active = true`, команда всё ещё `net.http_post(... /process-scheduled-broadcasts ...)` с anon-ключом; функций `public.invoke_process_scheduled_broadcasts()` и `public.broadcast_dispatcher_cron_secret()` в БД **нет** (0 из 2).
- Ledger: **нет ни `20260815120000`, ни `20260815105203`** — обе миграции ещё предстоит применить, порядок применения обязателен 105203 → 120000.

## 2. Риски, которые ревизия обязана проверить построчно (после получения файлов)
1. **Роль внутри cron.** Job выполняется от `postgres`, а не `service_role`: `auth.role()` там NULL. Если `public.invoke_process_scheduled_broadcasts()` внутри вызывает service-role-only RPC `broadcast_dispatcher_cron_secret()`, вызов упадёт `42501`, и рассылки встанут. Безопасно: `invoke_…` — SECURITY DEFINER, читает `vault.decrypted_secrets` напрямую, а service-only RPC остаётся только для верификации на стороне edge.
2. **Экспозиция `invoke_…` через PostgREST.** Если у функции есть EXECUTE у `PUBLIC/anon/authenticated`, любой сможет через `rpc/` запустить диспетчер. Требуется `REVOKE ALL … FROM PUBLIC, anon, authenticated;` и без GRANT кому-либо, кроме (при необходимости) `postgres`. Отдельно проверить, что имя функции не попадает в Data API как вызываемая anon.
3. **`SET search_path`** у обеих SECURITY DEFINER функций: `= public, vault` (иначе `vault.decrypted_secrets` не резолвится либо подменяем).
4. **Отсутствие плейнтекста**: в `cron.job.command` должно быть ровно `SELECT public.invoke_process_scheduled_broadcasts();` — ни anon-ключа как фактора авторизации, ни значения секрета. Читаемость: read-back по `cron.job` покажет полную команду.
5. **Идемпотентность одного managed apply**: `DO $$ … IF NOT EXISTS … $$` вокруг `vault.create_secret`, `CREATE OR REPLACE FUNCTION`, `unschedule`-под-`IF EXISTS` перед `schedule`. Двойной `cron.schedule` с тем же jobname допустим (обновляет), но дубль без unschedule по job_id — нет.
6. **Порядок auth в edge**: сначала точный service-role ключ / внутренний env-секрет, затем `x-broadcast-cron-secret` сверяется со значением из service-role RPC, и только затем — путь пользовательского JWT c RBAC. Обязательно: сравнение constant-time-подобное, отсутствие ветки «нет заголовков → продолжить», сохранение существующих путей `BROADCAST_INTERNAL_SECRET`/`BROADCAST_FORCE_SECRET`, и `verify_jwt = false` для функции в `config.toml` (иначе gateway отрежет cron до кода).
7. **Никакого постороннего diff**: ровно 3 файла; любые правки UI/шаблонов/других функций — вне scope и FAIL.

## 3. Точные read-back и no-send smoke после merge (выполнять только в утверждённом EXECUTE)
Read-only SQL:
- `select version from supabase_migrations.schema_migrations where version in ('20260815105203','20260815120000');` → обе строки.
- `select jobid, jobname, schedule, active, command from cron.job where jobid = 44;` → `active=true`, `schedule='* * * * *'`, command ровно `SELECT public.invoke_process_scheduled_broadcasts();`, без секретов.
- `select proname, prosecdef, proconfig, proacl from pg_proc … where proname in ('invoke_process_scheduled_broadcasts','broadcast_dispatcher_cron_secret');` → обе SECURITY DEFINER, `search_path=public, vault`, EXECUTE отсутствует у anon/authenticated/PUBLIC.
- `select name from vault.secrets where name='broadcast_dispatcher_cron_secret';` → 1 строка (значение не читаем и не выводим).
- `select status_code, count(*) from net._http_response where created >= now() - interval '10 minutes' … ` + `cron.job_run_details` по jobid 44 → `succeeded`, HTTP 200, отсутствие 401/403.
- Контрольные счётчики до/после 10 минут: `broadcast_runs`, `broadcast_automation_deliveries` — прирост только по реально due-шаблонам (при их отсутствии — 0).

No-send пробы (без тела задач, без секретов):
- анонимный `POST {}` на `process-scheduled-broadcasts`, `telegram-mass-broadcast`, `email-mass-broadcast` → 401/403 без побочных эффектов; `OPTIONS` → 200/204;
- анонимный `POST rpc/invoke_process_scheduled_broadcasts` и `rpc/broadcast_dispatcher_cron_secret` → 401/404/403, не 200;
- `dry_run` диспетчера **не используется** (не read-only).

Реальный тестовый message Сергею Фёдорчуку — только после Publish, только через `telegram-send-test`, отдельным подтверждённым шагом.

## Минимальный exact follow-up scope
Дать доступ к содержимому PR #316 (merge в main + managed sync точного merged SHA, либо полный diff трёх файлов в чат). После этого выдаётся построчный PASS/FAIL по пунктам 1–6 без каких-либо действий.

HARD STOP: применение любой миграции, `cron.alter_job`/`cron.schedule` вне миграции, любой ad-hoc SQL, деплой функций и Publish до построчной ревизии.
