## да, согласен, с учетом правок:

1. **Статусы активного тикета должны соответствовать реальной схеме.**
  &nbsp;
  В предыдущем discovery по `support_tickets.status` было:
  ```text
  open, in_progress, waiting_user, resolved, closed
  ```
  В плане сейчас указано:
  ```text
  open, pending, in_progress
  ```
  `pending` может не существовать. Нужно использовать фактический набор:
  ```sql
  status IN ('open', 'in_progress', 'waiting_user')
  ```
  Перед миграцией подтвердить `CHECK constraint` ещё раз.
2. **Dedupe должен идти по** `profile_id`**, не по** `user_id`**.**
  &nbsp;
  В предыдущем патче dedupe уже был утверждён как канон по `profile_id`, потому что `support_tickets.profile_id NOT NULL`, а `user_id` nullable.
  Для RPC:
  ```sql
  WHERE profile_id = p_profile_id
    AND status IN ('open', 'in_progress', 'waiting_user')
    AND merged_into_ticket_id IS NULL
  ORDER BY updated_at DESC
  LIMIT 1
  ```
  `profiles.user_id` нужен для доставки клиенту и создания тикета, но не как основной ключ dedupe.
3. **При найденном активном тикете не вставлять сообщение — согласен.**
  &nbsp;
  Это правильно: если тикет уже есть, кнопка должна просто открыть существующий `TicketChat`. Первое сообщение администратора должно отправляться уже через стандартный composer тикета, а не скрыто внутри RPC.
  Но тогда `p_description` не должен быть обязательным при `created_new=false`.
4. **При создании нового тикета лучше создать системный/начальный тикет без сообщения администратора или с первым сообщением? Нужно выбрать один UX.**
  &nbsp;
  В плане написано:
  ```text
  создаёт support_tickets + первый ticket_messages от имени админа
  ```
  Это означает, что клиент сразу увидит первое сообщение. Это допустимо, но тогда dialog должен требовать `p_description`.
  Если UX — “создать тикет и сразу писать в composer”, тогда RPC не должен создавать первое сообщение и не должен ставить `has_unread_user=true` до отправки.
  Рекомендую для V1:
  ```text
  Dialog требует тему + первое сообщение.
  RPC создаёт тикет + первое публичное сообщение от support.
  has_unread_user=true.
  ```
  То есть админ действительно “пишет клиенту”, а не просто создаёт пустую карточку.
5. `author_type` **в** `ticket_messages` **должен быть валидным.**
  &nbsp;
  В discovery было:
  ```text
  ticket_messages.author_type CHECK: user | support | system
  ```
  Для первого сообщения админа использовать:
  ```sql
  author_type = 'support'
  author_id = auth.uid()
  author_name = profile/full name админа, если есть доступный источник
  is_internal = false
  is_read = false
  ```
  Не использовать `admin` как `author_type`.
6. **Permission check уточнить по реальному backend-контракту.**
  &nbsp;
  В плане:
  ```sql
  has_role(auth.uid(), 'admin') OR has_permission(auth.uid(), 'support.manage')
  ```
  Нужно проверить, что `has_role` принимает именно текущий enum/string. В проекте уже всплывали различия `superadmin` / `super_admin`.
  Безопаснее использовать существующий паттерн из support/admin RPC:
  ```sql
  has_permission(auth.uid(), 'support.manage')
  OR has_permission(auth.uid(), 'admins.manage')
  ```
  Если `has_role('admin')` реально используется в проекте — можно оставить, но только после grep/proof.
7. **Нужен advisory lock по** `profile_id`**.**
  &nbsp;
  Чтобы два админа одновременно не создали два тикета:
  ```sql
  PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::text));
  ```
  До поиска активного тикета.
8. **Валидация** `p_attachments`**.**
  &nbsp;
  Как в клиентском `create_support_ticket`:
9. **Валидация** `p_subject` **и** `p_description`**.**
  &nbsp;
  Для создания нового тикета:
  - `subject` обязателен;
  - `description` / first message обязателен;
  - category default `general`.
  Для существующего тикета:
  - `subject/description` можно игнорировать, если UX открывает существующий тикет без отправки нового сообщения;
  - либо если dialog always sends first message, то при existing нужно не создавать тикет, но можно добавить message в существующий. Однако план говорит “никаких INSERT в ticket_messages” при existing.
  Нужно зафиксировать:
10. `has_unread_user=true` **ставить только если создано первое публичное сообщение.**

Для new ticket с первым сообщением админа:

```sql
has_unread_user = true
has_unread_admin = false
```

Для existing ticket без нового сообщения:

- unread flags не менять.

11. `AdminInitiateTicketDialog` **должен менять текст кнопки при existing ticket.**

Если канал support уже существует:

- не показывать dialog;
- ChannelPicker просто переключает на Support.

Если канала нет:

- показывать dialog “Создать обращение в техподдержку”;
- после submit создаётся тикет и первое сообщение.

12. **ChannelPicker должен различать три состояния Support.**

```text
support exists in grouped row → enabled, opens active support channel
support exists for profile but absent in current source filter/list → enabled, refetch/select support
no active support but profileId + userId exists → enabled create
no profileId or no userId → disabled
```

Сейчас план говорит только “если profileId есть”. Нужно добавить проверку `profile.user_id`, иначе клиент не увидит кабинетный тикет.

13. **Не использовать** `useUnifiedInbox` **как единственный источник active ticket.**

После V3 grouping и source filters support-channel может быть не в текущей строке из-за фильтра или stale cache. Для кнопки Support нужен `useProfileChannels` / отдельный lightweight query, который проверяет открытый тикет по `profile_id`.

14. **После создания тикета нужно правильно встроить его в grouped row.**

`onCreated(ticketId)` должен:

- invalidate `unified-support-tickets`;
- invalidate `unified inbox`;
- invalidate `profile-channels`;
- после refetch найти grouped row `profile:<profileId>`;
- установить `activeSourceByKey[profile:<id>] = 'support'`;
- не создавать отдельную строку `support:<ticketId>`.

15. **Если refetch не успел, нужен temporary pending support channel или loader.**

После RPC пользователь должен сразу видеть понятное состояние:

```text
Создаём обращение...
Загружаем чат техподдержки...
```

Не оставлять правую панель пустой, если `support` ещё не появился в grouped row.

16. `TicketChat` **должен открываться по** `ticketId`**, даже если строка ещё не пришла.**

Если существующая архитектура требует `sourceRow`, добавить адаптер:

```text
activeSource=support + pendingTicketId → render TicketChat(ticketId)
```

Без отдельного `useTicketById` можно попробовать через refetch, но fallback должен быть описан.

17. **Нужен audit/log для admin-created ticket.**

Если есть `audit_logs`, записать:

```text
support_ticket.admin_opened
profile_id
ticket_id
created_new
admin_user_id
```

Если audit инфраструктуру не используем — явно указать `audit deferred`, но лучше добавить, так как это действие от имени администратора.

18. **Не смешивать с клиентским** `create_support_ticket`**.**

Новый RPC не должен менять существующий клиентский путь. Клиентский `create_support_ticket` уже дедуплицирует новые обращения — не трогать.

19. **Frontend toast.**

- New: `Обращение создано, первое сообщение отправлено клиенту`
- Existing: `Открыто существующее обращение #...`

Не писать “создано”, если `created_new=false`.

20. **Proof должен включать SQL-проверку.**

В audit добавить:

```sql
SELECT id, ticket_number, profile_id, user_id, status, has_unread_user, has_unread_admin
FROM support_tickets
WHERE profile_id = '<profile_id>'
ORDER BY created_at DESC;

SELECT author_type, author_id, message, is_internal
FROM ticket_messages
WHERE ticket_id = '<ticket_id>'
ORDER BY created_at ASC;
```

21. **Non-admin test должен быть реальным.**

Если нет UI-сессии non-admin, сделать SQL/RPC proof через JWT/role test. Если невозможно — статус `PARTIAL`, не PASS.

22. **Проверить, что клиент реально видит новый тикет.**

DoD “клиент видит сообщение” обязателен:

- `/support` клиента показывает тикет;
- первое сообщение видно;
- unread для клиента выставлен.

Если нет доступа к клиентской сессии — сделать DB proof + отметить UI client proof pending.

23. **Feature flag / opt-in.**

UI-кнопка живёт только в unified inbox, значит она доступна только при opt-in/unified. Это ок. Но RPC backend не должен зависеть от frontend flag; он должен защищаться permission-check.

24. **Proof-файл:**

```text
docs/audit/2026-07-04-admin-initiate-support-ticket.md
```

25. **Итоговый отчёт:**

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-ADMIN-INITIATE-SUPPORT-TICKET
```

26. **Финальный статус:**

```text
Admin can initiate support ticket from unified contact row — PASS
Existing active ticket — reused
New ticket — created with first support message
Client visibility — PASS / pending proof
Telegram/Instagram unchanged
```

После этих правок план утверждён. Выполнять отдельно, не трогая Telegram/Instagram и клиентский `create_support_ticket`.

&nbsp;

Проблема

В карточке контакта (unified inbox) кнопка «Техподдержка» задизейблена с тултипом «Канал не привязан к контакту», даже когда у контакта есть `profileId`. У администратора нет способа инициировать обращение техподдержки на клиента из контакт-центра.

Причина: `ChannelPicker` считает канал «отсутствующим», если у контакта нет ни одного `support_ticket`, и просто блокирует переключение. RPC `create_support_ticket` создаёт тикет только для `auth.uid()` — то есть от имени текущего пользователя, а не для выбранного контакта.

## Что нужно сделать

Позволить админу из карточки контакта в контакт-центре открыть/создать support-тикет на этого клиента и сразу писать во внутренний чат тикета — так же, как в Telegram/Instagram.

## Scope

Только Support-канал в unified inbox для админов с правом `support.manage`. Telegram/Instagram/moderation-политики/24h-окно/UX-текст «3031» — вне scope.

## План

### 1. RPC `admin_create_or_get_support_ticket_for_profile`

Новая SQL-функция (security definer):

- Параметры: `p_profile_id uuid`, `p_subject text`, `p_description text`, `p_category text default 'general'`, `p_attachments jsonb default '[]'`.
- Проверка: `has_role(auth.uid(), 'admin') OR has_permission(auth.uid(), 'support.manage')`, иначе `error_code='forbidden'`.
- Резолвит `v_user_id := profiles.user_id where id = p_profile_id`; если пусто — `error_code='profile_has_no_user'`.
- Dedupe: если у `v_user_id` есть активный (status in ('open','pending','in_progress')) тикет — возвращает его (`created_new=false`), никаких `INSERT` в `ticket_messages`.
- Иначе создаёт `support_tickets` + первый `ticket_messages` от имени `auth.uid()` (админа) с `is_internal=false`, помечает `has_unread_user=true`.
- Возвращает `{ success, ticket_id, ticket_number, created_new, status }`. GRANT EXECUTE TO authenticated.
- Миграция + GRANT в одном файле по правилам public-schema.

### 2. UI: `ChannelPicker`

- Для source `support`: если `contact.profileId` есть и канала нет — кнопка НЕ disabled, а с состоянием «create»: тултип «Создать обращение техподдержки», onClick → открыть `AdminInitiateTicketDialog`.
- Для telegram/instagram поведение прежнее (disabled + «Канал не привязан»).
- Одинокая строка без `profileId` — support-опция остаётся скрытой (как сейчас).

### 3. Компонент `AdminInitiateTicketDialog`

Новый файл `src/components/admin/communication/unified/AdminInitiateTicketDialog.tsx`:

- Props: `open`, `onOpenChange`, `profileId`, `displayName`, `onCreated(ticketId)`.
- Поля: категория (те же 8, что в `CreateTicketDialog`), тема, первое сообщение.
- Submit → `supabase.rpc('admin_create_or_get_support_ticket_for_profile', {...})`.
- onSuccess → toast «Обращение создано / открыто существующее #N» → `invalidateQueries(['unified-inbox'])` + `['unified-support-tickets']` + `['admin-tickets']` → `onCreated(ticketId)`.

### 4. Интеграция в `UnifiedInboxView`

- Прокинуть в `ChannelPicker` колбэк `onRequestCreateSupport(contact)`.
- Внутри `UnifiedInboxView` держать локальный state `initiateFor: UnifiedContactRow | null`, рендерить `AdminInitiateTicketDialog`.
- В `onCreated(ticketId)`: после инвалидации выставить `activeSourceByKey[contact.groupKey] = 'support'`, чтобы правая панель сразу переключилась на новый `TicketChat`.

### 5. Proof (`docs/audit/2026-07-04-admin-initiate-support-ticket.md`)

- Скрин: кнопка «Техподдержка» активна с тултипом «Создать обращение».
- Скрин: диалог, отправка, тост «Обращение создано».
- Скрин: правая панель = `TicketChat` нового тикета, бейдж «Техподдержка» появился в шапке.
- Скрин: повторный клик у того же контакта → «открыто существующее #N», TicketChat тот же.
- DoD:
  - Админ может инициировать support-тикет из карточки любого контакта с `profileId`.
  - Dedupe: активный тикет не задваивается.
  - Non-admin не может дёрнуть RPC (`forbidden`).
  - Telegram/Instagram кнопки и остальной инбокс не изменились.
  - Типизация/сборка проходят.

## Технические детали

- RPC пишется по правилу public-schema (CREATE TABLE-стилю не подходит, но GRANT EXECUTE обязателен). RLS `support_tickets`/`ticket_messages` не меняются — RPC security definer.
- `profiles.user_id` — источник владельца тикета (единственно верное поле).
- Никаких изменений в `useUnifiedInbox`: как только появится строка `support_tickets` для этого `user_id`, следующий рефетч `unified-support-tickets` подтянет канал внутрь того же `profile:<id>` группового ряда автоматически.
- Feature flag не нужен — фича живёт под уже включённым `useUnifiedInboxRolloutStatus`.

## Вне scope

- IG 24h-окно и UX-текст ошибки 3031.
- Массовые/шаблонные обращения, категории сверх текущих 8.
- Изменения политики RLS support-таблиц.
- Cross-channel merged history.