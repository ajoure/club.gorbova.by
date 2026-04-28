да, согласен, с учетом правок:

1. `REPLICA IDENTITY FULL` — сначала проверить, включён ли realtime publication для `telegram_messages`; миграцию делать только если нужна для UPDATE payload.
2. `waitUntil(fetch worker)` — добавить STOP-guard: если worker недоступен, webhook не падает, только audit/log.
3. Для inbox слева лучше не `staleTime=0` как единственный механизм, а optimistic cache update + invalidate fallback.
4. Reply сохранять по Telegram `message_id`, не по DB `id`.
5. Для `send_file` проверить отдельно `sendPhoto/sendDocument`: `reply_parameters` поддерживается обоими, но payload отличается.

Можно выполнять.

&nbsp;

План: устранить три бага контакт-центра Telegram-чата.

## Контекст (что нашёл в коде)

1. **Realtime подписка слабая.** `src/components/admin/ContactTelegramChat.tsx` (строки 512-587) подписан только на `INSERT` `telegram_messages` с фильтром `user_id=eq.<active>`. Нет `UPDATE` (медиа-enrichment, статус прочтения). При активном чате другого контакта новые входящие НЕ обновляют список диалогов слева — `InboxTabContent.tsx` подписан, но `staleTime: 30s` + redux-инвалидаций нет. На скрине у пользователя `[photo]` 22:06 в списке, но не двигается в топ.
2. **Медиа загружается долго.** Поток: webhook → INSERT с `upload_status: pending` → enqueue в `media_jobs` → cron `telegram-media-worker-cron` раз в минуту. Итог: 0-60 сек висит «Загружается». Проверил: текущий pending `media_jobs` — задача от 22:06, всё ещё `pending` в БД. Worker не вызывается мгновенно.
3. **Reply отсутствует в UI.** Колонка `telegram_messages.reply_to_message_id` есть и заполняется в `telegram-webhook` (строки 1099, 1338), но в админке UI её НЕ читает и НЕ рисует quoted-блок. Кнопки «ответить» в `LiveInlineModeration` используются только для webinar-комнат, не для Telegram-чата. Исходящих reply из админки тоже нет — `telegram-admin-chat` не передаёт `reply_to_message_id` в `sendMessage`/`sendDocument`.

## DoD

- Новые входящие/исходящие сообщения появляются в открытом чате за <1 сек без перезагрузки.
- Список диалогов слева переставляет контакт в топ и обновляет превью моментально (через realtime, без поллинга).
- Медиа-сообщение становится «готовым» (preview/скачивание) в среднем за 2-5 сек после прихода (а не 30-60 сек).
- В UI чата виден quoted-блок над сообщением, если оно — ответ; работает в обе стороны (клиент → нам, мы → клиенту).
- Админ может выделить сообщение → «Ответить» → отправить с `reply_to_message_id`; Telegram отрисует quote у клиента.

## Изменения

### 1. Realtime: расширить подписки и добавить UPDATE

**ContactTelegramChat.tsx** (`chat-messages-${userId}`):

- Добавить второй `.on('postgres_changes', { event: 'UPDATE', table: 'telegram_messages', filter: 'user_id=eq.<id>' })` — нужен для подхвата `meta.upload_status: pending → ok` и `file_url` после работы media-worker. Сейчас при UPDATE realtime молчит, поэтому фото и висит.
- На UPDATE — патчить кэш `["telegram-messages", userId]` точечно (merge новой строки в массив по id), без debounced refetch.
- На INSERT — добавлять сообщение в кэш сразу (без полного refetch); refetch остаётся только как фолбэк через 3 сек если строка не пришла.

**InboxTabContent.tsx** (`inbox-messages-realtime`):

- Заменить `staleTime: 30000` для query списка контактов на `0` + invalidate `["inbox-contacts"]` на каждый INSERT/UPDATE `telegram_messages`. Так контакт мгновенно прыгает наверх.
- Добавить лёгкий звук + badge unread сразу через optimistic update в кэше (без круговой перезагрузки сети).

**Миграция БД:**

- `ALTER TABLE public.telegram_messages REPLICA IDENTITY FULL;` — чтобы UPDATE-event содержал `OLD` row и фильтр по `user_id` корректно работал даже при изменении `meta`.

### 2. Быстрая загрузка медиа

**supabase/functions/telegram-webhook/index.ts** (строки 1127-1147, после `media_jobs.insert`):

- После постановки задачи делать `EdgeRuntime.waitUntil(fetch('telegram-media-worker', {limit:1, message_db_id: <id>}))` — fire-and-forget без ожидания. Worker отрабатывает за 1-3 сек, обновляет `meta.file_url + upload_status=ok`, realtime UPDATE доставляет в UI. Cron остаётся как safety net для падений.

**supabase/functions/telegram-media-worker/index.ts:**

- Принимать опциональный `message_db_id` в body — если задан, обрабатывать сразу эту задачу (skip lock window), иначе батч как сейчас.
- Усилить timeout download с потенциальным retry (1 быстрый ретрай при network error до возврата `error`).

**ChatMediaMessage.tsx:**

- Показывать инлайновый preview сразу при `upload_status=pending` если в `meta` уже есть `mime_type=image/*` (placeholder с blur) — UX как в Telegram.

### 3. Reply (в обе стороны)

**UI — ContactTelegramChat.tsx:**

- Добавить hover-кнопку «Ответить» на каждом message-bubble (по аналогии с `LiveInlineModeration`).
- Состояние `replyingTo: TelegramMessage | null` в компоненте; над input показывать quote-блок с превью (имя + первые 60 символов / `[photo]`) и крестиком отмены.
- При отправке передавать `reply_to_message_id: replyingTo.message_id` в edge function.
- При рендере bubble — если `m.reply_to_message_id` есть: найти исходное сообщение в `messages` по `message_id` и нарисовать quote-блок сверху bubble (как в Telegram, с цветной полосой). Клик по quote — scroll-to-message + flash-highlight.

**Edge — supabase/functions/telegram-admin-chat/index.ts:**

- В action `send_message` / `send_file` принять `reply_to_message_id?: number` из body.
- Передать в Telegram API: `sendMessage` / `sendDocument` / `sendPhoto` принимают параметр `reply_parameters: { message_id }` (новый API) или legacy `reply_to_message_id`. Использовать `reply_parameters` с `allow_sending_without_reply: true`.
- Сохранить значение в `telegram_messages.reply_to_message_id` при INSERT исходящего сообщения.

**Webhook — telegram-webhook:**

- Уже сохраняет `reply_to_message_id` (строки 1099, 1338) — оставить как есть. Убедиться, что для всех типов (text/media) оно записывается одинаково. На скриншоте кода вижу две точки сохранения; проверю единообразие при имплементации.

## Технические детали

```text
Webhook (incoming media)              UI (admin chat)
  │                                     │
  ├─ INSERT telegram_messages           │
  │    (upload_status=pending)          │── realtime INSERT ─► add to cache (placeholder)
  │                                     │
  ├─ INSERT media_jobs (pending)        │
  │                                     │
  └─ waitUntil(fetch worker, msg_id) ─► worker
                                         │
                                         ├─ download from Telegram
                                         ├─ upload to storage
                                         └─ UPDATE telegram_messages
                                              (meta.file_url, upload_status=ok)
                                                            │
                                                            └── realtime UPDATE ─► patch bubble (preview)
```

Для reply Telegram отдаёт в webhook `update.message.reply_to_message.message_id` (уже парсится). В исходящих — отправляем `reply_parameters: { message_id: <tg_message_id> }`.

## Файлы

- `src/components/admin/ContactTelegramChat.tsx` — realtime UPDATE, reply UI, рендер quote
- `src/components/admin/communication/InboxTabContent.tsx` — invalidate на realtime
- `src/components/admin/chat/ChatMediaMessage.tsx` — placeholder для pending
- `supabase/functions/telegram-webhook/index.ts` — fire-and-forget worker invoke
- `supabase/functions/telegram-media-worker/index.ts` — direct `message_db_id` mode
- `supabase/functions/telegram-admin-chat/index.ts` — `reply_to_message_id` в send_message/send_file
- Миграция: `REPLICA IDENTITY FULL` для `telegram_messages`

## Верификация после деплоя

1. Открыть чат → отправить с другого Telegram-аккаунта текст → появляется <1 сек без перезагрузки.
2. Прислать фото → placeholder сразу, превью через 2-5 сек.
3. В Telegram свайпнуть «Reply» на нашем сообщении → quote виден в админке.
4. В админке выделить сообщение → «Ответить» → у клиента в Telegram приходит с quote.
5. В списке контактов слева — новый контакт прыгает в топ моментально.