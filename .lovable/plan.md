да, согласен, с учетом правок:

1. **План слишком большой и содержит опасную DB-логику. Разделить на 3 патча.**
  &nbsp;
  Нельзя одновременно делать:
  - новые поля pin/fav;
  - фильтры;
  - физический анти-дубль тикетов;
  - админское создание тикета;
  - изменение клиентского `useCreateTicket`;
  - trigger, который отменяет INSERT.
  Утверждённый порядок:
  ```text
  PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-FILTERS-AND-ACTIONS
  PATCH-CONTACT-CENTER-SUPPORT-TICKET-DEDUPLICATION
  PATCH-CONTACT-CENTER-ADMIN-START-SUPPORT-TICKET
  ```
  Сначала — безопасные unified-фильтры и pin/fav. Потом отдельно — dedupe тикетов. Потом отдельно — админ инициирует тикет.
2. **В текущем патче выполнять только filters/actions.**
  Первый патч:
  ```text
  PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-FILTERS-AND-ACTIONS
  ```
  Scope:
  - `instagram_dialog_preferences.is_favorite`;
  - `support_tickets.is_pinned`;
  - capabilities all three sources;
  - hover actions all three sources;
  - фильтры `Все / Новые / Избранное / Закреплённые`;
  - counters;
  - persistence after refresh;
  - no support dedupe;
  - no admin-created ticket.
3. **Физический анти-дубль тикетов через UNIQUE INDEX + trigger НЕ принимать в этом виде.**
  &nbsp;
  Особенно опасный пункт:
  ```text
  BEFORE INSERT trigger возвращает NULL и вставляет ticket_messages
  ```
  Это рискованно, потому что:
  - frontend может ожидать созданную строку тикета;
  - Supabase `.insert().select().single()` может сломаться;
  - будет неочевидное поведение “создали тикет, но insert отменён”;
  - trigger начнёт писать сообщения от имени пользователя при любой вставке тикета;
  - можно получить дубль/гонку при параллельных вставках;
  - можно сломать существующий `/support`.
  Для dedupe нужен отдельный discovery и отдельный RPC, а не скрытый trigger.
4. **Support dedupe делать отдельной задачей через явный RPC, не trigger.**
  Следующий патч должен быть:
  ```text
  PATCH-CONTACT-CENTER-SUPPORT-TICKET-DEDUPLICATION
  ```
  Предпочтительная модель:
  - новый RPC `create_or_append_support_ticket(...)`;
  - клиентский `/support` вызывает RPC вместо прямого insert;
  - RPC внутри транзакции ищет open ticket;
  - если open есть — добавляет `ticket_message`;
  - если open нет — создаёт ticket + first message;
  - всегда возвращает `ticket_id`, `created_new boolean`, `message_id`;
  - frontend не получает “0 rows”.
  Не делать dedupe скрытым триггером.
5. **Partial unique index на** `support_tickets(user_id)` **опасен.**
  Проверить перед любыми индексами:
  - есть ли `support_tickets.profile_id`;
  - есть ли тикеты без `user_id`;
  - может ли один `profile_id` иметь несколько `user_id`;
  - какие статусы реально существуют;
  - какие тикеты сейчас открыты;
  - есть ли уже дубли open по одному user/profile.
  Если уже есть дубли, unique index не создастся. Нужен migration plan с cleanup/merge strategy, а не “CREATE UNIQUE INDEX”.
6. **Не менять клиентский** `/support` **в этом патче.**
  `useCreateTicket` и `/support` не трогать в filters/actions. Это отдельный риск и отдельный regression-gate.
7. **Админское создание тикета — отдельный патч.**
  Третий патч:
  ```text
  PATCH-CONTACT-CENTER-ADMIN-START-SUPPORT-TICKET
  ```
  В нём отдельно согласовать:
  - кто может создавать;
  - какой `author_type`;
  - какие допустимые значения enum/check;
  - как клиент уведомляется;
  - `has_unread_user`;
  - subject/category/status;
  - открытие тикета в unified после создания;
  - audit.
8. **Role-check для admin_create_or_get_support_ticket нельзя писать наугад.**
  &nbsp;
  В плане указано:
  ```text
  has_role(auth.uid(),'admin'|'moderator'|'support')
  ```
  Нужно discovery:
  - какие роли реально есть в `app_role`;
  - есть ли `moderator`;
  - есть ли `support`;
  - как проверяются сотрудники контакт-центра;
  - можно ли использовать `useSectionAccess("communication")` на backend или нужен role mapping.
  Не писать RPC с несуществующими ролями.
9. **IG favorite миграция — допустима, но проверить existing table/index/RLS.**
  &nbsp;
  Перед миграцией read-only:
  - структура `instagram_dialog_preferences`;
  - existing unique index;
  - есть ли `admin_user_id`;
  - как mono-IG делает pin;
  - RLS/GRANT на update/upsert.
  Если RLS покрывает `is_pinned`, скорее всего покроет `is_favorite`, но это надо доказать.
10. **Support pin миграция — допустима, но проверить RLS и существующие поля.**

Перед миграцией:

- структура `support_tickets`;
- есть ли `is_starred`;
- кто может update `is_starred`;
- есть ли RLS для admin update;
- не конфликтует ли `is_pinned` с existing order.

11. **Для новых колонок добавить timestamps правильно.**

Для IG:

```sql
is_favorite boolean not null default false,
favorited_at timestamptz
```

Для Support:

```sql
is_pinned boolean not null default false,
pinned_at timestamptz
```

При toggle:

- true → `*_at = now()`;
- false → `*_at = null`.

12. **Индексы делать безопасно.**

Для новых индексов:

- `CREATE INDEX IF NOT EXISTS`;
- preferably partial;
- без блокировки больших таблиц, если проект использует обычные миграции Supabase — указать размер таблиц.

Для support dedupe unique index — не в этом патче.

13. **Фильтр “Новые” уточнить.**

В UI “Новые” должен соответствовать текущей логике:

```text
unread / unanswered
```

Для источников:

- Telegram: `unread_count > 0`;
- Instagram: `unread_count > 0`;
- Support: `has_unread_admin` или текущий `is_unanswered` после discovery.

Не смешивать `waiting_admin`, если текущая модель read/unread уже есть.

14. **Счётчики фильтров должны считаться по текущему normalized rows.**

Чипсы:

```text
Все = rows.length
Новые = rows.filter(r => r.isUnanswered).length
Избранное = rows.filter(r => r.isFavorite).length
Закреплённые = rows.filter(r => r.isPinned).length
```

15. **Pin/favorite сортировку не менять — но явно показать это в UI/proof.**

Если pin не поднимает строку вверх, это может быть неожиданно. В proof указать:

```text
Pinned/favorite filters and indicators are implemented.
Global sorting by pinned remains unchanged/deferred.
```

Либо, если уже есть сортировка по `is_pinned`, не менять её без отдельного подтверждения.

16. **Hover actions должны быть доступны не только на hover.**

На мобильных hover нет. Нужно обеспечить:

- кнопки видны/доступны на mobile;
- или открываются через `⋯`;
- или всегда видны в компактном виде.

Иначе row actions будут недоступны на iPhone/iPad.

17. **Добавить loading/error states для row actions.**

Для каждой мутации:

- disabled во время запроса;
- optimistic или invalidate после success;
- toast при ошибке;
- rollback optimistic state при ошибке.

18. **Mark read показывать только при unread.**

`Check`:

- показывать только если `unread_count > 0` / `isUnanswered=true`;
- после mark-read иконка исчезает;
- счётчик “Новые” уменьшается.

19. **Telegram mark-read boundary обязательно сохранить.**

Использовать тот же self-mark coordinator / observed boundary, который уже был отлажен. Не упрощать.

20. **Telegram preference key ещё раз сверить.**

В плане было `contact_user_id: row.meta.telegramUserId`. Перед реализацией proof:

- mono-Telegram использует этот же id;
- это не `profile.id`;
- это не `profiles.user_id`;
- это не `telegram_user_id` другого типа.

Ошибка здесь снова сломает pin/favorite.

21. **IG preference upsert должен использовать тот же ключ, что mono-IG.**

Сверить:

- `account_id`;
- `thread_key`;
- `admin_user_id`;
- unique index.

22. **Support favorite/pin должны не менять business status.**

Нельзя менять:

- `status`;
- `assigned_to`;
- `has_unread_user`;
- `has_unread_admin`, кроме mark-read.

23. **Unified opt-in не трогать.**

План говорит, что opt-in остаётся как есть — правильно. Добавить regression:

- opt-in ON показывает unified;
- opt-in OFF скрывает unified;
- оператор без opt-in не видит “Все”.

24. **Proof-файл для первого патча:**

```text
docs/audit/2026-07-04-unified-inbox-v2-filters-and-actions.md
```

25. **Итоговый отчёт первого патча:**

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-FILTERS-AND-ACTIONS
```

26. **DoD первого патча:**

- 4 чипса работают;
- Telegram pin/fav/read работают;
- Instagram pin/fav/read работают;
- Support pin/fav/read работают;
- unsupported actions больше не unsupported после добавления колонок;
- state сохраняется после refresh;
- mobile доступность actions решена;
- mono TG/IG/Support/Email без регресса;
- IG merge / headers / short badges без регресса;
- typecheck clean;
- proof создан.

27. **Support dedupe DoD перенести во второй патч.**

Не включать в текущий DoD:

- клиент не может создать второй open ticket;
- сообщение дописывается в существующий;
- `useCreateTicket` обрабатывает 0 rows.

Это отдельная задача.

28. **Admin-start-ticket DoD перенести в третий патч.**

Не включать в текущий DoD:

- админ из ContactDetailSheet создаёт тикет;
- клиент видит его в `/support`.

29. **Новый утверждённый порядок:**

```text
1. PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-FILTERS-AND-ACTIONS
   - IG favorite
   - Support pin
   - all-source pin/fav/read
   - chips filters

2. PATCH-CONTACT-CENTER-SUPPORT-TICKET-DEDUPLICATION
   - discovery
   - explicit RPC create_or_append
   - no hidden trigger returning NULL

3. PATCH-CONTACT-CENTER-ADMIN-START-SUPPORT-TICKET
   - admin creates/opens support ticket from ContactDetailSheet
   - separate RPC and UI
```

30. **Стартуем сейчас только пункт 1.**

Всё, что касается dedupe тикетов и админского создания тикета, пока не выполнять.

&nbsp;

План: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-SUPPORT-MERGE-AND-FILTERS

Diagnose

- Клиент может писать в поддержку (`/support` → CreateTicketDialog → useCreateTicket), но:
  1. Оператор не может инициировать тикет другому контакту из unified inbox.
  2. Один контакт может завести 3–4 open-тикета — каждый становится отдельной строкой в unified.
  3. Действия разнятся: IG — только pin+read, Support — только fav+read, TG — все три.
  4. Фильтры только «Все / Неотвеченные»; нет «Избранное / Закреплённые / Новые».

Plan (5 задач)

1. Schema-миграция (одна)
  - `ALTER TABLE public.instagram_dialog_preferences ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS favorited_at timestamptz;`
  - `ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS pinned_at timestamptz;`
  - Партиальные индексы `WHERE is_favorite = true` / `WHERE is_pinned = true`.
  - RLS/GRANT не трогаем — существующие политики покрывают.
  - Физический анти-дубль тикета: `CREATE UNIQUE INDEX IF NOT EXISTS uniq_support_open_ticket_per_user ON public.support_tickets (user_id) WHERE status IN ('open','in_progress','waiting_user');`
  Плюс BEFORE INSERT trigger `support_tickets_dedupe_open`: если у пользователя уже есть открытый тикет — не создавать новый, а вернуть NULL и попытаться дописать description как ticket_message. Реализация: trigger вызывает функцию, которая при найденном existing open вставляет в `ticket_messages` (author_type='user', author_id=NEW.user_id, message=NEW.description) и возвращает NULL, отменяя INSERT. Уже открытый тикет получает `updated_at=now(), has_unread_admin=true`. Клиентский `useCreateTicket` обрабатывает 0 rows → инвалидирует `user-tickets` и открывает найденный существующий тикет (SELECT open по user_id).
2. useUnifiedInbox: capabilities + фильтры-поля
  - `IG_CAPS = { canPin: true, canFavorite: true, canMarkRead: true }`.
  - `SUPPORT_CAPS = { canPin: true, canFavorite: true, canMarkRead: true }`.
  - IG: подтягивать `is_favorite` из instagram_dialog_preferences (join по admin_user_id + account_id + thread_key) при сборке строки.
  - Support: `isPinned = !!t.is_pinned`.
  - Оставить остальную нормализацию как есть (никакого нового объединения TG/IG/Support в одну карточку — user выбрал вариант 2, физическая нормализация тикета).
3. UnifiedInboxView: расширенные действия + фильтры
  - Добавить ветки для `instagram + is_favorite` и `support + is_pinned` в `togglePinFavorite`, используя те же таблицы (instagram_dialog_preferences.upsert, support_tickets.update).
  - Заменить дуальный tab «Все / Неотвеченные» на группу чипсов: `Все | Новые | Избранное | Закреплённые` (state `filter: 'all'|'unread'|'favorite'|'pinned'`). Каждая чипса — счётчик (unread count / favorite count / pinned count).
  - `filtered = rows.filter(...)`: `favorite → r.isFavorite`, `pinned → r.isPinned`, `unread → r.isUnanswered`.
  - Realtime: `useInboxRealtimeInvalidation` уже слушает support_tickets + instagram_messages → достаточно.
4. Админ инициирует тикет любому контакту
  - В `ContactDetailSheet` (используется unified для клика на имя): добавить кнопку «Написать в техподдержку» (появляется, если у контакта нет open-тикета; иначе — «Открыть тикет»).
  - Новый серверный контракт: RPC `admin_create_or_get_support_ticket(p_profile_id uuid, p_subject text, p_initial_message text)` SECURITY DEFINER:
    - Проверяет `has_role(auth.uid(),'admin'|'moderator'|'support')` (существующая функция).
    - Если у профиля есть открытый тикет — возвращает его id и добавляет initial_message как ticket_message (author_type='support').
    - Иначе создаёт новый тикет (profile_id=p_profile_id, user_id=profile.user_id, category='general', status='open', has_unread_user=true) + первый ticket_message.
  - На фронте: диалог в стиле CreateTicketDialog, вызов RPC → navigate на unified с выбранным `support:<id>` или открытие внутри unified.
  - Клиент увидит новый тикет автоматически через `useUserTickets` realtime-подписку по `user_id=eq.<self>`.
5. Аудит + regression-gate
  - `docs/audit/2026-07-04-unified-inbox-v2-support-merge-and-filters.md`: DDL, RPC-контракт, матрица capabilities, поведение dedupe, regression-checklist.
  - Regression-gate (Playwright под superadmin с opt-in ON):
    - unified: чипсы Все/Новые/Избранное/Закреплённые фильтруют корректно;
    - IG hover-star тогглит is_favorite + строка появляется в фильтре «Избранное»;
    - Support hover-pin тогглит is_pinned + попадает в «Закреплённые»;
    - попытка клиента создать второй open-тикет → сообщение допишется в существующий, unified показывает одну строку;
    - админ из ContactDetailSheet создаёт тикет контакту без тикета → появляется open-тикет, клиент видит его в /support;
    - mono-TG / IG merge / headers / short badges — без регресса.

Технические детали

- Файлы: `src/hooks/useUnifiedInbox.ts`, `src/components/admin/communication/unified/UnifiedInboxView.tsx`, `src/components/admin/communication/ContactDetailSheet.tsx` (+ новый `AdminStartTicketDialog.tsx`), `src/hooks/useTickets.ts` (обработка 0-rows insert), новая миграция + RPC.
- Kill-switch / opt-in остаются как есть; фичи включены в тот же V2-контур.
- Никаких новых bridge-таблиц, никаких изменений profiles/instagram_contacts.

DoD

- 4 чипсы-фильтра работают.
- pin/fav/read доступны на всех трёх источниках.
- Клиент не может создать второй open-тикет (сообщение дописывается).
- Админ из карточки контакта может начать тикет; клиент видит его.
- Regression-gate зелёный; консольные ошибки отсутствуют; typecheck clean.
- Аудит-документ создан.