План: PATCH-CONTACT-CENTER-PUSH-AND-SOUND-INSTAGRAM-AND-SUPPORT

## Diagnose (что сейчас)

Проверил цепочку уведомлений в контакт-центре:

**Telegram (работает):**
- `supabase/functions/telegram-webhook/index.ts:1397-1476` — при входящем сообщении явно дергает `send-push-notification` для всех админов (`super_admin`/`admin`).
- `src/hooks/useIncomingMessageAlert.ts` подписан на `telegram_messages` INSERT (direction=incoming) и играет двухтоновый звук через WebAudio.

**Instagram (пуш не приходит, звук условный):**
- `supabase/functions/manychat-inbound/index.ts` пишет в `instagram_messages`, но `send-push-notification` не вызывает.
- Звук в `useIncomingMessageAlert.ts:55-83` играется, но только при `unifiedEnabled` (personal opt-in unified inbox). Если у сотрудника флаг выключен — тишина.

**Поддержка (пуш не приходит, звук условный, «тихо»):**
- `ticket_messages` вставляются с клиента (`src/hooks/useTickets.ts`), никакого edge-хука нет → `send-push-notification` никогда не вызывается.
- Звук аналогично только под `unifiedEnabled`.

Итог: у Instagram и Support нет push-уведомлений вообще, звук — только у тех, кто включил unified inbox. Пользователь получает сообщение «тихо и не видно».

## Scope

Сделать паритет с Telegram для двух каналов:
1. **Push** админам при новом входящем в Instagram и в поддержку.
2. **Звук** в открытой вкладке админа — всегда, независимо от `unifiedEnabled`.

Вне scope: iOS Safari APNs, per-admin настройки каналов уведомлений, кастомные звуки, «flash toast» (Telegram сейчас без toast — держим паритет).

## Изменения

### 1. Push для Instagram — `supabase/functions/manychat-inbound/index.ts`
После успешной вставки `instagram_messages` (direction=incoming, не дубль) — non-blocking `fetch` к `send-push-notification`:
- `user_ids` — тем же запросом, что и в telegram-webhook: `user_roles_v2` × `roles.code IN ('super_admin','admin')`.
- `title` — `📷 <displayName>`. displayName берётся из связанного `profiles` (first/last/full), иначе IG username, иначе «Сообщение из Instagram». PII-safe лог (source/ids/fallback), без имени/текста.
- `body` — превью (text/caption/`[медиа]`), первые 100 символов.
- `url` — `/admin/communication`.
- `tag` — `ig-msg-<instagram_account_id>` (склеивание уведомлений в одну «стопку» по контакту).

Ошибки push — только console.error, не роняют вебхук (200 к ManyChat остаётся обязательным).

### 2. Push для поддержки — новая DB-триггер + edge helper
`ticket_messages` пишутся с клиента, поэтому серверный хук делаем через триггер:

**Миграция:**
- Функция `public.notify_admins_on_ticket_message()` (SECURITY DEFINER, `set search_path = public`):
  - Срабатывает AFTER INSERT ON `public.ticket_messages`.
  - Игнорирует `is_internal = true` и `author_type IN ('support','admin','system')` — шлём только клиентские входящие.
  - Через `pg_net.http_post` дергает `${supabase_url}/functions/v1/send-push-notification` с service-role Bearer из `vault`/GUC (тот же паттерн, что уже используется в проекте для триггерных вызовов; при отсутствии — падаем в NOTICE, не ломаем INSERT).
  - Payload: `{ notify_kind: 'ticket', ticket_id, message_id }`.
- GRANT/RLS на `ticket_messages` не трогаем.

**Edge `send-push-notification`** — расширяем: если пришёл `notify_kind='ticket'` без готовых `user_ids`, функция сама:
- Тянет ticket (`ticket_number`, `subject`, `user_id`) и message (`content`, `attachments`).
- Резолвит senderName из `profiles` автора (first/last/full).
- Получает `adminUserIds` тем же запросом к `user_roles_v2`.
- Формирует `title = 🎧 <senderName>`, `body = TKT-<n>: <preview 100>`, `url = /admin/communication`, `tag = ticket-<ticket_id>`.
- Дальше — существующая логика рассылки WebPush по `push_subscriptions`.

Такой вариант: (а) не тянет секреты в триггер (только URL + service key), (б) один источник правды для формата заголовка/тела.

Если проектный паттерн для service-key в триггерах отсутствует — фолбэк: заменяем триггер на вызов edge-функции `ticket-message-notify` через `pg_net` без Bearer и внутри неё используем `SUPABASE_SERVICE_ROLE_KEY` из env. Уточним при execute (Dry run по существующим триггерам с `pg_net`).

### 3. Звук в открытой вкладке — `src/hooks/useIncomingMessageAlert.ts`
Убираем гейт `unifiedEnabled` для Instagram и `ticket_messages`. Причины:
- Звук — сигнал «пришло сообщение», не завязан на конкретный UI режим.
- Дубля не будет: моно-ленты IG/Support своего звука не имеют, а Telegram остаётся в отдельном канале `telegram_messages`.
Оставляем фильтр `is_internal=false` для тикетов.

### 4. Проверка/DoD
- Отправить входящее в IG (тестовый ManyChat flow / real) → в открытой вкладке админа: звук; в закрытой/фоне: browser push с `📷 Имя` и превью, клик ведёт `/admin/communication`.
- Клиент пишет в существующий тикет → у админа звук + push `🎧 Имя` + `TKT-N: превью`; повторные сообщения склеиваются по `tag=ticket-<id>`.
- Внутренняя админская заметка (`is_internal=true`) — ни звука, ни push.
- Telegram-поведение не изменилось (тот же канал, тот же путь).
- Отчёт: `docs/audit/2026-07-04-push-and-sound-ig-support.md` — diagnose, изменения, шаги проверки, edge-cases (нет подписок → тихий skip; ошибка pg_net → NOTICE, INSERT не откатывается).

## Технические детали (для инженерного контекста)

- Файлы: `supabase/functions/manychat-inbound/index.ts`, `supabase/functions/send-push-notification/index.ts`, `supabase/migrations/<new>.sql`, `src/hooks/useIncomingMessageAlert.ts`, новый audit doc.
- Никаких изменений в схеме `ticket_messages`/`instagram_messages`, RLS, ManyChat-конфиге.
- Дубли push исключены `tag`-склейкой на уровне ServiceWorker (`showNotification({ tag })` заменяет предыдущее с тем же тегом).
- Триггер AFTER INSERT + `pg_net` — асинхронный, INSERT не блокируется.
