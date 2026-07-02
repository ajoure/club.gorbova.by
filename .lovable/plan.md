# План: гостевые диалоги во всех Telegram-ботах

## Отчет discovery

Как это работает сейчас (сценарий поддержки — gorbovabybot):
- Единая edge function `telegram-webhook` принимает апдейты по URL `.../telegram-webhook?bot_id=<UUID>`.
- Если написал незнакомец, создаётся «гостевой» профиль (`profiles.user_id = NULL`, `source='telegram_bot'`, заполнены `telegram_user_id`, `telegram_username`, имя), сообщение пишется в `telegram_messages` c `user_id = profile.id` (синтетический ключ), гостю уходит ACK «Спасибо, ваше сообщение получено…».
- `get_inbox_dialogs_v1` (миграция 20260630210004) уже включает гостей — фильтр по `profiles.user_id OR profiles.id`, диалоги видно в контакт-центре, `last_bot_id/username/name` возвращаются.
- Ответ админа идёт через `telegram-admin-chat` → берётся токен бота в порядке: явный `bot_id` из UI → `profile.telegram_link_bot_id` → `is_primary=true` → любой активный.

Что уже настроено у остальных ботов (проверено через Telegram `getWebhookInfo`):
- `gorbovabybot` (support, primary) — webhook на `telegram-webhook?bot_id=1a56…` ✅
- `Gorbova_club_bot` — webhook на `telegram-webhook?bot_id=f20f…` ✅
- `gorbova_bot` — webhook на `telegram-webhook?bot_id=6d96…` ✅
- `gorbova_gc_bot` (GetCourse) — **webhook не установлен** ❌

## Реальные пробелы

1. **GetCourse-бот без webhook** — входящие в контакт-центр не попадают, пока URL не зарегистрирован.
2. **Ответ гостю уходит не через тот бот, в который он написал.** Для гостя `telegram_link_bot_id` пустой, поэтому `telegram-admin-chat` падает в fallback на primary (support-бот). Support-бот физически не может доставить сообщение пользователю, который писал, например, в `Gorbova_club_bot` → доставка проваливается с 403 «bot was blocked/chat not found», хотя в UI диалог выглядит рабочим. Именно это ощущение «на других ботах не работает».
3. **`/start` welcome-текст жёстко про «клуб Буква закона»** — приходит на все боты одинаково. Для guest-ACK и welcome стоит подставлять `bot_name` из `telegram_bots`.

## Изменения (add-only, никаких новых сущностей)

### 1. Зарегистрировать webhook для GetCourse-бота
Одноразовый вызов `telegram-bot-actions` action `set_webhook` для `bot_id = 2a676ae6-71f1-49f6-9fe4-f7ec7ce46c01`. URL будет `.../telegram-webhook?bot_id=2a67…`. После этого гости в GetCourse-боте начнут попадать в инбокс тем же путём, что и сейчас в support.

### 2. Запоминать «бот входящего» для гостей
В `telegram-webhook` при создании гостевого профиля (обе ветки: `/start` без токена и обычное private-сообщение) дополнительно писать:
- `telegram_link_bot_id = botId` — тот бот, через который пришло первое сообщение.
- `telegram_link_status = 'guest'` (новое значение семантики — гостевой диалог, не активная привязка настоящего аккаунта). Значение свободно-текстовое, конфликтов с существующей логикой нет: реальные привязки ставят `'active'`, отвязки `'unlinked'`.

Это гарантирует, что при первом же ответе админа `telegram-admin-chat` возьмёт токен именно этого бота, а не свалится в support.

### 3. Резолвер бота у `telegram-admin-chat`: fallback по последнему сообщению
Расширить порядок выбора бота в `telegram-admin-chat` (одна ветка `messages/send`):
- явный `bot_id` из UI → `profile.telegram_link_bot_id` → **новый шаг: `last_bot_id` из последнего входящего `telegram_messages` для этого диалога** → `is_primary` → любой активный.

Это страховка на случай гостей, которые уже успели написать до релиза шага 2, а также для будущих кросс-бот сценариев (гость написал в один бот, потом в другой).

### 4. Guest-ACK и welcome с именем бота
В обеих ветках создания гостя вместо жёсткого «Спасибо, ваше сообщение получено…» и welcome про «клуб Буква закона» — брать `bot_name` из уже загруженной строки `telegram_bots` (в webhook она есть в `botRow`). Тексты:
- ACK: `«Спасибо! Ваше сообщение получено, команда {bot_name} ответит в ближайшее время.»`
- `/start` без токена: короткое приветствие без клубной айдентики, если бот не является клубным (простая проверка: `is_primary` или отсутствие `telegram_clubs.bot_id = tb.id` → нейтральный текст; иначе оставить текущий клубный welcome).

Без создания новых таблиц, RPC, edge functions, cron, UI-компонентов.

## Что НЕ меняем
- `get_inbox_dialogs_v1` — уже поддерживает гостей и мульти-бот.
- Логика ticket-bridge, AI-support, push-уведомлений админам — остаётся `!isGuestProfile` (гости не создают тикетов и не триггерят AI, как и раньше в support).
- Формат `telegram_messages.user_id` (для гостей — `profile.id`).
- Схема `profiles`/`telegram_bots`.

## Тех. детали

Файлы:
- `supabase/functions/telegram-webhook/index.ts` — блоки создания гостя в `/start` (≈975) и в обработчике private-сообщения (≈1069): добавить `telegram_link_bot_id: botId, telegram_link_status: 'guest'` в insert; заменить хардкод ACK/welcome на подстановку `botRow.bot_name` + branch по клубности.
- `supabase/functions/telegram-admin-chat/index.ts` — секция `messages/send` (строки 510–575): между шагами `telegram_link_bot_id` и `is_primary` добавить SELECT последнего `telegram_messages.bot_id` по `user_id = <входящий user_id>` (`direction='incoming'`, `order by created_at desc limit 1`) и, если найден активный бот, использовать его токен.
- Регистрация webhook у GetCourse: одноразовый вызов `telegram-bot-actions` (существующая функция, action `set_webhook`) из админки/скриптом.

Дeploy: `telegram-webhook`, `telegram-admin-chat`.

## DoD
- Запись «гость» появляется в контакт-центре одинаково для всех четырёх ботов после первого сообщения.
- Ответ админа доставляется через тот бот, в который гость написал (проверить в `audit_logs` `webhook_message_received` + успешный `telegram_messages` `direction='outgoing'` с ожидаемым `bot_id`).
- `getWebhookInfo` у всех четырёх ботов возвращает URL на `telegram-webhook?bot_id=<их UUID>`, `last_error_message` пусто.
- Существующие сценарии (реальные привязанные пользователи, AI-support, ticket-bridge, push) продолжают работать без изменений.
