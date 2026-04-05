да, согласен, с учетом правок:

&nbsp;

1. В PATCH 7 добавь ещё один багфикс в live-event-notifications-cron/index.ts для email-ветки: нельзя считать письмо отправленным только по факту invoke('send-email'). Нужно проверить результат вызова и только при успешном ответе ставить status='sent', иначе failed с текстом ошибки.
2. Для proof sent > 0 не используй текущий access rule с несуществующим продуктом как основной сценарий. Оставь его только как proof no_audience. Для положительного proof сделай отдельный тестовый live_stream или временно перевяжи тестовый эфир на существующий продукт/тариф с реальными пользователями. Это нужно явно записать в плане как два разных кейса:  

  - кейс A — no_audience
  - кейс B — sent > 0
3. &nbsp;
4. В proof по Telegram добавь обязательную предварительную проверку:  

  - есть активный telegram_bot
  - у тестового пользователя заполнен profiles.telegram_user_id
  - у выбранного шаблона есть message_text  
  Иначе положительный proof по Telegram будет недостоверным.
5. &nbsp;
6. Для proof source_not_ready не предлагай менять боевой эфир вручную без оговорки. Зафиксируй безопасный сценарий:  

  - отдельный тестовый live_stream
  - выставить provider_source_status='missing' только на нём
  - после proof вернуть состояние обратно или удалить тестовый эфир.
7. &nbsp;
8. В proof дедупликации добавь не только SQL HAVING count(*) > 1 = 0, но и проверку, что число строк в live_event_notification_log не увеличилось после второго запуска cron для того же live_event_id.
9. Для UI-proof notification_settings добавь конкретную проверку совместимости шаблон/канал:  

  - Telegram включён + шаблон без message_text → blocker виден
  - Email включён + шаблон без email_subject/email_body_html → blocker виден
  - после выбора совместимого шаблона blocker снимается
10. &nbsp;
11. В deliverables добавь короткий раздел “Что должно получиться в итоге”:  

  - админ создаёт эфир и источник
  - выбирает шаблон уведомлений внутри карточки эфира
  - система сама уведомляет всех пользователей с доступом
  - пользователь заходит по /live/:slug
  - после завершения по той же ссылке доступен replay  
  Это нужно, чтобы не потерять общий end-to-end смысл спринта за proof-частью.
12. &nbsp;
13. Явно зафиксируй, что recorded_webinar не только не участвует в cron, но и не должен иметь обязательных blockers из live notification logic в карточке эфира.
14. После bugfix telegram_user_id попроси приложить proof:  

  - diff/файл
  - deploy функции
  - ручной вызов cron
  - запись в live_event_notification_log
  - факт доставки хотя бы одному Telegram-пользователю или корректный failed/skipped с reason-кодом.
15. &nbsp;

&nbsp;

&nbsp;

Если хочешь, следующим сообщением соберу тебе уже финальную чистовую версию этого плана одним цельным блоком для вставки подрядчику.

&nbsp;

# План: PATCH 7 — закрывающий proof-пакет + bugfix telegram_chat_id

## Контекст

PATCH 6 по коду принят. Осталось собрать runtime proof и исправить один критический баг, обнаруженный при discovery.

## Discovery: обнаружен баг

В `live-event-notifications-cron/index.ts` строка 250 используется несуществующее поле `telegram_chat_id`:

```
.select('id, email, telegram_chat_id, timezone, first_name')
```

В таблице `profiles` такого поля **нет**. Есть `telegram_user_id` (bigint). В `telegram-mass-broadcast` отправка идёт через `chat_id: profile.telegram_user_id` — это каноническая логика. Cron функция никогда не сможет отправить Telegram, потому что `profile.telegram_chat_id` всегда будет `null`.

## Файлы для изменения


| Файл                                                        | Изменение                                                                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/live-event-notifications-cron/index.ts` | Строка 250: `telegram_chat_id` → `telegram_user_id`. Строка 263: `profile.telegram_chat_id` → `profile.telegram_user_id`. Строка 285: `chat_id: profile.telegram_chat_id` → `chat_id: profile.telegram_user_id` |


## Proof-план (после bugfix + deploy)

### Подготовка тестовых данных

Эфир `3dc1c789` (живой тест) уже опубликован, `platform_status=scheduled`, `source_status=ok`. Но:

- `notification_settings` = null → нужно настроить через UI
- Access rule привязан к продукту `9d0d6de8` (не существует в `products`) и тарифу `a0f9ecc2` → **нет пользователей с подпиской**

Варианты для proof:

1. Перенастроить access rule на существующий продукт с реальными подписчиками (например, `87a8870f` с ~100+ активными пользователями), ИЛИ
2. Использовать текущую настройку — она даст `no_audience`, что само по себе является proof корректной работы канонического resolver'а (продукт не найден → нет подписок → пустая аудитория)

**Оптимальный путь**: оба варианта — сначала proof `no_audience` на текущих данных, затем proof `sent > 0` после корректировки access rule.

### 7A. Proof notification_settings в UI

- Открыть карточку эфира `живой тест`
- Включить уведомления, выбрать шаблон «Еженедельный эфир» (45a7cc92, Telegram), offset 60 мин
- Сохранить
- SQL: проверить `metadata->'notification_settings'`
- Переоткрыть карточку — настройки восстановились

### 7B. Proof readiness blocker

- Включить уведомления без шаблона → показать blocker
- Выбрать шаблон + канал + offset → blocker снят

### 7C. Proof no_audience

- `scheduled_at = now + 30 min`, offset 60 min
- Curl cron → `no_audience > 0` (т.к. продукт не имеет подписчиков)

### 7D. Proof source_not_ready

- Нужен live_stream с `provider_source_status = missing` или `broken`
- Эфир `fabcfd7a` (test-efira): `source_status = null`, `is_published = false`
- Вариант: через SQL временно проставить `provider_source_status = 'missing'` и `is_published = true` на тестовом эфире, или использовать curl с подходящими данными

### 7E. Proof sent > 0 (положительная аудитория)

- Скорректировать access rule эфира на продукт с реальными подписчиками
- Установить `scheduled_at = now + 30 min`
- Curl cron → `sent > 0`
- SQL: `live_event_notification_log` содержит записи

### 7F. Proof дедупликации

- Повторный curl cron → `skipped > 0`
- SQL: `GROUP BY ... HAVING count(*) > 1` → 0 строк

### 7G. Proof отрицательная аудитория

- Показать, что пользователь с другим `tariff_id` (или без подписки к продукту) не попал в лог

### 7H. Proof recorded_webinar

- SQL: `event_type = 'recorded_webinar'` не в notification_log
- Открыть recorded_webinar через /live/:slug → работает

## DoD

1. Баг `telegram_chat_id` исправлен
2. notification_settings сохраняются и восстанавливаются
3. Readiness blocker работает
4. Cron sent > 0 на реальных данных
5. Дедупликация: skipped > 0, SQL confirms
6. No_audience proof
7. Source_not_ready proof
8. Recorded_webinar не затронут