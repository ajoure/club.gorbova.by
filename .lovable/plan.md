да, согласен, с учетом правок:

1. В `telegram_logs` не показывать как отправленное сообщение события со `status='skipped'`. Для них в UI должен быть статус «Пропущено» / «Не отправлялось», а не «Напоминание о подписке» как будто оно ушло клиенту.
2. Для `status='success'` в `telegram_logs` обязательно сохранять:
  - `message_text`
  - `meta.reply_markup`
  - `meta.payment_url` / `meta.target_url`, если есть ссылка
3. В Контакт-центре приоритет отображения:
  - если есть запись в `telegram_messages` с `message_id` — показывать её как реальное сообщение;
  - `telegram_logs` использовать как системный event только если реального сообщения нет;
  - `skipped/failed` показывать отдельным системным статусом.
4. Не дублировать одно и то же авто-сообщение двумя bubble: `telegram_messages` = сообщение, `telegram_logs` = техсобытие.

Можно выполнять.

&nbsp;

План:

## Diagnose

На скриншоте у Демко Людмилы (`05cd3754…610b`) в чате висит безликая плашка «🔔 Напоминание о подписке 28.04 08:00». Это НЕ запись из `telegram_messages`, а событие из `telegram_logs` (`action='SEND_REMINDER'`).

Проверка в БД:

```
action=SEND_REMINDER, status='skipped',
message_text=NULL,
meta = { days_left:7, fresh_status:'active', reason:'subscription_changed',
         subscription_id:'64c68953…', fresh_access_end_at:'2026-05-05…' }
```

Вывод — два бага:

1. **Сообщение по факту не отправилось** (`status='skipped'`, `reason='subscription_changed'`), но в ленте у админа оно нарисовано как обычное событие — без визуального отличия. Админ видит «событие» которого в Telegram у клиента не было.
2. Даже когда напоминание реально уходит — `telegram_logs` у `SEND_REMINDER` пишется БЕЗ `message_text` и БЕЗ `reply_markup`. Поэтому админу не видно ни текста, ни ссылок, которые ушли клиенту.

Корневая причина: `subscription-renewal-reminders/index.ts` (строки ~493 и ~499) формирует `message`, отправляет его, но в `telegram_logs.insert` не сохраняет ни сам `message`, ни `reply_markup`. При этом `logAutomatedTelegramMessage` для этой функции тоже не вызывается на `SEND_REMINDER` (telegram_messages-зеркало есть только у других reminder-функций).

## План правок

### 1. Edge function `subscription-renewal-reminders`

После успешной отправки напоминания:

- **Зеркалить** в `telegram_messages` через существующий хелпер `logAutomatedTelegramMessage` (`source='subscription-renewal-reminders'`, `automated=true`, сохранить `reply_markup`, `message_id`, `chat_id`). Тогда сообщение появится у админа полноценным bubble с кликабельной ссылкой и бейджем «Авто» (как уже сделано для остальных авто-уведомлений).
- В `telegram_logs.insert` для `SEND_REMINDER` добавить:
  - `message_text` = реальный текст уведомления;
  - `meta.reply_markup` = inline-клавиатура;
  - `meta.payment_url` = прямая ссылка (для быстрой инспекции).
- Для `status='skipped'` сохранять `meta.skip_reason` (уже есть как `reason`) — оставить.

### 2. UI Контакт-центра (`ContactTelegramChat.tsx`, рендер `type==='event'`)

- **Скрывать pill полностью**, если запись зеркалится в `telegram_messages` (есть пара `telegram_messages` с тем же `meta.source` и близким `created_at` ±2 мин на того же `user_id`) — иначе админ увидит и pill, и bubble.
  - Реализация: в момент склейки `chatItems` отфильтровать события `SEND_REMINDER` / `MANUAL_NOTIFICATION` / `RENEWAL_REMINDER`, для которых уже есть `telegram_messages.meta.source` совпадающего типа.
- Если pill всё-таки остаётся (например, `status='skipped'`):
  - Визуально отличать `status='skipped'`: серый кружок ⊘ + подпись «не отправлено» + tooltip с `meta.reason`.
  - При наличии `event.message_text` — раскрывать текст под pill (механизм уже есть, нужен только текст из шага 1).

### 3. Backfill (опционально, не в этом патче)

Существующие записи `SEND_REMINDER` без `message_text` оставить как есть. Новые сразу будут информативными.

## Технические детали

Файлы:

- `supabase/functions/subscription-renewal-reminders/index.ts` — добавить `logAutomatedTelegramMessage` после `sendMessage` + расширить `telegram_logs.insert`.
- `src/components/admin/ContactTelegramChat.tsx`:
  - в `chatItems` отфильтровать дубль pill↔message по `(user_id, source, |Δt|<120s)`;
  - в рендере pill: ветка `status==='skipped'` со своей иконкой, цветом и tooltip.

Используем уже существующий хелпер `supabase/functions/_shared/log-automated-telegram.ts` (без новых таблиц/миграций).

## DoD

1. Тестовое напоминание уходит → у клиента в Telegram сообщение с кнопкой; у админа в чате появляется **bubble** с тем же текстом, кликабельной кнопкой (`target=_blank`) и бейджем «Авто». Дублирующая «pill» НЕ показывается.
2. Если напоминание `skipped` — в чате видно отдельную сухую pill «⊘ Напоминание о подписке — не отправлено (subscription_changed)», без bubble, без ссылок (потому что ничего не уходило).
3. SQL-проверка после ближайшего реального напоминания:
  ```sql
   SELECT message_id, meta->>'source', meta->'reply_markup', message_text
   FROM telegram_messages
   WHERE meta->>'source'='subscription-renewal-reminders'
     AND meta->>'automated'='true'
   ORDER BY created_at DESC LIMIT 5;
  ```
   → есть `message_id`, есть `reply_markup.inline_keyboard[].url`, есть полный `message_text`. Дублей по `(telegram_user_id, message_id)` нет.
4. SQL-проверка `telegram_logs` для нового `SEND_REMINDER` со `status='success'`:
  ```sql
   SELECT message_text, meta->'reply_markup', meta->>'payment_url'
   FROM telegram_logs
   WHERE action='SEND_REMINDER' AND status='success'
   ORDER BY created_at DESC LIMIT 5;
  ```
   → все три поля заполнены.

Подтвердите — выполняю.