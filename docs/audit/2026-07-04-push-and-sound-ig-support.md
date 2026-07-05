# PATCH-CONTACT-CENTER-PUSH-AND-SOUND-INSTAGRAM-AND-SUPPORT

Дата: 2026-07-04

## Проблема

- Instagram: входящие сообщения (`instagram_messages`) не отправляли browser push админам, звук в открытой вкладке играл только при включённом personal opt-in unified inbox.
- Support: клиентские сообщения (`ticket_messages`) не отправляли push вообще, звук также был скрыт под тем же флагом.
- Telegram работал (см. `supabase/functions/telegram-webhook/index.ts:1397+`) и являлся эталоном UX.

## Изменения

### 1. Instagram — push из manychat-inbound
`supabase/functions/manychat-inbound/index.ts` (блок 8b): после успешной вставки incoming `instagram_messages` (не dedup) — fire-and-forget `POST /functions/v1/send-push-notification`.
- Получатели: `user_roles_v2 × roles.code IN ('super_admin','admin')`.
- Заголовок: `📷 <displayName>`. displayName резолвится из `instagram_contacts.profile_id → profiles` (last+first / last / first / full_name), иначе `@instagram_username`, иначе «Сообщение из Instagram». PII-safe лог (source, account_id, subscriber_id).
- Тело: превью text/media, 100 символов.
- URL: `/admin/communication`.
- `tag: ig-msg-<account>-<subscriber>` — SW склеит повторные уведомления.
- Ошибки только в console.error, 200 к ManyChat никогда не ломается.

### 2. Support — DB trigger → edge → push
Новый edge-function `supabase/functions/ticket-message-notify/index.ts` (`verify_jwt=false`, self-authorizes через `SUPABASE_SERVICE_ROLE_KEY`):
- Читает `ticket_messages` + `support_tickets` + `profiles` автора.
- Собирает `title = 🎧 <Имя>`, `body = TKT-<n>: <preview 100>`, `tag = ticket-<id>`.
- Тем же способом вызывает `send-push-notification` для всех админов.

Миграция `notify_admins_on_ticket_message` — AFTER INSERT trigger на `public.ticket_messages`:
- Игнорирует `is_internal=true` и `author_type <> 'user'` (админы, система).
- Вызывает `net.http_post` в edge-функцию с анон-ключом (как в существующих cron-паттернах).
- Ошибки pg_net заворачиваются в NOTICE — INSERT не откатывается.

### 3. Звук — снят гейт unified inbox
`src/hooks/useIncomingMessageAlert.ts`: убран `useUnifiedInboxFlag`. Один Realtime-канал слушает Telegram + Instagram + `ticket_messages`, играет звук для всех админов. Для тикетов фильтрует `is_internal=true` и `author_type !== 'user'`.

## Файлы

- `src/hooks/useIncomingMessageAlert.ts` — гейт убран, добавлены IG и support события.
- `supabase/functions/manychat-inbound/index.ts` — блок push после вставки.
- `supabase/functions/ticket-message-notify/index.ts` — новая функция.
- `supabase/migrations/*_notify_admins_on_ticket_message.sql` — функция + триггер.

## Проверка

- Смоук edge: `POST /ticket-message-notify {ticket_id:zeros, message_id:zeros}` → `200 {ok:true, skipped:"not_found"}`.
- Триггер зарегистрирован: `pg_trigger.trg_notify_admins_on_ticket_message` = enabled.
- Edge deploy: `ticket-message-notify`, `manychat-inbound` — success.

## DoD

- Клиент пишет в тикет → звук во вкладке админа + browser push `🎧 Имя` + `TKT-N: превью`; повторы склеиваются по `tag=ticket-<id>`.
- Клиент пишет в Instagram → звук + push `📷 Имя` + превью; повторы склеиваются по `tag=ig-msg-<account>-<subscriber>`.
- Внутренняя админская заметка / ответ саппорта в тикете — ни звука, ни push.
- Telegram-путь не менялся.

## Edge cases

- Нет активных подписок в `push_subscriptions` → send-push-notification вернёт `sent:0, reason:no_subscriptions`, ошибок не бросает.
- Ошибка `net.http_post` → NOTICE в Postgres логах, INSERT сообщения не откатывается.
- Дубль ManyChat webhook (23505) → в push-блок не заходим (`inserted?.id` пуст).
