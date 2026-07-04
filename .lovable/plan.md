да, согласен, с учетом правок:

1. **Перед** `CREATE OR REPLACE contact_feed_list` **обязательно сделать function signature discovery.**
  &nbsp;
  Проверить фактическую сигнатуру и return shape:
  ```sql
  SELECT pg_get_functiondef('public.contact_feed_list'::regproc);
  ```
  Если функция перегружена — найти точную:
  ```sql
  SELECT oid::regprocedure
  FROM pg_proc
  WHERE proname = 'contact_feed_list';
  ```
  Нельзя случайно заменить не ту перегрузку или изменить return contract.
2. **Подтвердить, что** `_contact_id` **— это именно** `profiles.id`**.**
  &nbsp;
  В плане используется:
  ```sql
  c.profile_id = _contact_id
  t.profile_id = _contact_id
  ```
  Перед миграцией доказать, что `ContactFeedTab` передаёт именно `profiles.id`, а не `user_id`, `contact_id` или CRM contact id.
3. **Instagram join проверить по реальной схеме.**
  &nbsp;
  В discovery ранее было:
  ```text
  instagram_contacts.instagram_account_id + instagram_user_id
  instagram_messages peer_id / instagram_account_id
  ```
  Но перед SQL нужно подтвердить реальные имена:
  - `instagram_messages.instagram_account_id`;
  - `instagram_messages.peer_id`;
  - `instagram_messages.message_text`;
  - `instagram_messages.created_at`;
  - `instagram_messages.direction`;
  - `instagram_messages.media_url`;
  - `instagram_messages.media_type`;
  - `instagram_contacts.instagram_username`;
  - `instagram_contacts.full_name`.
  Если каких-то полей нет — не подставлять наугад, использовать `NULL` в meta.
4. **Support source должен исключать merged source tickets или нет — уточнить.**
  &nbsp;
  После merge сообщения источников физически переехали в target, а source tickets закрыты. Если вдруг остались старые source messages или будущий rollback, есть риск дублей.
  Безопаснее в `support_src` добавить:
  ```sql
  AND t.merged_into_ticket_id IS NULL
  ```
  Но только если все перенесённые сообщения реально находятся в target. Если цель — показать историю target, этого достаточно.
  Рекомендация:
  ```text
  support_src читает только не-merged tickets: t.merged_into_ticket_id IS NULL
  ```
  Иначе в будущем можно случайно показать сообщения дважды.
5. **Support attachments/meta — проверить тип** `attachments`**.**
  &nbsp;
  Если `tm.attachments` уже `jsonb`, ок. Если nullable — обернуть:
6. **Search должен работать по title/author тоже, не только body.**
  &nbsp;
  Сейчас план ищет только по тексту сообщения. Для support полезно искать по `ticket_number`, для IG — по username/full_name.
  Добавить:
7. `title=m.direction` **для Instagram слишком технический.**
  &nbsp;
  Лучше:
  ```text
  title = CASE
    WHEN m.direction = 'incoming' THEN 'Instagram · входящее'
    WHEN m.direction = 'outgoing' THEN 'Instagram · исходящее'
    ELSE 'Instagram'
  END
  ```
  Или оставить коротко `Instagram`, а direction положить в meta. В UI это будет чище.
8. `author` **для Instagram тоже нужен.**
  &nbsp;
  Для IG строк добавить:
  ```sql
  author = CASE
    WHEN m.direction = 'incoming' THEN COALESCE(c.full_name, c.instagram_username)
    ELSE 'Оператор'
  END
  ```
  Если в таблице есть sender/admin name — использовать фактическое поле. Если нет — fallback.
9. `author` **для Support должен учитывать** `author_type`**.**
  &nbsp;
  Если `tm.author_name` пустой:
10. `id` **у новых feed rows должен быть namespaced.**

Если `contact_feed_list` возвращает общий `id`, нельзя отдавать просто `m.id` / `tm.id`, потому что id разных источников могут конфликтовать во фронте.

Использовать:

```sql
id = 'instagram:' || m.id::text
id = 'support:' || tm.id::text
```

Если return type `id uuid`, тогда нужно проверить текущий контракт. Но для mixed feed обычно нужен text id. Это critical discovery.

11. `kind` **должен соответствовать enum/типу функции.**

Если return type имеет CHECK/enum или frontend ожидает фиксированные строки, добавить:

```text
instagram
support
```

только после проверки, что `kind` возвращается как text, а не enum.

12. **Порядок и pagination должны остаться общими.**

Новые sources должны входить в общий `all_events`, а затем применяться:

```sql
ORDER BY at DESC
LIMIT _limit OFFSET _offset
```

Не применять limit отдельно к IG/support до union, иначе лента будет некорректной.

13. **Права функции не менять, но проверить, что SECURITY DEFINER не раскрывает чужие данные.**

Guard должен проверять доступ админа к contact feed. Если сейчас функция уже проверяет `has_role_v2` / admin permission — оставить. Но новые IG/support источники должны фильтроваться строго по `_contact_id`, а не по незавязанным messages.

14. **В** `ContactFeedTab` **новые чипы должны участвовать в multi-select так же, как старые.**

Проверить:

- `Instagram` отдельно;
- `Техподдержка` отдельно;
- `Instagram + Telegram`;
- `Все`;
- поиск + типы вместе.

15. **Цвета не выбирать “свободно”, использовать design tokens.**

Не добавлять hardcoded яркие Tailwind-цвета, если в компоненте уже есть схема. Использовать стиль существующего `KIND_META`.

16. **Не ломать unknown kind fallback.**

Если в старых данных придёт неизвестный `kind`, текущий fallback должен продолжать работать.

17. **Dry-run SQL обязателен до миграции.**

В proof показать для Ольги/Катерины или другого клиента:

```sql
-- IG count by profile
SELECT count(*)
FROM instagram_messages m
JOIN instagram_contacts c ...
WHERE c.profile_id = '<profile_id>';

-- Support public messages count by profile
SELECT count(*)
FROM ticket_messages tm
JOIN support_tickets t ...
WHERE t.profile_id = '<profile_id>'
  AND tm.is_internal = false
  AND t.merged_into_ticket_id IS NULL;
```

18. **DoD дополнить проверкой merged support.**

Для Ольги после merge:

- в ContactFeed видны сообщения target ticket;
- source merged tickets не дают дублей;
- system-summary message виден, если `is_internal=false` и author_type/system разрешён.

Если system-summary не должен быть виден клиенту/ленте контакта — явно решить. Для админской ленты контакта system-событие допустимо.

19. **Regression по старым типам проверить не только визуально.**

До/после:

- количество feed rows по старым типам не уменьшилось;
- фильтр `telegram` работает;
- фильтр `notes/files/tasks/deals` работает;
- поиск по старым источникам работает.

20. **Proof-файл:**

```text
docs/audit/2026-07-04-contact-feed-add-instagram-and-support.md
```

21. **Итоговый отчёт:**

```text
Отчет о выполненной работе: PATCH-CONTACT-FEED-ADD-INSTAGRAM-AND-SUPPORT
```

22. **Если function return type не позволяет добавить** `instagram/support` **без enum migration — остановиться.**

Не делать скрытую миграцию enum/type без отдельного approval. Report blocker:

```text
contact_feed_list return kind is constrained; enum/type migration required
```

После этих правок план утверждён. Выполнять одним патчем: DB function + `ContactFeedTab`, без новых таблиц/edge/хуков.

&nbsp;

План: добавить историю Instagram и Техподдержки в вкладку «Лента» контакта

Цель

- В `ContactFeedTab` показывать все сообщения из Instagram (если IG-контакт привязан к profile) и все сообщения из тикетов техподдержки клиента.
- Ничего нового не создавать (никаких новых таблиц/хуков/edge-функций). Только расширить существующий RPC `contact_feed_list` и добавить два фильтра-чипа во фронт.

Что меняется

1. DB миграция — единственный CREATE OR REPLACE функции `contact_feed_list(_contact_id, _types, _search, _limit, _offset)`.
Добавить в CTE-объединение ещё два источника (структура строк та же: id/kind/at/title/body/meta/author):

```text
ig_src:
  FROM instagram_messages m
  JOIN instagram_contacts c
    ON c.instagram_account_id = m.instagram_account_id
   AND c.instagram_user_id   = m.peer_id
  WHERE c.profile_id = _contact_id
    AND (_types IS NULL OR 'instagram' = ANY(_types))
    AND (_like IS NULL OR lower(coalesce(m.message_text,'')) LIKE _like)
  kind='instagram', at=m.created_at, title=m.direction, body=m.message_text,
  meta = { peer_id, ig_thread_id, direction, status, media_url, media_type,
           instagram_username: c.instagram_username, full_name: c.full_name }

support_src:
  FROM ticket_messages tm
  JOIN support_tickets  t  ON t.id = tm.ticket_id
  WHERE t.profile_id = _contact_id
    AND tm.is_internal = false
    AND (_types IS NULL OR 'support' = ANY(_types))
    AND (_like IS NULL OR lower(coalesce(tm.message,'')) LIKE _like)
  kind='support', at=tm.created_at, title=t.ticket_number, body=tm.message,
  author = tm.author_name,
  meta = { ticket_id, ticket_number: t.ticket_number, status: t.status,
           author_type: tm.author_type, attachments: tm.attachments,
           merged_into_ticket_id: t.merged_into_ticket_id }
```

   Оба источника подключить в `all_events UNION ALL`. Права/SECURITY DEFINER/`has_role_v2` guard — без изменений. Поведение старых источников не трогаем.

2. Фронт `src/components/admin/contact/ContactFeedTab.tsx`:
  - Расширить `FeedKind`: добавить `"instagram" | "support"`.
  - В `KIND_META` — две записи с существующими иконками (`instagram`: `MessageCircle`/розовый; `support`: `LifeBuoy` или `Sparkles` — доступный из lucide; цвет — teal/emerald, свободный от коллизий, либо переиспользуем `Handshake` — нет, лучше `LifeBuoy`).
  - Добавить в `ALL_TYPES` два новых типа, чтобы появились чипы фильтров «Instagram» и «Техподдержка».
  - В `loadPlatformEventsForContact` — без изменений (там аудиты/платежи/сделки).
  - Рендер сообщения: используем существующий текстовый рендер, как для `telegram`/`sms` (никаких новых компонентов). Для support в подпись — `TKT-…` (из title) и `author_name` (из author).

Что не делаем

- Не трогаем `useUnifiedInbox`, `useTickets`, IG-хуки, ChannelPicker, композер.
- Не создаём новых RPC/edge-функций/таблиц.
- Не меняем UX композитора Ленты (заметки/файлы/голосовые).
- Не пишем в IG/Support из этой вкладки — только чтение истории.

Definition of Done

- В Ленте карточки клиента с привязанным IG видно все сообщения из `instagram_messages` для его `instagram_contacts.profile_id`.
- В Ленте видны все `ticket_messages` (кроме `is_internal=true`) по всем его `support_tickets`, включая уже смерженные (потому что сообщения переехали в target-тикет, и в фильтре по `profile_id` они видны).
- Появились чипы «Instagram» и «Техподдержка», работают и в комбинации с «Все».
- Регресс существующих источников (calls/sms/telegram/email/tasks/notes/files/deals/events) — без изменений.
- Никаких новых консольных ошибок; typecheck clean.

Proof

- `docs/audit/2026-07-04-contact-feed-add-instagram-and-support.md` с dry-run SQL по 1 клиенту и скринами вкладки.

После approve — выполняю миграцию + правки во фронте одним патчем.