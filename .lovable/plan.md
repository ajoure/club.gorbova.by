# План: PR #315 broadcast-builder — PLAN-ONLY ревизия

Вердикт: **CONDITIONAL FAIL (BLOCKED)** — код и миграция корректны, но одна production-зависимость (cron диспетчера) сломает запланированные и событийные рассылки сразу после деплоя. Требуется одно дополнительное разрешение пользователя, иначе HARD STOP.

## 1. SHA
Managed рабочее дерево = `fbfd793ec96866bbcaf5d11137a72292d51f8ed4`, дерево чистое. Точная синхронизация **не требуется** (совпадение байт-в-байт).

## 2. Диф PR #315
16 файлов, посторонних задач нет:
- UI: `BroadcastsTabContent.tsx`, `BroadcastTemplatesSection.tsx`, `TelegramMessagePreview.tsx`, `ScheduledBroadcastsSection.tsx`, `BroadcastAuditProofCard.tsx`
- Тесты: `TelegramMessagePreview.test.tsx`, `broadcastEducationContract.test.ts` (5/5 PASS локально)
- Функции: `broadcast-audience-preview`, `telegram-mass-broadcast`, `email-mass-broadcast`, `telegram-send-test`, `process-scheduled-broadcasts`, `_shared/broadcast-guards.ts`, `_shared/broadcastEducation.ts`
- `supabase/config.toml` (+5 блоков verify_jwt)
- 1 миграция `20260815105203_fix_broadcast_builder_rbac_and_media.sql`

Ни миграций-дубликатов, ни изменений платежей/доступов/роутинга/секретов.

## 3. Миграция против managed-каталога
- В ledger версии `20260815105203` **нет** (последняя — `20260814161253`) → применять один раз.
- Все объекты существуют: `broadcast_templates`, `broadcast_runs`, `training_lessons(is_active)`, `lesson_progress(user_id,lesson_id)`, `user_lesson_progress(user_id,lesson_id,block_id,completed_at,response)`, `lesson_blocks(block_type)`, `audit_logs(action,actor_type,actor_label,actor_user_id,meta,entity_type,entity_id)`, функции `has_role_v2(uuid,text)`, `has_admin_section_access(uuid,text,text)`, `has_role(uuid,app_role)`; enum `app_role` содержит `admin`,`superadmin`; бакет `telegram-media` существует (private).
- Констрейнты: новый `media_type` (photo/animation/video/audio/video_note/document) — расширение, текущие значения все NULL (38 строк) → нарушений нет. Новый `send_mode` расширяет старый набор до `+event`; текущие значения только `manual`/`scheduled` → PASS. `status='recurring'` уже разрешён существующим констрейнтом → триггеры совместимы.
- Новые колонки добавляются идемпотентно (`ADD COLUMN IF NOT EXISTS`), таблица очереди — `CREATE TABLE IF NOT EXISTS` c GRANT + RLS + политикой, уникальный ключ `(template_id,user_id,event_key)` и `ON CONFLICT DO NOTHING` дают идемпотентность.
- Деструктивных операций и массовых UPDATE/DELETE нет; `DROP POLICY IF EXISTS` только для политик, пересоздаваемых тут же.
- SQL-синтаксис и `SECURITY DEFINER ... SET search_path = public` корректны; `claim_broadcast_automation_deliveries` доступна только `service_role`, `anon` отозван везде.

## 4. Auth/RLS функций
- `broadcast-audience-preview` (verify_jwt=true): Bearer → `auth/v1/user` → `has_admin_section_access(communication,view)` или admin/super_admin, иначе 401/403 — PASS.
- `telegram-send-test` (verify_jwt=true): та же схема + manage-уровень — PASS.
- `telegram-mass-broadcast`, `email-mass-broadcast` (verify_jwt=false): два пути — внутренний секрет `x-broadcast-internal-secret` для диспетчера и JWT+RBAC для менеджеров; анонимный вызов → 401/403 — PASS.
- `process-scheduled-broadcasts` (verify_jwt=false): принимает только точный service-key (Bearer/apikey) или внутренний секрет, иначе 401 — PASS по безопасности.
- Секрет: `BROADCAST_INTERNAL_SECRET` отсутствует, но код падает на fallback `BROADCAST_FORCE_SECRET`, который существует → внутренний путь рабочий.

## 5. BLOCKER: cron-диспетчер
`cron.job` id=44 `process-scheduled-broadcasts-every-minute` (каждую минуту, active) шлёт **только anon-ключ** в `Authorization`, без `x-broadcast-internal-secret`. Новый гейт вернёт ему **401**, из-за чего перестанут работать:
- запланированные рассылки,
- событийная выдача уроков (очередь `broadcast_automation_deliveries` потребляется этим же диспетчером).

Разрешение (требует вашего явного approve, это не миграция): один точечный `cron.alter_job`/пересоздание job 44 с заголовком `x-broadcast-internal-secret` из существующего секрета (значение не логируется), либо запуск деплоя без этого — тогда HARD STOP.

## 6. Findings
Блокирующих по scope нет. 8 pending findings мониторинга (send-email regex, legacy has_role, CB20 дубль миграции, live-session 502, tariffs.public_title, getcourse instance_id, telegram-revoke-access, amocrm secret) — stale/не связаны с рассылками.

## Точная EXECUTE-последовательность (после approve пункта 5)
1. SHA-sync не требуется (проверить повторно `git rev-parse HEAD` = `fbfd793e…`; расхождение → STOP).
2. Применить ровно одну миграцию `20260815105203_fix_broadcast_builder_rbac_and_media.sql` (managed), read-back: запись в ledger, наличие колонок `trigger_kind`/`education_condition`, таблицы `broadcast_automation_deliveries` (count=0), 4 политик `telegram-media`, констрейнтов media_type/send_mode/trigger_kind, 2 триггеров.
3. Деплой ровно 5 функций: `broadcast-audience-preview`, `telegram-send-test`, `telegram-mass-broadcast`, `email-mass-broadcast`, `process-scheduled-broadcasts`.
4. Обновить cron job 44 заголовком внутреннего секрета; read-back: `has_secret_header=true`, job active, rowcount=1.
5. Build (`vite build`) + целевые тесты (уже 5/5 PASS).
6. Безопасные smoke без отправки: анонимный POST на каждую из 5 функций → ожидание 401/403 (не платформенный JWT-wall для двух JWT-функций — 401 gateway допустим); `process-scheduled-broadcasts` с `dry_run: true` и внутренним секретом → 200 без отправок; read-back `broadcast_automation_deliveries` count и `cron.job_run_details` последних тиков без 401.
7. Publish ровно `fbfd793ec96866bbcaf5d11137a72292d51f8ed4` только после всех PASS; UI-proof (ПК + мобильный) выполняете вы на авторизованной production-сессии.

HARD STOP: расхождение SHA, ошибка миграции, неясный rowcount, 401 у cron после шага 4, любая реальная отправка сообщения, любая генерация кода.
