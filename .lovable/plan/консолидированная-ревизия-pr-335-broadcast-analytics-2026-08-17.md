# Консолидированная ревизия PR #335 — Broadcast Analytics

Merged SHA подтверждён: managed mirror `HEAD = 985249d75d96bc149d946fade44e21b5583b8b7f`, локальное дерево на этом же коммите (`Merge pull request #335 from ajoure/codex/broadcast-analytics`), рабочее дерево чистое. Base перед merge `c7f559c3` — соответствует. Изменений не вносилось.

## VERDICT: PASS

## Проверенное (read-only)

1. **Применимость миграции `supabase/migrations/20260817143430_broadcast_analytics.sql` (1400 строк).**
   - Ни одной из создаваемых таблиц (`broadcast_campaigns`, `broadcast_deliveries`, `broadcast_delivery_segments`, `broadcast_links`, `broadcast_tracking_tokens`, `broadcast_events`) в схеме нет — конфликтов `already exists` не будет.
   - Все referenced объекты существуют: `broadcast_runs`, `broadcast_templates`, `telegram_bots`, `telegram_messages(direction,bot_id,user_id,created_at)`, `telegram_message_reactions(message_id,emoji)`, `email_inbox(linked_profile_id,from_email,received_at)`, `email_logs(opened_at,clicked_at)`, `orders_v2(reconcile_source,is_deleted,profile_id,user_id,product_id,tariff_id,status)`, `payments_v2(profile_id,user_id,amount,refunded_amount,transaction_type,is_deleted,paid_at,currency,order_id)`, `subscriptions_v2(access_end_at,…)`, `entitlements`, `products_v2`, `tariffs`, `profiles(full_name,email,telegram_username)`.
   - `public.has_admin_section_access(_user_id uuid,_section_code text,_min_level text)` существует — сигнатура вызовов совпадает.
   - `broadcast_runs`: миграция снимает `NOT NULL` с `template_id` и меняет FK `CASCADE → SET NULL` до первого INSERT из RPC — порядок корректен. `ON CONFLICT (idempotency_key)` опирается на существующий `broadcast_runs_idempotency_key_key`. Значения `triggered_by` ('manual'/'scheduled'/'recurring') и `channel` ('telegram'/'email') проходят существующие CHECK-констрейнты; `dispatch_mode` берётся из DEFAULT `'production'`.
   - Новые колонки `campaign_id, accepted_count, delivered_count, opened_count, clicked_count` в `broadcast_runs` отсутствуют — конфликта нет.

2. **RLS / security / PII / публичный трекер.**
   - RLS включена на всех шести новых таблицах; SELECT только для `authenticated` с `has_admin_section_access(...,'communication','view')`; `REVOKE ALL ... FROM PUBLIC, anon`; `broadcast_tracking_tokens` закрыта и от `authenticated` (только `service_role`).
   - Все write-RPC (`analytics_ensure_broadcast_run`, `analytics_snapshot_delivery_segments`, `analytics_apply_delivery_outcomes`, `analytics_record_tracking_event`) — `SECURITY DEFINER`, `search_path = public`, EXECUTE только `service_role`. Read-RPC — только `authenticated` с той же секционной проверкой и `RAISE 42501`.
   - `broadcast-track` (verify_jwt=false) принимает только UUID-токен в пути, не принимает profile_id/email, редирект берётся исключительно из `broadcast_links.original_url` с проверкой протокола http/https — open-redirect отсутствует. Ответ: 1×1 GIF, `no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. HEAD и bot-UA помечаются `is_machine`.

3. **Охват quick/scheduled/recurring/event × Telegram+Email.**
   - Quick (contact center) и test: `telegram-mass-broadcast:783`, `email-mass-broadcast:733` (`sendMode` = manual/test).
   - Scheduled и recurring: `process-scheduled-broadcasts` передаёт `analytics_campaign_id/name/template_id/run_id/send_mode` в оба канала, один campaign на два канала, run_id сохраняется существующий.
   - Event-triggered: тот же диспетчер, `analytics_send_mode: 'event'` → `source='automation'`.

4. **Атрибуция покупок и достоверность сигналов.**
   - Атрибуция считается только по каноническим `payments_v2`/`orders_v2`: `status ∈ (successful, succeeded)`, `NOT is_deleted`, `transaction_type NOT IN (refund, void)`, `amount > 0`, выручка — `amount − refunded_amount`. Last-touch выбирается глобально (`attributed_all`) и лишь затем фильтруется отчётом — фильтр не перевешивает покупку на более старую кампанию. Окно ограничено `campaigns.attribution_window_days` (1..90). Модели `direct_click` и `post_send_assist` разделены.
   - Telegram: `prepareAnalyticsTracking(..., false)` — open-токен для Telegram не создаётся, ложных «прочитано» нет; используется только click/reply/reaction. В email — `true` (пиксель), с явным комментарием в `COMMENT ON COLUMN broadcast_deliveries.first_opened_at`, машинные события отделены (`is_machine`), клик от машины не выставляет `first_clicked_at`.

5. **Гейты.** `npx tsgo --noEmit` — PASS; `src/lib/broadcastAnalytics.test.ts` — PASS 6/6.

## CRITICAL FINDINGS

Нет. Блокеров, требующих правок до релиза, не обнаружено.

## NON-CRITICAL FOLLOW-UPS

1. `analytics_record_tracking_event` (migration, ветка `_event_type='open_signal'`) выставляет `first_opened_at` и инкрементирует `open_count` даже при `_is_machine = true` (Gmail image proxy). Уникальные human-open стоит считать как `broadcast_events WHERE event_type='open_signal' AND NOT is_machine` — по кликам это уже сделано, по open — нет.
2. `event_key` для tracking-событий содержит `crypto.randomUUID()` (`broadcast-track/index.ts`, формирование `eventKey`), поэтому дедупликации повторных загрузок пикселя нет: `open_count` растёт при каждом ре-рендере письма. Ожидаемо для «вероятностного open», но в UI это нужно подписывать как «сигналы», а не «прочтения».
3. В Telegram-тексте ссылки переписываются на `${SUPABASE_URL}/functions/v1/broadcast-track/c/<token>` (`_shared/broadcastAnalytics.ts`, `instrumentTelegramText`). Получатель видит служебный домен; желателен собственный короткий домен для доверия и антиспама.
4. `prepareAnalyticsTracking` создаёт токен на каждую пару (получатель × ссылка). При большой аудитории и множестве ссылок это кратный рост строк — стоит следить за размером `broadcast_tracking_tokens` (TTL 180 дней уже заложен, но авто-очистки нет).
5. На `broadcast_runs` появится вторая по смыслу идентичная SELECT-политика (`broadcast_runs_contact_center_view` рядом с существующей «Communication staff can view broadcast runs») — дубль безвредный, но его стоит консолидировать позже.
6. `broadcast_runs_template_id_fkey` меняется с `ON DELETE CASCADE` на `SET NULL`: удаление шаблона больше не удаляет историю run-ов (желательное поведение, но это изменение семантики — зафиксировать в документации).

## EXACT EXECUTE PLAN

Exact merged SHA: `985249d75d96bc149d946fade44e21b5583b8b7f`.

1. **Preflight.** Подтвердить managed HEAD = `985249d7…`, чистое дерево, паритет non-`.lovable` исходников. Убедиться, что в этот момент не идёт активная рассылка (`broadcast_runs` без записей в статусе выполнения за последние минуты).
2. **Migration (одна).** Применить `supabase/migrations/20260817143430_broadcast_analytics.sql` байт-в-байт, без переписывания.
3. **Read-back после миграции (SELECT-only, без рассылок).**
   - Наличие 6 таблиц + RLS enabled + грантов (`anon` — ноль привилегий).
   - Наличие RPC: `analytics_ensure_broadcast_run`, `analytics_snapshot_delivery_segments`, `analytics_apply_delivery_outcomes`, `analytics_record_tracking_event`, `admin_get_broadcast_analytics`, `admin_get_broadcast_analytics_filters`, `admin_get_broadcast_campaign_recipients`, `admin_get_broadcast_campaign_links`.
   - Наличие 3 триггеров: `capture_broadcast_telegram_reply_trigger`, `capture_broadcast_email_reply_trigger`, `capture_broadcast_telegram_reaction_trigger`.
   - Новые колонки в `broadcast_runs`.
4. **Deploy Edge Functions в этом порядке (5):**
   1. `broadcast-track` (verify_jwt=false),
   2. `telegram-mass-broadcast`,
   3. `email-mass-broadcast`,
   4. `process-scheduled-broadcasts`.
   (`_shared/broadcastAnalytics.ts` деплоится вместе с каждой из функций 2–4.)
5. **Runtime smoke без реальных рассылок и без фикстур.**
   - `GET /functions/v1/broadcast-track/o/00000000-0000-0000-0000-000000000000.gif` → 200 image/gif (неизвестный токен, записи в БД нет).
   - `GET /functions/v1/broadcast-track/c/<невалидный>` → 404 без редиректа.
   - Анонимный `POST /rest/v1/rpc/admin_get_broadcast_analytics` → 401/403.
   - Анонимный `GET /rest/v1/broadcast_deliveries` → пусто/403.
   - Под ролью communication.view открыть раздел аналитики: пустой период отдаёт корректный нулевой отчёт (`campaigns: []`).
6. **Publish frontend** на этом же SHA и визуальная проверка desktop 1280 / mobile 390 раздела «Рассылки → Аналитика».

Никаких изменений данных, секретов, cron, ролей/RLS вне перечисленной миграции, никаких тестовых писем/сообщений и никаких фикстур в план не входит.
