да, согласен, с учетом правок:

1. **Добавить в начало корректный заголовок**
  &nbsp;
  Сейчас план начинается правильно по смыслу, но нужно оставить строго:
2. **Не выполнять реальную отправку сообщения реальному клиенту без отдельного подтверждения**
  &nbsp;
  В `send_message` proof сначала использовать:
  - dry-run/validation branch, если есть;
  - либо тестовый Telegram-контакт;
  - либо только runtime-вызов до Telegram API, если можно доказать RBAC и bot readiness без фактической отправки.
  Если тест всё же отправляет сообщение реальному контакту, текст должен быть нейтральным, например:
3. **Обязательно проверить stale deploy как первый вариант**
  До правки кода:
  - сравнить deployed edge version / timestamp;
  - проверить, есть ли в runtime-логах новые поля `hasCommView/hasCommManage`;
  - если runtime всё ещё старый — сначала redeploy `telegram-admin-chat`, затем повторный proof.
4. **Разделить две проблемы в отчёте**
  &nbsp;
  В финальном отчёте отдельно:
  - `get_messages`: почему не отображалась история;
  - `send_message`: почему был generic toast.
  Не смешивать системные события из `telegram_logs` с реальными сообщениями из `telegram_messages`.
5. **Для истории сообщений проверить не только edge, но и frontend merge/render**
  Даже если `get_messages` возвращает 29 строк, нужно проверить:
  - приходят ли они в `ContactTelegramChat.tsx`;
  - не отбрасываются ли при merge с `telegram_logs`;
  - не скрываются ли из-за `message_type`, `direction`, `created_at`, `is_admin_message`;
  - не ломается ли сортировка.
6. **RBAC actor при impersonation — критично**
  &nbsp;
  В `telegram-admin-chat` нужно явно доказать:
  - кто является `auth.uid()` в edge;
  - это admin actor или impersonated user;
  - RBAC-проверка должна применяться к правильному субъекту.
  Если action выполняется из impersonation-сессии пользователя `1@ajoure.by`, у него есть `communication=manage`, это допустимо. Если action должен выполняться от имени администратора — нужно зафиксировать текущую модель.
7. **View-only proof не делать “по матрице” вместо runtime**
  Для security-fix нужен реальный runtime proof:
  - view-only роль вызывает `get_messages` → 200;
  - view-only роль вызывает `send_message` → 403 `communication:manage required`.
  Если нет готовой view-only роли, создать временную `qa.*@gorbova.test` роль через уже существующий helper и удалить/очистить после теста.
8. **Generic toast нужно чинить даже если Telegram API реально вернул ошибку**
  Требование: пользователь должен видеть конкретную причину:
  - `communication:manage required`;
  - `bot was blocked`;
  - `chat not found`;
  - `Forbidden`;
  - `Telegram API unavailable`.
  Не оставлять «Функция временно недоступна» для известных edge/API ошибок.
9. **Не писать секреты в** `telegram_logs`
  При логировании ошибок Telegram:
  - не писать bot token;
  - не писать Authorization headers;
  - не писать service role key/JWT;
  - можно писать `bot_id`, `action`, `telegram_error_code`, `telegram_description`, `user_id`.
10. **Если меняется edge response contract — проверить frontend callers**

Если `telegram-admin-chat` начнёт возвращать `{ ok:false, error_code, description }`, проверить все вызовы:

- `send_message`;
- `edit_message`;
- `delete_message`;
- `get_messages`;
- media actions.

Чтобы не сломать существующие success-path.

11. **DoD дополнить network proof**

В отчёте показать для `get_messages` и `send_message`:

- request action;
- HTTP status;
- response body без секретов;
- frontend toast/result.

12. **После ремонта вернуться к общему треку**

В финальном отчёте явно указать:

```text
telegram-admin-chat runtime: PASS
AdminContacts noAccount runtime: pending/pass
Club membership runtime: pending/pass
PATCH-RBAC-V3-DATA-RUNTIME-FIX: продолжить / закрыть
```

После этих правок план можно выполнять.

&nbsp;

План: PATCH-RBAC-V3-TELEGRAM-RUNTIME-REPAIR

1. **Проблема**

- В `/admin/communication` под impersonation-пользователем `1@ajoure.by` отображаются системные Telegram-события, но не полноценная история переписки.
- `send_message` сейчас даёт generic toast: «Функция временно недоступна…», вместо конкретной причины.
- Scope фиксированный: только runtime коммуникаций Telegram; оставшиеся RPC не трогать.

2. **Диагностика — факты на текущий момент**

- Frontend истории: `src/components/admin/ContactTelegramChat.tsx` вызывает `telegram-admin-chat` с body `{ action: "get_messages", user_id, limit: 50 }`.
- Frontend событий: тот же компонент отдельно читает `telegram_logs` по `.eq("user_id", userId)`; поэтому системные события могут быть видны даже при проблемах `get_messages`.
- Отправка: `ContactTelegramChat.tsx` вызывает `telegram-admin-chat` с body `{ action: "send_message", user_id, message, file, bot_id, reply_to_message_id }`.
- Edge: `supabase/functions/telegram-admin-chat/index.ts` содержит read-set `get_messages/fetch_profile_photo/get_user_info/get_media_urls`; `send_message` не в read-set и обязан требовать `communication:manage`.
- RBAC proof для `37e91f59-e4db-4840-b9c9-e760e634ddd1`: `get_admin_access(...)` возвращает `communication = manage`, а также `contacts/deals = manage`.
- Данные proof: у профиля `1@ajoure.by` есть `telegram_user_id=7766693832`, `telegram_link_bot_id=1a560e98-574e-4fd9-82ab-4b7bbdc300b4`; в `telegram_messages` есть 29 записей, в `telegram_logs` 32 записи.
- Бот proof: `gorbova support` активен, primary, token present.
- Логи edge показывают старые runtime-deny строки `Access denied ... admin=false, superadmin=false` без поля `communication`; это указывает на риск, что deployed/runtime версия функции ещё не совпадает с локальным RBAC v3-кодом или логирование недостаточно различает ветки отказа.

3. **Предлагаемое решение**

- Сначала воспроизвести `get_messages` и `send_message` через edge-function runtime с реальным JWT/preview-сессией или через безопасный impersonation runtime-flow, чтобы получить фактические HTTP status и body.
- В `telegram-admin-chat` сделать точечный repair:
  - оставить `send_message` mutation-only и `communication:manage` gate;
  - добавить явное структурированное логирование RBAC-ветки: actor id, action, hasAdmin, hasSuperAdmin, hasCommView, hasCommManage;
  - для `send_message` возвращать конкретные ошибки Telegram API/body, а не позволять frontend сваливаться в generic `FunctionsHttpError`;
  - обернуть `telegramRequest` так, чтобы сетевые/HTTP/JSON ошибки Telegram возвращали нормализованный объект `{ ok:false, error_code, description }` и писались в `telegram_logs`;
  - не логировать и не возвращать bot token или секреты.
- Во frontend `ContactTelegramChat.tsx` заменить sync-normalizer на async-normalizer для edge errors в отправке, чтобы body non-2xx не терялся и toast показывал конкретную причину (`communication:manage required`, `chat not found`, `bot was blocked`, `Forbidden`, etc.).
- Для истории проверить, не отсекаются ли сообщения из-за `limit=50`, сортировки, join `profiles!telegram_messages_sent_by_admin_fkey`, RLS или несовпадения `user_id`; если root cause в edge fallback/join/RLS — исправить только эту ветку.

4. **Изменяемые компоненты**

- `supabase/functions/telegram-admin-chat/index.ts` — точечная runtime-обработка ошибок, RBAC-логирование, конкретизация ответа `send_message`, проверка `get_messages`.
- `src/components/admin/ContactTelegramChat.tsx` — точечная обработка async edge-error body для отправки/редактирования/удаления при необходимости.
- Возможная migration только если диагностика докажет проблему в RLS/GRANT/policy для `telegram_messages`/`telegram_logs`; новые таблицы/RPC не создавать.

5. **Что не будет изменено**

- Не сканировать и не чинить «оставшиеся RPC».
- Не менять Club membership patch.
- Не менять AdminContacts noAccount patch.
- Не менять роли, назначения ролей и общий RBAC registry.
- Не создавать новые Telegram-таблицы, новые edge-functions или параллельный источник истории.
- Не делать массовые UPDATE/DELETE.

6. **Dry-run**

- Прочитать текущие deployed logs `telegram-admin-chat` по `send_message/get_messages`.
- Выполнить read-only SQL:
  - `get_admin_access('37e91f59-e4db-4840-b9c9-e760e634ddd1')`;
  - counts и последние строки `telegram_messages`, `telegram_logs` по этому user_id;
  - active bot row для `gorbova support` без раскрытия token.
- Вызвать `get_messages` безопасно и проверить, возвращает ли функция 29 сообщений или падает.
- Для `send_message` сначала проверить RBAC/gate и bot/profile readiness; фактическую отправку выполнять только коротким тестовым сообщением, если runtime-тест допустим, иначе ограничиться функцией с dry-run/validation branch при наличии такой ветки.

7. **Execute**

- Внести минимальный patch в edge/frontend по доказанной причине.
- Задеплоить только `telegram-admin-chat` после изменения edge-кода.
- Не запускать миграцию без доказанного RLS/root cause.

8. **STOP-guards**

- Остановиться без patch, если runtime уже работает после деплоя текущей версии и проблема была только stale deploy.
- Остановиться перед любой миграцией, если rowcount/policy diff показывает неожиданные таблицы вне `telegram_messages`, `telegram_logs`, `telegram_bots`.
- Остановиться перед фактическим `send_message`, если нет безопасной сессии manage-роли или тест может отправить сообщение реальному клиенту без подтверждённого тестового контакта.
- Не выводить bot token, service key, JWT, полные секретные headers.

9. **DoD**

- Отчёт строго с заголовком: `Отчет о выполненной работе: PATCH-RBAC-V3-TELEGRAM-RUNTIME-REPAIR`.
- В отчёте есть root cause по истории сообщений.
- В отчёте есть root cause по generic «Функция временно недоступна».
- Указаны изменённые файлы.
- Proof под `1@ajoure.by / Менеджер`:
  - `communication = manage` подтверждён;
  - история сообщений видна или edge `get_messages` возвращает ожидаемые строки;
  - `send_message` работает или возвращает точную Telegram API ошибку без generic toast;
  - view-only роль читает, но не отправляет;
  - manage роль читает и отправляет/получает конкретную Telegram API ошибку.

10. **Риски и зависимости**

- Если Telegram API реально запрещает отправку конкретному пользователю (`bot blocked`, `chat not found`, `Forbidden`), это не чинится кодом; нужно показать точный ответ API пользователю.
- Если проблема в stale deployed edge-function, основной fix может быть redeploy + runtime proof.
- Если нет доступной view-only тестовой роли/пользователя, proof view-only нужно сделать через существующую роль с временным безопасным чтением access matrix, без изменения данных.