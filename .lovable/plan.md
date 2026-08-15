# План (ревизия 2): PR #315 broadcast-builder — PLAN-ONLY, READ-ONLY

Вердикт: **FAIL (BLOCKED) — требуется один минимальный GitHub-first follow-up PR.** Ничего не изменено, cron не тронут, секреты не созданы, SQL-мутаций не выполнялось.

## 0. Что подтверждено этой ревизией (read-only)
- Managed дерево = `fbfd793ec96866bbcaf5d11137a72292d51f8ed4`, чистое.
- Миграция `20260815105203` в ledger отсутствует.
- Cron job 44 `process-scheduled-broadcasts-every-minute` (каждую минуту, active) шлёт **только anon JWT в открытом виде** в `cron.command`, без внутреннего секрета → после деплоя нового auth-гейта получит 401 и остановит и запланированные, и событийные отправки (очередь `broadcast_automation_deliveries` потребляется тем же диспетчером).

## 1. Vault: есть ли пригодный service-role credential для pg_cron
В `vault.secrets` (значения не читались и не выводятся) есть **5 имён**:
`acq:stripe:stripe_poland:secret_key`, `acq:stripe:stripe_poland:webhook_signing_secret`, `email_queue_service_role_key`, `phase4_worker_shared_secret`, `subscription_charge_cron_secret`.

Технически pg_cron **умеет** собирать заголовок из `vault.decrypted_secrets` во время исполнения без плейнтекста в `cron.command` — это уже используется в job 507, 406, 743, 744 (подстановка подзапросом `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = …`).

Единственный кандидат на роль service-role креденшла — **`email_queue_service_role_key`**. Он **непригоден**: job 507 (`crm-pipeline-automation-tick`) строит из него `Authorization: Bearer` и за последние 2 часа получил **127 ответов 403 с телом `{"ok":false,"error":"forbidden"}`** — это собственный ответ `crm-pipeline-automation-worker` при несовпадении bearer с актуальным service-role ключом. То есть значение в Vault устарело относительно текущего managed ключа (проект перешёл на `sb_secret_*`).

Вывод по п.1: **пригодного service-role креденшла в Vault нет.** Переиспользовать `email_queue_service_role_key` для job 44 запрещено — это воспроизвело бы тот же 403/401.

## 2. (не применимо) 
Так как п.1 отрицательный, версионирование job 44 «поверх существующего секрета» не предлагается.

## 3. HARD STOP + GitHub-first последовательность провижининга (не выполнять сейчас)
Отдельный follow-up PR (предлагаемое имя ветки `codex/broadcast-cron-vault-secret`), 2 файла, без ручного SQL и без передачи значения человеку:

**3.1. Новая версионная миграция** `supabase/migrations/<ts>_secure_broadcast_dispatcher_cron.sql` по уже принятому в репозитории шаблону `20260731091000_harden_subscription_charge_cron.sql`:
1. Идемпотентно создать Vault-секрет **только по имени** `broadcast_dispatcher_cron_secret`, значение генерируется самой БД: `vault.create_secret(encode(gen_random_bytes(32),'hex'), 'broadcast_dispatcher_cron_secret', …)` внутри `DO $$ … IF NOT EXISTS … $$` — плейнтекста в Git нет, значение никто не видит.
2. `CREATE OR REPLACE FUNCTION public.broadcast_dispatcher_cron_secret() RETURNS text SECURITY DEFINER SET search_path = public, vault`, с проверкой `auth.role() = 'service_role'`; `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`.
3. `cron.unschedule('process-scheduled-broadcasts-every-minute')` (если есть) и `cron.schedule` заново с тем же расписанием `* * * * *`, где `headers := jsonb_build_object('Content-Type','application/json','apikey','<anon>','x-broadcast-internal-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='broadcast_dispatcher_cron_secret'))`. В `cron.command` попадает только **имя** секрета; anon-ключ остаётся исключительно как gateway-ключ, не как фактор авторизации.

**3.2. Патч `supabase/functions/process-scheduled-broadcasts/index.ts`:** добавить третий путь аутентификации — сравнение заголовка `x-broadcast-internal-secret` со значением, полученным service-role клиентом через `supabase.rpc('broadcast_dispatcher_cron_secret')`. Существующие пути (точный service key, env `BROADCAST_INTERNAL_SECRET`/`BROADCAST_FORCE_SECRET`) сохраняются без изменений.
Почему так, а не Edge-secret: значение никогда не покидает БД, не требуется ручной перенос в `add_secret`, не появляется рассинхрон «Vault ≠ Edge env» — ровно та поломка, что уже наблюдается у job 507.

Опциональный второй вариант (если вы предпочитаете env): `secrets--generate_secret` → Edge-секрет `BROADCAST_INTERNAL_SECRET` (значение не отображается) + миграция, читающая Vault-секрет того же имени. Он требует ручной синхронизации двух хранилищ и потому не рекомендован. Ни один из вариантов сейчас не создаётся.

**Отдельный follow-up (вне текущего scope, не блокирует #315):** тот же дефект у job 507 — устаревший `email_queue_service_role_key` даёт 403 каждую минуту.

## 4. Замена dry_run-смоука на строго read-only проверки
Принято: `process-scheduled-broadcasts` с `dry_run:true` не read-only (может писать `broadcast_runs` по due-шаблонам) — из плана исключён полностью.
Вместо него:
- **Auth-only пробы** (без тела задач, без секретов): анонимный `POST {}` на `broadcast-audience-preview`, `telegram-send-test` → ожидаем 401 gateway; на `telegram-mass-broadcast`, `email-mass-broadcast`, `process-scheduled-broadcasts` → ожидаем прикладной 401/403 без побочных эффектов (все они отвергают запрос до чтения аудитории и до любой записи), плюс `OPTIONS` → 200/204.
- **Read-only read-back:** ledger содержит `20260815105203`; наличие колонок `trigger_kind`/`education_condition`, констрейнтов `trigger_kind`/`send_mode`/`media_type`; `broadcast_automation_deliveries` count; 2 триггера на `lesson_progress`/`user_lesson_progress`; 4 политики бакета `telegram-media`; `cron.job` строка 44 (`active`, наличие имени секрета в command, отсутствие плейнтекста-секрета); `cron.job_run_details` последних тиков; `net._http_response` за последние минуты — отсутствие 401/403 по диспетчеру; `broadcast_runs` count до/после (должен не измениться на этапе проверок).
- Реальный тестовый message лично Сергею Федорчуку — **только после Publish, только через `telegram-send-test`**, отдельным подтверждённым шагом.

## 5. Полнота DB-изменений (без ad-hoc SQL)
Миграция `20260815105203` покрывает **всё, что нужно для событийных отправок**: колонки `trigger_kind`/`education_condition`, расширение `send_mode` до `+event`, таблица очереди `broadcast_automation_deliveries` (GRANT+RLS+политика+уникальность `(template_id,user_id,event_key)`+частичный индекс), триггеры `queue_lesson_completion_broadcasts` (lesson_progress) и `queue_lesson_response_broadcasts` (user_lesson_progress, homework/form), claim-RPC `claim_broadcast_automation_deliveries` (service_role-only), RBAC-политики шаблонов/прогонов/уроков и политики бакета `telegram-media`, RPC `approve_broadcast_template` и `get_last_broadcast_audit_proof`.

**Чего не хватает — ровно одно:** безопасная авторизация cron job 44 (п.3). Это единственная DB-зависимость запланированных отправок, отсутствующая в версионированных миграциях. Никакого ad-hoc managed SQL вне миграций план не содержит и не допускает.

## Минимальный exact follow-up scope
1. Follow-up PR: 1 новая миграция (Vault-секрет по имени + SECURITY DEFINER getter + пересоздание job 44) и 1 патч `process-scheduled-broadcasts/index.ts` (третий auth-путь через RPC). Больше ничего.
2. После merge — единый EXECUTE: sync точного SHA → применить `20260815105203` → применить follow-up миграцию → деплой 5 функций (`broadcast-audience-preview`, `telegram-send-test`, `telegram-mass-broadcast`, `email-mass-broadcast`, `process-scheduled-broadcasts`) → auth-only пробы и read-only read-back из п.4 → Publish этого SHA → затем ваш UI-proof (ПК+мобильный) и один реальный `telegram-send-test`.

HARD STOP: любое расхождение SHA, попытка `cron.alter_job` вне миграции, любой ad-hoc SQL, плейнтекст секрета в `cron.command`, ненулевой прирост `broadcast_runs` на этапе проверок, 401/403 у job 44 после follow-up.
