# да, согласен, с учетом правок:

1. **PATCH A нельзя начинать сразу с backfill. Сначала отдельный dry-run отчёт.**
  &nbsp;
  Перед миграцией/merge сделать read-only dry-run:
  ```text
  PATCH-CONTACT-CENTER-SUPPORT-TICKET-BACKFILL-MERGE — dry-run
  ```
  Должен показать:
  - список `profile_id` с 2+ активными тикетами;
  - для каждого: target ticket, source tickets;
  - сколько `ticket_messages` будет перенесено;
  - какие ticket_number будут закрыты;
  - какие статусы сейчас;
  - есть ли вложения;
  - есть ли internal notes;
  - есть ли assigned_to/priority различия;
  - есть ли тикеты с разными `user_id` внутри одного `profile_id`.
  Без dry-run merge существующих данных не запускать.
2. **Target ticket: “самый ранний” — не всегда лучший.**
  Для истории можно выбрать самый ранний, но для операционного состояния лучше безопаснее:
  ```text
  target = самый свежий активный тикет по updated_at DESC
  ```
  Причина: именно в нём, вероятнее всего, актуальный статус, назначение, priority, последние сообщения.
  Если пользователь ожидает “история с начала” — сообщения всё равно будут перенесены и отсортированы по `created_at`.
  Рекомендация:
3. **Не терять метаданные source tickets при merge.**
  При закрытии source tickets сохранить:
  - `merged_into_ticket_id`;
  - `merged_at`;
  - `closed_at`;
  - `status='closed'`;
  - желательно `resolution_note` / `internal note`, если есть поле;
  - system-message в target со списком source ticket numbers.
  Если `support_tickets` имеет поля `resolved_at`, `closed_reason`, `resolution`, `updated_by` — discovery должен их перечислить до миграции.
4. **Перенос** `ticket_messages` **может потерять связь с исходным ticket_number в UI.**
  После `UPDATE ticket_messages SET ticket_id = target` сообщения физически станут частью target. Чтобы в истории было понятно, откуда они пришли, system-message обязателен.
  Дополнительно лучше перед переносом вставлять system-message:
  ```text
  Далее перенесены сообщения из обращения #TKT-...
  ```
  Или один summary-message со списком source tickets. Минимум — один summary-message.
5. **Хронология сообщений после merge должна быть проверена.**
  В proof обязательно:
  ```sql
  SELECT created_at, author_type, message
  FROM ticket_messages
  WHERE ticket_id = <target>
  ORDER BY created_at ASC;
  ```
  Проверить, что порядок читаемый, а system-message не ломает историю.
6. **PATCH A должен не только скрывать merged tickets во frontend, но и backend/query paths проверить.**
  Если mono `/support`, unified, админская support-лента и клиентский `/support` используют разные запросы, фильтр `merged_into_ticket_id IS NULL` нужно добавить во все соответствующие query:
  - unified support rows;
  - admin mono support list;
  - client `/support` list;
  - возможные counters/badges.
  Нельзя скрыть только в `useUnifiedInbox`.
7. `create_support_ticket` **после merge должен append именно в target.**
  Текущий dedupe выбирает активный тикет по `profile_id`. После PATCH A source tickets будут `closed`, target active. Это должно работать автоматически, но proof обязателен:
  - клиент Ольги создаёт новое обращение;
  - новый ticket не создаётся;
  - сообщение append в target;
  - source merged tickets остаются closed.
8. **PATCH A RPC role-check через** `has_permission('support.manage')` **проверить.**
  &nbsp;
  До миграции подтвердить, что:
  - такая permission существует;
  - текущий superadmin/support staff её имеет;
  - функция работает в SECURITY DEFINER;
  - non-support получает отказ.
  Если `has_permission` требует другой формат — использовать существующий контракт проекта.
9. **Backfill DO-блок не должен зависеть от** `auth.uid()`**.**
  &nbsp;
  Если DO-блок вызывает SECURITY DEFINER RPC с role-check через `auth.uid()`, в миграции `auth.uid()` может быть `NULL`, и вызов упадёт.
  Варианты:
  - backfill делает отдельная internal function без `auth.uid()` только внутри миграции;
  - или DO-блок выполняет merge SQL напрямую;
  - или RPC имеет optional internal bypass только для service_role — но это опаснее.
  Обязательно описать, как backfill пройдет в migration context.
10. **PATCH A rollback обязателен.**

Merge данных плохо откатывается, потому что сообщения уже перенесены. Поэтому нужен не “revert миграции”, а explicit rollback strategy:

- schema rollback возможен только если не нужен audit;
- data rollback сложный;
- перед backfill сохранить snapshot в audit JSON/SQL;
- proof должен содержать before snapshot.

Минимум:

```text
docs/audit/... содержит before snapshot по всем affected tickets/messages.
```

11. **PATCH B не привязывать к гипотезе про** `telegram_dialogs`**, пока не прочитан код.**

В предыдущих отчётах уже было, что mono TG использует `get_inbox_dialogs_v1` и profile enrichment. План B пишет “прямой SELECT telegram_dialogs” — это может быть неверно.

Исправить wording:

```text
Сначала фактически определить источник данных InboxTabContent: RPC get_inbox_dialogs_v1 или direct SELECT.
```

12. **PATCH B должен проверить не только имя, но и** `telegramUserId`**.**

Симптом “Telegram не привязан” означает, что в `ContactTelegramChat` ушёл `telegramUserId=null` или неправильный id. Поэтому обязательная mapping-таблица:

```text
RPC row user_id
profiles.id
profiles.user_id
profiles.telegram_user_id
selected dialog id
ContactTelegramChat.telegramUserId
ContactTelegramChat.profileId/contact
```

13. **PATCH B проверить PostgREST URL limit ещё раз.**

Поскольку ранее root cause был длинный `.or(...in...)`, нужно доказать:

- текущий код действительно на 2×`.in()`;
- в runtime profile query не падает;
- `profileMap.size > 0`;
- для выбранного диалога найден profile.

14. **PATCH B должен быть первым после PATCH A только если PATCH A нужен прямо сейчас.**

Но если mono Telegram сейчас сломан, это более критично для операторов, чем merge старых support-дублей.

Рекомендованный порядок:

```text
1. PATCH B — mono Telegram regression fix
2. PATCH A — support backfill merge
3. PATCH C — support composer
```

Причина: Telegram — основной рабочий канал. Нельзя оставлять его сломанным ради merge support.

15. **PATCH C формулировка “у любого профиля кнопка Техподдержка кликабельна” слишком широкая.**

Нужно ограничить:

```text
кнопка активна, если есть profile_id и у профиля есть user_id / platform account
```

Если у profile нет `user_id`, внутренний кабинетный тикет клиенту доставить нельзя.

16. **PATCH C: “пишем в личку клиента внутри платформы” — это не просто открыть тикет.**

Нужно определить UX:

- создаётся тикет без первого сообщения?
- или сразу создаётся первое support-сообщение?
- если сразу сообщение — где оператор вводит текст?
- если только тикет — почему `has_unread_user=true`, если сообщения ещё нет?

Рекомендация:

```text
admin_open_support_thread только создаёт/открывает тикет, но не ставит has_unread_user=true до отправки первого сообщения оператором.
```

`has_unread_user=true` должен выставляться при фактическом сообщении от support, а не при пустом создании.

17. **PATCH C должен переиспользовать dedupe RPC/логику.**

Если есть активный support ticket — вернуть его. Если нет — создать. Но не создавать дубль.

Для этого RPC:

```text
admin_open_support_thread(p_profile_id)
```

должен использовать advisory lock по `profile_id`, как клиентский `create_support_ticket`.

18. **PATCH C role-check не писать через несуществующие роли.**

Использовать permission, подтверждённую discovery:

```text
has_permission(auth.uid(), 'support.manage') OR has_permission(auth.uid(), 'admins.manage')
```

Только если эти permissions реально существуют.

19. **PATCH C нужен отдельный контракт сообщений.**

Открыть тикет и “написать клиенту” — разные действия. Если после создания тикета оператор пишет через существующий `TicketChat`, тогда:

- `admin_open_support_thread` создаёт ticket;
- `TicketChat` отправляет message;
- unread для клиента выставляет существующая send-message логика.

Не дублировать отправку сообщения в `admin_open_support_thread`, если это уже делает `TicketChat`.

20. **PATCH C не должен вызывать клиентский** `create_support_ticket` **от имени клиента.**

План это уже запрещает — оставить.

21. **PATCH C должен работать с тикетом, которого нет в current** `allRows`**, но лучше сначала refetch, а не отдельный параллельный** `useTicketById`**.**

Безопаснее:

- RPC возвращает `ticket_id`;
- invalidate `unified-support-tickets`;
- после refetch строка появляется;
- selectedKey = `support:<ticket_id>`.

`useTicketById` нужен только если refetch не успевает. Не усложнять без необходимости.

22. **Каждый патч — отдельный PASS, но порядок изменить.**

Новый рекомендуемый порядок:

```text
PATCH B — inbox-tab-telegram-regression-fix
PATCH A — support-ticket-backfill-merge
PATCH C — channel-picker-support-composer
```

Если пользователь критично хочет сначала убрать 4 строки Ольги — можно A перед B, но технически mono-TG важнее.

23. **Для PATCH A добавить запрет на массовый merge без dry-run approval.**

После dry-run исполнитель должен вернуть список affected profiles. Только после подтверждения запускать data-changing merge.

Формат:

```text
Dry-run found:
- profile Ольга Мацкевич: target TKT-..., sources [...]
- ...
Waiting for approval to execute backfill.
```

24. **PATCH A не закрывать, пока не проверено вручную у Ольги.**

DoD по Ольге:

- unified показывает 1 support row;
- mono support показывает 1 active row;
- client `/support` показывает 1 active row;
- все старые сообщения доступны в target;
- source tickets closed + merged_into set.

25. **PATCH B proof должен включать скрин “до/после”.**

Если before только пользовательский скрин — сослаться на него как external proof.

26. **PATCH C proof должен проверить клиента.**

Клиент должен видеть созданный тикет/сообщение в `/support` только после реального support message. Не утверждать “доставлено”, если был только пустой тикет.

27. **Итоговые proof-файлы:**

```text
docs/audit/2026-07-04-inbox-mono-telegram-regression.md
docs/audit/2026-07-04-support-ticket-backfill-merge.md
docs/audit/2026-07-04-channel-picker-support-composer.md
```

28. **Финальные отчёты:**

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-INBOX-MONO-TELEGRAM-REGRESSION-FIX
Отчет о выполненной работе: PATCH-CONTACT-CENTER-SUPPORT-TICKET-BACKFILL-MERGE
Отчет о выполненной работе: PATCH-CONTACT-CENTER-CHANNEL-PICKER-SUPPORT-COMPOSER
```

29. **Сейчас стартовать с PATCH B, если mono Telegram всё ещё сломан.**

Не продолжать A/C, пока основной Telegram не восстановлен.

Итог: план принимается по сути, но порядок меняем: **сначала восстановить mono Telegram**, затем **dry-run и только после approval merge старых support-дублей**, затем **Support-кнопка в ChannelPicker**.

&nbsp;

План: три отдельных исправления по контакт-центру

Пользователь сообщает три разных дефекта. Разбиваем на три независимые задачи, чтобы каждую можно было принять/откатить по отдельности. Ко второй и третьей приступаем только после PASS первой.

## Что подтверждено discovery

- **Ольга Мацкевич (profile `3c148831-…`)** в БД имеет **4 открытых тикета** (`TKT-26180`, `26179`, `26177`, `26173`) — плюс закрытые. Патч дедупликации от 2026-07-04 применялся **только к новым `create_support_ticket**`, existing duplicates он не трогает (это было явное `Forbidden: merging existing duplicates`). Поэтому unified inbox честно рисует 4 строки — регресса патча нет, но **пользователь ожидает, что они уже объединены**. Нужен отдельный merge-этап.
- **Mono Telegram (`InboxTabContent`)** на скриншоте 2: все строки показаны как «gorbova support» с `?`-аватаром, без текста последнего сообщения. Это регресс отдельного legacy-компонента, не unified. Второй патч (`SUPPORT-TICKET-DEDUPLICATION`) mono TG не трогал — значит регресс пришёл раньше или из соседней миграции. Нужна изолированная диагностика.
- **Кнопка «Техподдержка»** в `ChannelPicker` (`src/components/admin/communication/unified/ChannelPicker.tsx`) сейчас disabled, если у профиля нет открытого тикета (`data.support.length === 0` → tooltip «Нет открытых обращений»). Аналогично, если тикет есть, но не в текущей ленте. Пользователь хочет: «через техподдержку можем писать в личку сообщения внутри платформы» — то есть кнопка должна создавать/открывать тикет и переключать в него, даже когда открытого нет.

---

## PATCH A — Слияние существующих открытых тикетов Support (`support-ticket-backfill-merge`)

**Цель.** Для каждого `profile_id` оставить **один активный тикет** (самый ранний `open/in_progress/waiting_user`), остальные активные — merge в него: перенести `ticket_messages`, закрыть исходники как `merged_into`.

**Изменения в БД (одна миграция):**

1. Добавить в `support_tickets`: `merged_into_ticket_id uuid null references support_tickets(id)`, `merged_at timestamptz null`. Индекс `idx_support_tickets_merged_into (merged_into_ticket_id) where merged_into_ticket_id is not null`.
2. RPC `merge_support_tickets(p_target_ticket_id uuid, p_source_ticket_ids uuid[])` SECURITY DEFINER:
  - проверка `has_permission(auth.uid(), 'support.manage')`;
  - `pg_advisory_xact_lock(hashtext(p_target_ticket_id::text))`;
  - все `ticket_messages` источников → `UPDATE set ticket_id = target`;
  - target: `has_unread_admin = true`, `updated_at = now()`, если был `waiting_user` → `open`;
  - источники: `status = 'closed'`, `merged_into_ticket_id = target`, `merged_at = now()`, `closed_at = now()`;
  - insert system-`ticket_message` в target: «Объединено N обращений: #NUMBER, #NUMBER…»;
  - вернуть `{success, target_ticket_id, merged_count, moved_messages}`.
3. **Backfill-миграция**: одноразовый DO-блок, который для каждого `profile_id` с ≥2 активными тикетами вызывает `merge_support_tickets`, выбирая target = самый ранний по `created_at`. Никаких новых триггеров, никаких unique-индексов на `(profile_id, status)` — иначе дальше упадёт `create_support_ticket`.

**Frontend:**

- `useUnifiedInbox` — исключать `support_tickets` с `merged_into_ticket_id is not null` из выборки (в фильтре). Mono `/support` — то же самое.
- `useTickets` (список у клиента) — не показывать merged.
- Никаких изменений в `create_support_ticket` — она уже дедуплицирует новые сообщения.

**Proof:** `docs/audit/2026-07-04-support-ticket-backfill-merge.md` — before/after: 4 строки Ольги → 1, все сообщения читаются в цепочке, mono/unified.

**DoD:**

- у Ольги в unified 1 строка `Техподдержка` вместо 4;
- history сообщений собрана хронологически;
- закрытые/resolved тикеты не тронуты;
- `create_support_ticket` продолжает работать (клиент пишет — уходит в active target);
- typecheck clean, консольных ошибок нет.

---

## PATCH B — Регресс mono Telegram (`inbox-tab-telegram-regression-fix`)

**Гипотеза (проверить discovery-запросом первым шагом):** `InboxTabContent.tsx` строит список через прямой SELECT `telegram_dialogs` + join с `profiles`; на скриншоте у всех строк counterpart = «gorbova support» (это имя бота). Это значит либо:

- (a) join развернулся в обратную сторону (dialog.bot_profile вместо dialog.contact_profile);
- (b) фильтр `direction`/`role` пропал и теперь берётся любая сторона диалога;
- (c) один из последних patch'ей поменял поле, из которого читается `full_name` в `d.` map.

**План работ:**

1. Прочитать `src/components/admin/communication/InboxTabContent.tsx` 250–380 и найти, откуда берётся `contact_name`/аватар после последнего изменения.
2. Сверить с рабочей веткой git blame через шелл — какая строка поменялась в последние 3 суток.
3. Точечно вернуть корректный источник имени контакта (profiles по `contact_user_id`, не `bot_profile_id`).
4. Убедиться, что `last_message_text` снова приходит (возможно проблема та же — поле переименовано в SELECT).

**Не трогаем:** unified inbox, ChannelPicker, RPCs.

**Proof:** `docs/audit/2026-07-04-inbox-mono-telegram-regression.md` + скрин mono TG до/после.

**DoD:**

- у диалогов реальные имена контактов и аватары;
- виден текст последнего сообщения / плейсхолдер типа сообщения;
- нет 400/500 в консоли;
- unified TG не сломан.

---

## PATCH C — Кнопка «Техподдержка» в ChannelPicker должна писать в личку клиента (`channel-picker-support-composer`)

**Цель.** Кнопка Support активна, если у профиля есть хоть какой-то канал доставки (Telegram bridged, IG linked или сам факт наличия профиля с `user_id` → внутренние уведомления платформы). При клике:

- если у профиля уже есть активный тикет и он в ленте — переключаем на него (текущее поведение);
- если активный тикет есть, но его нет в ленте — грузим его в правую панель через `ticketId` (тот же путь, что мono `/support`);
- если активного тикета **нет** — вызываем существующий `create_support_ticket` от имени клиента? **нет**: тикет создаёт клиент, а не оператор. Вместо этого добавляем новый SECURITY DEFINER RPC `admin_open_support_thread(p_profile_id uuid, p_subject text default 'Диалог с поддержкой')`, который создаёт тикет с `status='open'`, `has_unread_user=true` (это уведомление клиенту внутри платформы, как обычное сообщение техподдержки), возвращает `ticket_id`. Затем фронт переключает правую панель на новый тикет и фокусирует композер.

**Изменения:**

1. Миграция: RPC `admin_open_support_thread` с проверкой `has_permission(auth.uid(), 'support.manage'|'admins.manage')`, race-lock, использует `generate_ticket_number_atomic()`.
2. `src/hooks/useAdminOpenSupportThread.ts` — новый мутирующий хук + инвалидация `unified-inbox`, `unified-support-tickets`.
3. `ChannelPicker.tsx`:
  - support-кнопка disabled только если `!profileId`;
  - клик: если `supportRow.targetKey` — `onSelect(targetKey)`; иначе `admin_open_support_thread` → навигация в новый тикет;
  - tooltip: «Написать в техподдержку клиенту» / «Открыть обращение».
4. Правая панель unified должна уметь принять переключение на `ticketId`, которого нет в текущей `allRows` (fetch on demand через `useTicketById`).

**Не трогаем:** `create_support_ticket` (это клиентский путь), моно `/support`.

**Proof:** `docs/audit/2026-07-04-channel-picker-support-composer.md` со сценариями: нет тикета → создали → сообщение доставлено клиенту (виден `has_unread_user`), unified показывает 1 строку.

**DoD:**

- у любого профиля кнопка «Техподдержка» кликабельна;
- клик без активного тикета создаёт новый и открывает композер;
- клик при существующем тикете открывает его (не создаёт дубль — работает дедупликация из PATCH A);
- клиент видит сообщение в своём `/cabinet/support`;
- typecheck clean.

---

## Порядок исполнения и regression-gate

1. **PATCH A** → миграция + backfill → ручной regression (Ольга 4→1, новые append работают) → PASS.
2. **PATCH B** → diagnose → fix → скриншот mono TG → PASS.
3. **PATCH C** → миграция RPC + фронт → regression по DoD → PASS.

Между патчами — не смешивать. Каждый закрывается отдельным audit-документом. Второй/третий не начинаем без PASS предыдущего.