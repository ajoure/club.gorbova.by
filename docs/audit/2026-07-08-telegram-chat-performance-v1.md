# PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1 — proof

## Что сделано

1. **DB RPC вместо Edge Function на read-path сообщений**
   Новая `public.admin_get_telegram_messages_fast_v1(p_user_id uuid, p_limit int)`
   — `SECURITY DEFINER`, `SET search_path = public`, guarded внутри через
   `has_role(auth.uid(), 'admin'|'superadmin')`.
   `REVOKE ALL FROM anon`, `GRANT EXECUTE TO authenticated, service_role`.
   Возвращает нужные поля + `meta` (для reply_markup / edited / deleted)
   + денормализованные `bot_name / bot_username / admin_full_name / admin_avatar_url`
   одной строкой.

2. **Индексы**
   ```
   CREATE INDEX idx_audit_logs_target_action_created
     ON public.audit_logs (target_user_id, action, created_at DESC)
     WHERE target_user_id IS NOT NULL;

   CREATE INDEX idx_telegram_logs_user_created
     ON public.telegram_logs (user_id, created_at DESC)
     WHERE user_id IS NOT NULL;
   ```
   Индекс на `telegram_messages(user_id, created_at DESC)` уже существует
   (`idx_telegram_messages_user_created`) — новый не создаём (см. EXPLAIN).

3. **Client (`ContactTelegramChat.tsx`)**
   - `supabase.functions.invoke("telegram-admin-chat", { action: "get_messages" })`
     → `supabase.rpc("admin_get_telegram_messages_fast_v1", …)`.
   - `staleTime: 60_000`, `gcTime: 10 * 60_000`,
     `placeholderData: (prev) => prev` — warm reopen из кэша.
   - `isLoading = messagesLoading` (без `|| eventsLoading || billingLoading`) —
     чат появляется, как только пришли сообщения; пилюли-события догружаются
     параллельно.
   - Ленивая догрузка signed URL для медиа уже была реализована через
     `get_media_urls` (осталась как есть).

4. **Client (`InboxTabContent.tsx`)**
   - Убран `refetchInterval: 30000` на списке диалогов.
   - Оставлена realtime-инвалидация (`useInboxRealtimeInvalidation`);
     safety-poll 5 мин с `refetchIntervalInBackground: false`;
     `refetchOnReconnect: true`.

5. **Edge (`telegram-admin-chat` / ветка `get_messages`)**
   - Удалён синхронный `INSERT audit_logs (action='signed_urls_batch')`
     из critical path (эта ветка больше не вызывается из UI, но код
     остаётся живым для внешних вызовов).
   - Успешно re-deployed.

## Замеры (Diagnose → Dry-run → After)

### Messages latest 50 per user
```
EXPLAIN (ANALYZE, BUFFERS) SELECT m.*, b.bot_name, b.bot_username,
  ap.full_name, ap.avatar_url
FROM telegram_messages m
LEFT JOIN telegram_bots b ON b.id = m.bot_id
LEFT JOIN profiles ap ON ap.user_id = m.sent_by_admin
WHERE m.user_id = '<uuid>'
ORDER BY m.created_at DESC LIMIT 50;
```
- **Execution Time: 0.451 ms** (Index Scan `idx_telegram_messages_user_created`).
- Индекс уже был — доп. индекс не создаём.

### Billing events (`audit_logs`)
```
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, action, created_at, meta FROM audit_logs
WHERE target_user_id = '<uuid>' AND action IN (…13 values…)
ORDER BY created_at ASC LIMIT 50;
```
- **BEFORE** (Parallel Seq Scan): `Execution Time: 8937.033 ms`,
  `Buffers: shared hit=13 823 read=4 825`.
- **AFTER** (Index Scan `idx_audit_logs_target_action_created`):
  `Execution Time: 3.126 ms`, `Buffers: shared hit=5 read=4`.
- **Speedup: ×2 858** (пиковый пользователь).

### Telegram events pills (`telegram_logs`)
```
EXPLAIN (ANALYZE)
SELECT id, action, status, created_at, meta, message_text
FROM telegram_logs
WHERE user_id = '<uuid>' AND action NOT IN ('ADMIN_CHAT_MESSAGE','ADMIN_CHAT_FILE')
ORDER BY created_at ASC LIMIT 50;
```
- **BEFORE** (Seq Scan): `Execution Time: 969.213 ms`.
- **AFTER** (Index Scan Backward `idx_telegram_logs_user_created`):
  `Execution Time: 1.809 ms`.
- **Speedup: ×535**.

## Ожидаемое поведение в UI

| Метрика | Before | After |
|---|---|---|
| Cold open диалога до первого сообщения | 10–15 с (Edge cold + signed URLs + audit + billing 9 с в фоне) | **< 1 с** (RPC 0.5 мс + сеть) |
| Warm reopen того же диалога | 1–2 с | **< 100 мс** (React Query cache) |
| messages query (server) | Edge cold + 400–800 мс | **< 5 мс** |
| Response size | весь `meta`, `SELECT *` + join'ы | сравнимо; главный win — cold-start и signed URLs |
| `audit_logs` billing query | 948 мс mean / 6 с max | **< 5 мс** (index scan) |
| `telegram_logs` events query | 969 мс | **< 5 мс** |
| Signed URLs на critical path | да | **нет** (лениво, viewport-driven) |
| Sync audit из открытия чата | да | **нет** |
| Фоновой refetch списка диалогов | каждые 30 с | **realtime + 5-мин safety** |

## Regression guards (не тронуто)

- send / edit / delete / voice / video_note (все write-actions в `telegram-admin-chat`) — не менялись.
- `mark_dialog_read_v2`, coordinator `isSelfMarkActive`, unread-счётчик — не менялись.
- unified IG / support inbox, LiveEvents, автовебинары — не тронуты.
- RLS `telegram_messages` — не меняли; admin-доступ идёт через SECURITY DEFINER
  RPC с явным `has_role`-guard, `anon` REVOKE'нут.
- Edge action `get_messages` не удалён — просто перестал вызываться UI.
