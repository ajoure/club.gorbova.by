PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1

Цель: открытие любого диалога в контакт-центре ощущается «как Telegram» — текст и структура мгновенно, медиа догружается лениво, фон не грузит систему.

## Diagnose (подтверждено кодом и pg_stat_statements)

Открытие чата (`ContactTelegramChat`) блокируется тремя параллельными запросами:

1. **Edge Function `telegram-admin-chat` action `get_messages`** — cold-start 1–5 сек + `SELECT *` (толстый `meta jsonb`) + join `telegram_bots` + `admin_profile`, затем **до 50 signed URL** для медиа с бюджетом 2 сек, затем синхронный `INSERT audit_logs (signed_urls_batch)`. Всё это на критическом пути до первого рендера.
2. **`audit_logs` по `target_user_id + action IN (...)`** — pg_stat_statements: mean **948 мс**, max **6 сек**, 5192 вызова. На `audit_logs (471k строк)` НЕТ ни одного индекса по `target_user_id` → seq scan.
3. **`telegram_logs` по `user_id`** — индекса `(user_id, created_at)` нет; на 18k строк пока терпимо, но добавит десятки мс.

Фон вкладки:
- `INBOX_DIALOGS_QK` крутит `refetchInterval: 30000` + parallel `.in()` на profiles/orders/subs/дважды-профили — жалоба «загрузка всей системы постоянная».

Все три запроса помечены в UI как единый `isLoading = messagesLoading || eventsLoading || billingLoading` → чат «пустой» до самого медленного.

## Scope — что делаем

### 1. Read-path сообщений: DB RPC вместо Edge Function

**Предпочтительный вариант (B в правках)** — новый lightweight SECURITY DEFINER RPC:

```sql
CREATE OR REPLACE FUNCTION public.admin_get_telegram_messages_fast_v1(
  p_user_id uuid,
  p_limit int DEFAULT 50
) RETURNS TABLE (
  id uuid,
  user_id uuid,
  telegram_user_id bigint,
  telegram_bot_id uuid,
  message_id bigint,
  direction text,
  message_text text,
  reply_to_message_id bigint,
  sent_by_admin uuid,
  is_read boolean,
  created_at timestamptz,
  -- нормализованные поля из meta, чтобы НЕ отдавать весь jsonb
  media_type text,
  storage_bucket text,
  storage_path text,
  file_url text,
  file_name text,
  file_size bigint,
  mime_type text,
  duration numeric,
  thumbnail_url text,
  automated boolean,
  source text,
  -- денормализованные join'ы одной строкой
  bot_name text,
  bot_username text,
  admin_full_name text,
  admin_avatar_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ... FROM telegram_messages m
  LEFT JOIN telegram_bots b ON b.id = m.telegram_bot_id
  LEFT JOIN profiles ap ON ap.user_id = m.sent_by_admin
  WHERE m.user_id = p_user_id
    AND has_role(auth.uid(), 'admin')  -- guard внутри SECURITY DEFINER
  ORDER BY m.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_telegram_messages_fast_v1(uuid, int) TO authenticated;
REVOKE EXECUTE ON FUNCTION ... FROM anon;
```

Причины выбрать B, а не сырой прямой SELECT:
- RLS `telegram_messages` не гарантирует admin-read без побочных эффектов; SECURITY DEFINER с внутренним `has_role` — явный и узкий.
- Payload детерминирован; полный `meta jsonb` не уезжает в UI.
- Cold start Edge устранён; PostgREST даёт стабильные 20–80 мс.

Клиент (`ContactTelegramChat.tsx`) заменяет `supabase.functions.invoke("telegram-admin-chat", { action: "get_messages" })` на `supabase.rpc("admin_get_telegram_messages_fast_v1", { p_user_id, p_limit: 50 })`. Дальше собирается `TelegramMessage` в том же shape (media-поля кладём обратно внутрь `meta` при мэппинге, чтобы не переписывать рендер).

Edge Function `telegram-admin-chat` **оставляем** — только для write-путей (`send_message`, `edit_message`, `delete_message`, `fetch_profile_photo`, `bridge_ticket_message`, `process_media_jobs`, `sync_reaction`, …). Action `get_messages` **не удаляем**, просто перестаём вызывать из UI (могут быть внешние вызовы).

### 2. Индексы

Перед и после — `EXPLAIN ANALYZE` на реальных значениях; проверить, что план идёт по index scan.

```sql
-- (a) messages latest N per user — верификация:
--    существующий idx_telegram_messages_user_created(user_id, created_at DESC)
--    покрывает WHERE user_id=? ORDER BY created_at DESC LIMIT 50.
--    Дополнительный индекс НЕ создаём, если EXPLAIN подтверждает использование.
--    Если план идёт seq scan (напр. из-за join'ов) — добавим:
-- CREATE INDEX IF NOT EXISTS idx_telegram_messages_user_bot_created
--   ON public.telegram_messages (user_id, telegram_bot_id, created_at DESC);

-- (b) billing events в открытом чате
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_action_created
  ON public.audit_logs (target_user_id, action, created_at DESC)
  WHERE target_user_id IS NOT NULL;

-- (c) telegram_logs events pills
CREATE INDEX IF NOT EXISTS idx_telegram_logs_user_created
  ON public.telegram_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
```

Индекс (b) — trigram `(target_user_id, action, created_at)` под фактический WHERE `target_user_id=? AND action IN (...) ORDER BY created_at`. Trade-off: +немного места, чуть медленнее INSERT в audit_logs — приемлемо.

### 3. Payload — без полного `meta jsonb`

RPC возвращает нормализованные media-поля (`media_type`, `storage_path`, `file_url`, `mime_type`, …) вместо `meta::jsonb`. Ожидаемое сокращение payload — в 2–5 раз (замер до/после в отчёте).

Полный `meta` доступен по требованию через отдельный точечный запрос (пока такого потребителя в UI нет — не тянем).

### 4. Signed URLs — лениво

- Из edge get_messages выпилен critical path на URL (мы его больше не вызываем на чтение).
- Новый клиентский хук `src/hooks/useSignedMediaUrls.ts`:
  - Вход: массив `{ id, bucket, path, mime, file_name }` только для сообщений, у которых нет уже готового `file_url`.
  - Модуль-уровень кэш `Map<bucket:path, { url, expiresAt }>`, TTL 55 мин (URL живёт 60).
  - In-flight dedupe (`Map<key, Promise>`).
  - Батч по 10 через существующий edge action `get_media_urls` (уже есть в `telegram-admin-chat`) одним HTTP-запросом на пачку.
  - Триггер запроса — только когда message-bubble попадает в viewport (IntersectionObserver в `TelegramMediaBubble` — оборачиваем существующий рендер).
- До прихода URL — placeholder/player shell (уже частично есть) + skeleton.
- Ошибка на конкретном media не валит остальные.

### 5. Audit из critical path — убрать

В `telegram-admin-chat`:
- `INSERT audit_logs (action='signed_urls_batch')` из ветки get_messages удаляется полностью (эта ветка больше не в critical path, но чистим).
- В новом ленивом endpoint (`get_media_urls`) audit — sampled 1% и через `EdgeRuntime.waitUntil(...)` (не блокирует ответ). Ошибки логируем в консоль всегда.

### 6. Loading state (клиент)

`ContactTelegramChat.tsx`:
- `isLoading = messagesLoading` (без `|| eventsLoading || billingLoading`).
- Пилюли-события/billing дорисовываются, когда придут (текущий `sort` в конце уже это допускает).
- Для messages-query: `placeholderData: (prev) => prev`, `staleTime: 60_000`, `gcTime: 10 * 60_000`. Повторное открытие того же диалога — мгновенно из кэша, фон refetch не блокирует.

### 7. Список диалогов

`InboxTabContent.tsx`:
- Убрать `refetchInterval: 30000` для `INBOX_DIALOGS_QK`.
- Оставить/усилить: realtime invalidation (`useInboxRealtimeInvalidation`), `refetchOnReconnect: true`, `staleTime: 30_000`, ручная кнопка refresh (уже есть).
- Safety poll: `refetchInterval: 5 * 60 * 1000` через `useVisibilityPolling` (пауза во вне-фокусной вкладке) — на случай потери realtime канала.

### 8. Prefetch (эффект «как Telegram»)

- В строке диалога `onMouseEnter` / `onFocus` → `queryClient.prefetchQuery(['telegram-messages', userId], …)` с тем же RPC.
- Debounce 120 мс, чтобы не выстреливать при быстром скролле.
- Mobile: после idle prefetch первых **3** видимых диалогов (не 100).
- Prefetch не должен дёргать signed URLs (они всё равно лениво).

### 9. Regression guards (что НЕ ломаем)

- send/edit/delete сообщений — не трогаем (те же edge actions).
- unread-логика и `mark_dialog_read_v2` — не трогаем; проверяем, что открытие диалога помечает read по тому же boundary (`last_message_at`), self-zero баг не возвращается.
- realtime bus (`useInboxRealtimeInvalidation`, coordinator `isSelfMarkActive`) — не трогаем.
- unified IG/support inbox — не трогаем.
- LiveEvents/автовебинары — не трогаем.
- RLS `telegram_messages` — не меняем (доступ идёт через SECURITY DEFINER RPC с внутренним `has_role`-guard).
- Старый edge `get_messages` не удаляем.

## DoD — обязательные замеры (в proof-файл)

Замеры с DevTools Network + `EXPLAIN ANALYZE`, до и после:

| Метрика | Before | After (цель) |
|---|---|---|
| Cold open (без cache), p95 до первого сообщения | 10–15 с | **< 1 с** |
| Warm open (тот же диалог из cache) | ~1–2 с | **< 100 мс** |
| RPC/edge messages query (server-side) | edge cold + 400–800 мс | **< 100 мс** |
| Response size messages | X КБ (весь meta) | **/2…/5** |
| `audit_logs` mean_ms (billing query) | 948 мс | **< 20 мс** (index scan) |
| Signed URLs на critical path | да | **нет** |
| Realtime regression (новое входящее поднимает диалог) | pass | **pass** |
| send / voice / video note / edit / delete / mark-read / unread | pass | **pass** |
| EXPLAIN ANALYZE messages query | — | **Index Scan**, не Seq Scan |

Proof-файл: `docs/audit/2026-07-08-telegram-chat-performance-v1.md` со скриншотами Network-панели, выводом EXPLAIN и before/after размерами.

## Файлы, которые буду менять

- Новая миграция: RPC `admin_get_telegram_messages_fast_v1` + индексы (b), (c). Индекс (a) — только если EXPLAIN покажет seq scan.
- `src/components/admin/ContactTelegramChat.tsx` — переход на RPC, разделение loading state, `placeholderData`/`staleTime`/`gcTime`, интеграция `useSignedMediaUrls`.
- `src/hooks/useSignedMediaUrls.ts` — новый (batch + TTL cache + in-flight dedupe).
- `src/components/admin/communication/InboxTabContent.tsx` — снять 30-сек polling, добавить 5-мин safety poll, prefetch on hover/focus.
- `supabase/functions/telegram-admin-chat/index.ts` — удалить sync audit из `get_messages`; в `get_media_urls` sampled audit через `waitUntil`. Action `get_messages` оставить рабочим (не удаляем).

## Этапы (Diagnose → Plan → Dry run → Execute → Verify)

1. **Diagnose (done в этом плане).**
2. **Dry run**: `EXPLAIN ANALYZE` текущих запросов (messages/audit/telegram_logs) с реальными user_id.
3. **Execute**: миграция (RPC + индексы) → фронт (RPC-вызов, lazy media, split loading) → фронт (inbox polling) → edge (убрать sync audit).
4. **Verify**: замеры по таблице DoD; заполнить proof-файл с before/after.

## Формат финального отчёта

`Отчет о выполненной работе: PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1` — с реальными цифрами по каждой строке DoD (before → after), а не «оптимизировано».
