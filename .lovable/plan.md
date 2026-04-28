## да, согласен, с учетом правок:

1. Для `telegram-send-notification` включить `parse_mode='Markdown'`, но перед этим убедиться, что шаблоны не содержат конфликтных символов, которые сломают Markdown. Если риск есть — использовать `MarkdownV2` только после escape-helper, иначе оставить обычный `Markdown`.
2. `telegram_logs` для `custom/manual_notification` не должны дублировать полный `message_text`, если сообщение уже зеркалится в `telegram_messages`.
3. Дедуп в UI расширить:
  &nbsp;
  - `custom`
  - `manual_notification`
  - `telegram.notification.sent`
  - `SEND_REMINDER`  
  только для `status='success'`.
4. `skipped/failed` события не скрывать.
5. Inline-кнопки в bubble стилизовать как нормальные кнопки под сообщением, не как технические бейджи.

&nbsp;

Можно выполнять.

&nbsp;

План: Чистый ТГ-чат админа — без дублей, с жирным и нативными кнопками

### Diagnose (что реально показывается на скрине)

- **Bubble «💼 *Оплата подписки*…» + pill «custom 28.04 20:55» с тем же текстом** — это один и тот же исходящий админ-месседж, но записанный в **двух** таблицах:
  - `telegram_messages` (источник bubble) — пишется через `logAutomatedTelegramMessage` в `telegram-send-notification`.
  - `telegram_logs` (источник pill) — там же ниже пишется ряд с `action = message_type = 'custom'` и `message_text = тот же текст`.
  - В UI `ContactTelegramChat.isMirroredEvent` дедуплицирует только `SEND_REMINDER` / `manual_notification` / `MANUAL_NOTIFICATION`, поэтому `custom` остаётся как pill → визуальный дубль.
  - `'custom'` отсутствует в `EVENT_LABELS`, поэтому показывается сырой ключ вместо человеческого названия.
- `***Оплата подписки*` отображается со звёздочками вместо жирного** — `telegram-send-notification` отправляет `sendMessage` **без `parse_mode**`. Шаблон в `AdminPaymentLinkDialog.buildTelegramMessage` написан под Markdown — его не парсит ни клиент, ни админ-зеркало.
- **Кнопка "Ссылка на оплату" выглядит как маленький pill, а не как нативная Telegram-кнопка под пузырём** — в `ContactTelegramChat` inline-кнопки рендерятся как тонкие `px-2 py-1 rounded-md` бэйджи, а не как блок-кнопки во всю ширину пузыря в стиле Telegram.
- **«Часто 2 разных сообщения с одним смыслом»** — для напоминаний `SEND_REMINDER` мирор-дедупликатор работает только в окне ±120 с. Если запись `telegram_logs` создаётся раньше/позже bubble (а в `subscription-renewal-reminders` именно так — сначала sendMessage, потом `logAutomatedTelegramMessage`, потом `telegram_logs.insert`), окна может не хватить → админ видит и pill, и bubble.

### Fix

#### 1. Markdown-жирный для админских ссылок (источник «звёздочек у клиента»)

`supabase/functions/telegram-send-notification/index.ts`: в `sendMessage` добавить `parse_mode: 'Markdown'` и аккуратное падение на plain-text при ошибке `400 can't parse entities` (повторный send без `parse_mode`). Это закрывает все админские шаблоны (Payment-Link Dialog, ручные уведомления и др.) без правок UI.

Дополнительно — в `_shared/log-automated-telegram.ts` сохранять `meta.parse_mode = 'Markdown'`, чтобы зеркало в админке знало, как рендерить.

#### 2. Убрать дубль pill «custom …» для админских отправок ссылок

В `ContactTelegramChat.tsx` `isMirroredEvent`:

- Расширить условие зеркалирования: pill скрывается, если соответствующая bubble есть в `telegram_messages` в окне **±5 мин** для **любого** события, у которого:
  - `status === 'success'` И
  - есть `message_text`, который буквально совпадает с `message_text` существующей bubble (нормализуем — trim + collapse whitespace).
- Это закрывает `custom`, `manual_notification`, `SEND_REMINDER` и любые будущие admin-message-type без поддержки в whitelist.

В `src/lib/eventLabels.ts` добавить русские лейблы для оставшихся технических кодов (`custom → "Сообщение от админа"`, `telegram.notification.sent`, `telegram.notification.failed`, `telegram.notification.blocked`) — чтобы при failed/skipped pill всё-таки оставался читаемым.

#### 3. Не писать дубль `telegram_logs` для уже зеркалированной bubble

В `telegram-send-notification` после успешной записи в `telegram_messages` (через `logAutomatedTelegramMessage`) **не** писать также ряд в `telegram_logs` с `action = message_type` для админских ручных типов (`custom`, `manual_notification`). Аудит остаётся в `audit_logs.telegram.notification.sent` (уже пишется выше) — так SOT не размазывается по двум таблицам.

Поведение для service_role / шаблонных уведомлений (`access_revoked`, `reminder_*`, `card_*`) **не трогаем** — для них pill в админке нужен как «системное событие».

#### 4. Нативный Telegram-вид inline-кнопок в bubble

`ContactTelegramChat.tsx` — рендер `urlRows`:

- Кнопки вытянуть на всю ширину пузыря (`w-full justify-center`), увеличить высоту (`h-8`), скруглить как в TG (`rounded-lg`), тонкая разделительная линия сверху от текста (`border-t pt-2 mt-2`).
- В `outgoing` (синий пузырь) — белая полупрозрачная заливка с белым текстом, в `incoming` — `bg-background` с акцентным текстом (как в TG: ссылочные кнопки выделены цветом, не серые).

#### 5. Запретить «два разных сообщения с одним смыслом» от cron-напоминаний

`subscription-renewal-reminders/index.ts`:

- Добавить `parse_mode: 'Markdown'` в `sendMessage` уже стоит — оставить.
- Перенести запись `telegram_logs` для `success` **под флаг** `mirrored_to_telegram_messages = true` (в `meta` уже пишется), но без вставки нового ряда — единственным следом останется bubble + audit. Pill будет создаваться **только** для `skipped`/`failed` (диагностика для админа).
- Это исключает гонку «pill раньше bubble на >2 мин» по построению.

### DoD

- В чате контакта Telegram при отправке ссылки админом видно **ровно один** пузырь от gorbova_support: жирный заголовок, продукт/тариф/стоимость/тип, и под ним — нативная кнопка «💳 Ссылка на оплату» во всю ширину. Никаких pill «custom …» рядом.
- При получении того же сообщения у клиента в Telegram `*Оплата подписки*` рендерится жирным, без литеральных звёздочек.
- Cron-напоминание (`subscription_reminder_*d`): в админке один пузырь с inline-кнопками, без дублирующего pill «SEND_REMINDER».
- Failed/skipped-события напоминаний остаются как pill (с пояснением `· не отправлено` / `· ошибка отправки`) — диагностика не теряется.
- Все технические коды (`custom`, `telegram.notification.*`) при необходимости отображаются по-русски через `EVENT_LABELS`, без сырых строк.

### Verify (после деплоя)

1. `AdminPaymentLinkDialog` → выбрать тариф Gorbova Club → «Создать и отправить в Telegram» → проверить:
  - Bubble: жирный заголовок, кнопка во всю ширину снизу.
  - Нет pill «custom».
  - У клиента в Telegram заголовок жирный.
2. Дождаться cron `subscription-renewal-reminders` (или ручной trigger) → в чате реального подписчика — один пузырь, без `SEND_REMINDER` pill.
3. SQL-проверка после смоука:
  ```sql
   SELECT created_at, action, status, message_text IS NOT NULL AS has_text
   FROM telegram_logs
   WHERE user_id = :uid AND created_at > now() - interval '1 hour'
   ORDER BY created_at DESC LIMIT 20;
  ```
   Не должно быть рядов с `action='custom'` и тем же `message_text`, что и в `telegram_messages`. Должны остаться только success-логи без `message_text` либо failed/skipped с `message_text`.