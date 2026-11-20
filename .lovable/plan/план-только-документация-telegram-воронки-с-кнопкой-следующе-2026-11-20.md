# План (только документация): Telegram-воронки с кнопкой «следующее сообщение»

Источник: main `7cf2e271f37a5fd04ce1628b6a2d27835a45859b`. Файл `TZ_bot_automation_segments.md` в репозитории не найден, план опирается на поручение. Код, схема, данные, deploy и Publish не трогались.

## Подтверждено в коде
- Кнопки сейчас только URL: `telegram-mass-broadcast/broadcastButtons.ts` (`parseAdditionalTelegramButton`, `telegramUrlKeyboard`), копия есть в `telegram-send-test/broadcastButtons.ts`.
- `telegram-webhook/index.ts`: стр. 515–525 требует точного `x-telegram-bot-api-secret-token`, стр. 537–625 проверяют, что `bot_id` активен. Обработчика `callback_query` и `answerCallbackQuery` нет.
- `telegram-bot-actions` (стр. 192, 264) уже подписывает webhook на `callback_query`. Значит, нажатия уже приходят и сейчас просто игнорируются.
- Аудитория: RPC `resolve_broadcast_audience_user_ids_system` и `resolve_broadcast_audience`, предпросмотр в `broadcast-audience-preview`.
- Учёт доставок: `broadcast_campaigns`, `broadcast_runs`, `broadcast_deliveries`, `broadcast_events`, `_shared/broadcastAnalytics.ts`, плюс журнал `telegram_messages`.
- Интерфейс: `BroadcastsTabContent.tsx`, `BroadcastTemplatesSection.tsx`, `scheduled/ScheduledBroadcastsSection.tsx`.
- Ограничение текущей отправки (стр. 1081–1090): сетевое исключение после запроса записывается как `failed`, а не как «неизвестно». Проверки ответа по тому же запросу нет. Повтор ручным перезапуском может продублировать сообщение.

## Что добавить (узко)
1. Таблицы (одна миграция, RLS для staff, GRANT только service_role и authenticated-staff):
   - `telegram_funnels`: bot_id, статус draft/active/stopped/archived, start_block_id.
   - `telegram_funnel_blocks`: стабильный `block_key`, text, image (существующее хранилище), порядок.
   - `telegram_funnel_buttons`: `target_type` url|next_block, url или target_block_id; CHECK, что задано ровно одно из двух.
   - `telegram_funnel_launches`: снимок фильтров сегмента, actor, bot_id.
   - `telegram_funnel_enrollments`: user_id, funnel_id, launch_id, current_block_id, статус; уникальный частичный индекс «один активный run на пользователя и воронку». Restart — только явное действие, которое завершает старый run.
   - `telegram_funnel_callback_tokens`: opaque random token, в базе хранится только hash; привязка к bot/chat/user/telegram message_id/enrollment/кнопке; used_at.
   - `telegram_funnel_deliveries`: idempotency key `(enrollment, block)`, статус claimed/accepted/failed/unknown.
2. RPC (SECURITY DEFINER, пустой search_path, guard `has_admin_section_access(...,'communication',...)`):
   - `funnel_validate`: стартовый блок есть, все цели в той же воронке, нет висячих ссылок, URL проходит тот же валидатор.
   - `funnel_launch`.
   - `funnel_claim_callback`: атомарно, `FOR UPDATE`. Проверяет token, bot, chat, user, message, active run, что current_block совпадает с блоком кнопки, и что воронка не остановлена. Возвращает следующий блок или отказ.
   - `funnel_stop` / `funnel_archive`: новые переходы запрещаются, старые токены отклоняются.

## Повторно используемые точки входа (новых функций и ботов нет)
- `telegram-mass-broadcast`: новый режим `funnel_launch`. Аудитория через существующий RPC, отправка стартового блока. Обычные разовые рассылки идут прежним путём без изменений.
- `telegram-webhook`: ветка `callback_query` после существующих проверок секрета и бота. Порядок: claim → `answerCallbackQuery` всегда (при отказе — короткий текст) → отправка блока → запись delivery и `telegram_messages`. Ответ webhook — 200, чтобы Telegram не повторял запрос. Повтор того же callback гасится claim/idempotency.
- Общий модуль кнопок: typed-кнопки выносятся в `_shared`, URL-валидатор остаётся прежним.
- Интерфейс: новая вкладка «Воронки» рядом с рассылками. Статистика по блокам и переходам. История — в карточке контакта через `telegram_messages`.

## Отправка при неопределённости
- Таймаут или сетевая ошибка → delivery `unknown`, run не двигается, автоповтора нет. Повторное нажатие той же кнопки отклоняется, пока статус unknown. Разбор вручную.
- Существующее ограничение разовых рассылок (failed вместо unknown) в этот scope не входит. Записывается как follow-up.

## Deploy позже (только по названию)
`telegram-mass-broadcast`, `telegram-webhook`. Без cron, без `telegram-bot-actions`, без Publish до отдельного разрешения, со скриншотами ПК и телефона.

## Тесты (изолированные, без сети)
- Валидатор: url против next_block, висячая цель, отсутствие стартового блока.
- Claim: чужой bot, chat, user или message; токен устаревшего блока; остановленная воронка; двойное нажатие → одна отправка; повтор после unknown заблокирован.
- Dedupe: второй launch не создаёт второй active run; restart закрывает старый run.
- Регрессия: payload разовой рассылки и URL-кнопок совпадает побайтно.
- Webhook: без секрета 401; при callback вызывается answerCallbackQuery; при отказе запись не создаётся.

## Вне scope
Публичная запись в воронку, расписания и cron, ZG27, поддержка, реальные отправки и нажатия.
