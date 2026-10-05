План: Instagram monitor (PR #593, ветка codex/instagram-monitor) — PLAN-ONLY

Режим: только чтение. Код, миграции, секреты, deploy и Publish не выполнялись.

## 1. Факты production (прочитано 05.10.2026)

- Владелец окружения: Lovable Cloud, ref `hdjgkjceownmmnrqqtuz` (один инстанс для preview и prod). Legacy `ypwsuumurrtkxatoyqhk` не трогать.
- Синхронизированный HEAD в Lovable: `657d94c1c47200b8b8cfec17e821c5c87a0f1544` (04.10.2026 09:30 UTC). Ветка PR #593 в Lovable не синхронизирована.
- Существующие таблицы Instagram (DM/ManyChat, не мониторинг): `instagram_accounts`, `instagram_contacts`, `instagram_dialog_preferences`, `instagram_messages`. RPC: `get_instagram_dialogs_v1`, `instagram_outbox_pull_v1`, `link/unlink_instagram_contact_to_profile`. Функции: `instagram-webhook`, `instagram-webhook-test`, `instagram-admin-chat`, `instagram-media-proxy`.
- Таблиц/RPC/cron/bucket для мониторинга Reels нет: cron с `insta|apify` — 0, bucket `insta*|monitor*` — 0, `admin_section` с `insta|monitor` — 0. Имена ниже свободны.
- Секреты: `LOVABLE_API_KEY` — есть (managed). `APIFY_API_TOKEN` — нет.
- Шаблон cron: Vault `telegram_summary_cron_secret` + `verify_telegram_summary_cron_secret(_candidate)` + заголовок `x-telegram-summary-cron-secret` (миграция `20260911071000_restore_telegram_summary_cron.sql`).
- RBAC: есть `admin_section` (code, route_prefix, group_code…), `has_admin_section_access`, `get_user_section_access`, `get_section_access_catalog`, `has_role_v2`.
- `_shared/transcribe-audio.ts` шлёт `input_audio` с форматом из `audioFormatFromMime`; MP4 (видеоконтейнер) не проверен в runtime.

## 2. Минимальная схема (одна миграция)

Таблицы (все с GRANT → RLS → policies; запись только service_role):
- `instagram_monitor_targets` (id, username unique, is_active, max_posts, created_by).
- `instagram_monitor_posts` (id, target_id, shortcode UNIQUE, posted_at, caption, metrics jsonb, video_storage_path, video_status, transcript, transcript_status, raw jsonb).
- `instagram_monitor_comments` (id, post_id, provider_comment_id UNIQUE, author_username, text, commented_at, raw jsonb). Upsert `ON CONFLICT DO NOTHING`.
- `instagram_monitor_jobs` — очередь: id, kind (`scrape|download|transcribe`), dedupe_key UNIQUE, status (`queued|leased|done|failed|unknown_outcome`), attempts, max_attempts, lease_owner, lease_expires_at, next_run_at, last_error, payload.
- `instagram_monitor_budget_ledger` — id, period_month, amount_usd numeric(10,4), status (`reserved|committed|released|unknown`), job_id UNIQUE, provider_run_id, created_at.

RPC (SECURITY DEFINER, `search_path=public`, EXECUTE только service_role, кроме чтения):
- `instagram_monitor_claim_jobs_v1(_owner, _limit, _lease_seconds)` — `FOR UPDATE SKIP LOCKED`, возвращает истёкшие leases в очередь (recovery).
- `instagram_monitor_complete_job_v1(_job_id, _owner, _status, _error)`.
- `instagram_monitor_reserve_budget_v1(_job_id, _amount)` — атомарно под `pg_advisory_xact_lock`: отказ, если сумма reserved+committed+unknown за месяц + 0.25 > 4.00; лимит на run 0.25.
- `instagram_monitor_settle_budget_v1(_job_id, _status, _provider_run_id)`.
- `verify_instagram_monitor_cron_secret(_candidate)` по шаблону telegram summary; Vault `instagram_monitor_cron_secret`.
- Чтение для UI: `instagram_monitor_list_posts_v1` с проверкой `has_admin_section_access(auth.uid(),'instagram-monitor')`.

RBAC v3: строка `admin_section` code=`instagram-monitor`, route_prefix=`/admin/instagram-monitor`, доступ по умолчанию только super_admin.

Storage: private bucket `instagram-monitor-media`, без public policy; клиенту только короткие signed URL через функцию после проверки раздела.

## 3. Функции

- `instagram-monitor-cron` — проверка Vault-заголовка до чтения body; ставит `scrape` job на активные targets.
- `instagram-monitor-worker` — claim → выполнение → complete. Только service_role/cron secret.
- `instagram-monitor-admin` — UI-действия (добавить target, ручной запуск, signed URL), guard `has_admin_section_access` до `req.json()`.

## 4. Границы retry и бюджета

- Reserve выполняется ДО HTTP к Apify. Без успешного reserve — запрос не делается.
- Ответ Apify с run id → settle `committed`. Явная ошибка до старта (4xx валидации) → `released`.
- Таймаут/обрыв/5xx при старте run → ledger `unknown`, job `unknown_outcome`, автоповтора НЕТ; деньги остаются учтены; разбор вручную (по Apify run list).
- Download/transcribe — без затрат Apify: до 3 попыток, backoff 5/30/120 мин; lease 10 мин.
- Комментарии: free Actor отдаёт максимум 15 на пост — фиксировать как ограничение, не как полноту.

## 5. Проверка Gemini (до включения transcribe)

- Модель `google/gemini-2.5-flash` через Lovable AI Gateway, существующий `_shared/transcribe-audio.ts`.
- Один реальный прогон на уже скачанном MP4 пилота: зафиксировать HTTP статус, формат, непустой транскрипт.
- Если `mp4` в `input_audio` отклоняется — STOP; варианты: извлечь аудиодорожку на стороне Apify/внешнего сервиса или передать как видео-вход. Не обещать работу без доказательства.
- Лимит размера файла и 402/429 Gateway → job `failed` без ретрая на 402.

## 6. Критерии перед Publish

1. GitHub checks PASS, PR merged, Lovable синхронизирован на точный merged SHA.
2. Миграция применена; read-back: 5 таблиц, RLS on, GRANT есть, bucket private, admin_section есть, Vault секрет есть, cron job active.
3. RLS: anon и обычный пользователь — 0 строк/403; super_admin — видит.
4. `APIFY_API_TOKEN` добавлен пользователем через защищённую форму.
5. Реальный E2E на `katerina.gorbova`: 1 run, ledger committed 0.25, посты upsert по shortcode, повторный запуск не плодит дубли (counts неизменны), комментарии по provider_comment_id без дублей, MP4 в private bucket, транскрипт получен или явно помечен failed.
6. Recovery: искусственно истёкший lease возвращается в очередь; unknown_outcome не повторяется.
7. Бюджет: 17-й reserve в месяце отклоняется.
8. После Publish — скриншоты раздела на ПК и мобильном по опубликованному URL с SHA.

## Открытые вопросы

- Частота cron (предлагается 1 раз в сутки, ≤16 run/мес укладывается в $4).
- Хранить ли MP4 бессрочно или чистить через N дней.
