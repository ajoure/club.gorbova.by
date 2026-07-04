# PATCH-CONTACT-CENTER-SUPPORT-TICKET-BACKFILL-MERGE — DRY-RUN

**Дата:** 2026-07-04
**Статус:** dry-run завершён, ожидает approval пользователя перед выполнением data-changing backfill.

## Что делает патч (общая идея)

Для каждого `profile_id`, у которого сейчас **несколько активных тикетов** (`status ∈ {open, in_progress, waiting_user}`), физически оставить **один активный тикет** (target). Остальные (sources):
- их `ticket_messages` переносятся в target (`UPDATE set ticket_id = target_id`);
- сами закрываются с `status='closed'`, `merged_into_ticket_id=target`, `merged_at=now()`, `closed_at=now()`;
- в target вставляется system-`ticket_message` с summary: «Объединено N обращений: #NUMBER, #NUMBER, #NUMBER».

## Схемные изменения (готовы к применению независимо от backfill)

Отдельная миграция `20260704…add-merge-fields` — **только структура, без изменения данных**:

```sql
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS merged_into_ticket_id uuid
    REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_support_tickets_merged_into
  ON public.support_tickets (merged_into_ticket_id)
  WHERE merged_into_ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_active_by_profile
  ON public.support_tickets (profile_id, updated_at DESC)
  WHERE status IN ('open','in_progress','waiting_user')
    AND merged_into_ticket_id IS NULL;
```

+ RPC `admin_merge_support_tickets(p_target_ticket_id uuid, p_source_ticket_ids uuid[])` (SECURITY DEFINER), защищённая `has_permission(auth.uid(), 'support.manage') OR has_permission(auth.uid(), 'admins.manage')`. Внутри — `pg_advisory_xact_lock(hashtext(target::text))`, UPDATE `ticket_messages`, UPDATE sources, INSERT system-message.

+ Фронтенд-фильтр `merged_into_ticket_id IS NULL` в четырёх местах:
  - `src/hooks/useUnifiedInbox.ts` (unified inbox);
  - `src/hooks/useTickets.ts::useUserTickets` (клиент `/support`);
  - `src/hooks/useTickets.ts::useAdminTickets` (админ-моно `/admin/communication?tab=inbox&channel=support`);
  - `src/hooks/useProfileChannels.ts` (ChannelPicker в unified).

## Backfill (data-changing, НЕ выполняется до approval)

Отдельная миграция, которая:
1. Пишет before-snapshot в `docs/audit/2026-07-04-support-ticket-backfill-before-snapshot.json` (генерируется вручную из результатов ниже — приложен в этот же audit).
2. Внутри `DO $$ … $$;` без `auth.uid()` (в migration context `auth.uid()` = NULL, поэтому SECURITY DEFINER RPC с permission-check упадёт; backfill идёт **напрямую SQL**, минуя RPC — миграция запускается под service_role и не должна дёргать `has_permission`).
3. Для каждого profile выбирает target = **самый ранний по created_at ASC** (в текущем dry-run кейсе target = TKT-26173, у него же и самый свежий `updated_at`, и в нём же оператор support уже отвечал — совпадает по всем критериям).

## Dry-run: список affected profiles

Запрос:

```sql
WITH dups AS (
  SELECT profile_id, COUNT(*) as active_count,
         array_agg(id ORDER BY created_at) as ids,
         array_agg(ticket_number ORDER BY created_at) as nums
  FROM support_tickets
  WHERE status IN ('open','in_progress','waiting_user') AND profile_id IS NOT NULL
  GROUP BY profile_id
  HAVING COUNT(*) > 1
)
SELECT * FROM dups;
```

Результат: **1 профиль** с дубликатами.

### Profile: Ольга Мацкевич (`3c148831-133a-4dad-b978-06cd46b0ea20`)

**Активные тикеты (4):**

| ticket_number | id | subject | status | created_at | updated_at | messages | attachments |
|---|---|---|---|---|---|---|---|
| TKT-26-26173 | b83a5c97-… | Ответ за запрос по ст. 107, п.1.12 | open | 2026-06-30 12:43 | **2026-07-04 18:01** | 5 | 2 |
| TKT-26-26177 | 50fe1d8f-… | Запрос по ст. 107 | open | 2026-07-02 09:16 | 2026-07-04 15:23 | 2 | 1 |
| TKT-26-26179 | 9e51d8d7-… | Запрос по ст. 107 | open | 2026-07-03 14:38 | 2026-07-04 17:24 | 3 | 2 |
| TKT-26-26180 | 799f1ce4-… | Модули по видам деятельности | open | 2026-07-03 14:41 | 2026-07-04 14:57 | 1 | 0 |

**Target:** `TKT-26-26173` (b83a5c97-…) — самый ранний по `created_at`, одновременно самый свежий по `updated_at`, единственный, где оператор support уже дал ответ (2 сообщения `author_type='support'` + `user`-подтверждение «Огромное спасибо!»).

**Sources → закроются как `merged`:** TKT-26177, TKT-26179, TKT-26180.

**Сообщения к переносу:** 6 (2 из TKT-26177 + 3 из TKT-26179 + 1 из TKT-26180). Все `author_type='user'`, ни одного `is_internal=true`.

**Разницы, которые НЕ теряются:**
- `assigned_to` = NULL везде — нет конфликта;
- `priority` = 'normal' везде — нет конфликта;
- `is_pinned/is_starred` = false везде — нет конфликта;
- `first_response_at` = NULL у всех, кроме target (там есть ответ) — target уже «правильнее»;
- `subject` источников теряется — компенсируется system-message в target.

### Полный before-snapshot (для rollback)

**Tickets:**

```json
[
  {"id":"b83a5c97-1538-4789-a631-467b48145d1f","ticket_number":"TKT-26-26173","status":"open","subject":"Ответ за запрос по ст. 107, п.1.12","created_at":"2026-06-30T12:43:48.608Z","updated_at":"2026-07-04T18:01:17.766Z"},
  {"id":"50fe1d8f-fd5a-47e2-b9de-f6414085ee56","ticket_number":"TKT-26-26177","status":"open","subject":"Запрос по ст. 107","created_at":"2026-07-02T09:16:53.138Z","updated_at":"2026-07-04T15:23:56.309Z"},
  {"id":"9e51d8d7-0e05-46eb-b961-e4e4a98c283e","ticket_number":"TKT-26-26179","status":"open","subject":"Запрос по ст. 107","created_at":"2026-07-03T14:38:20.900Z","updated_at":"2026-07-04T17:24:26.185Z"},
  {"id":"799f1ce4-90b8-4d8e-808d-c2df2fa95062","ticket_number":"TKT-26-26180","status":"open","subject":"Модули по видам деятельности","created_at":"2026-07-03T14:41:41.849Z","updated_at":"2026-07-04T14:57:03.395Z"}
]
```

**Messages (`ticket_id → id → author_type → att_count`):**

```
TKT-26173  5a1d7c1b user 0   (2026-06-30 12:43)  «ООО «Ромашка»…»
TKT-26173  49542249 user 1   (2026-06-30 12:45)  «Добрый день!»
TKT-26177  039f0af7 user 0   (2026-07-02 09:16)  «Добрый день! Подскажите пожалуйста…»
TKT-26177  dc3885f0 user 1   (2026-07-02 09:17)
TKT-26179  0f2dbe95 user 0   (2026-07-03 14:38)  «Добрый день! Можно ли получить ответ…»
TKT-26179  6bb96efc user 1   (2026-07-03 14:38)
TKT-26179  42de1459 user 1   (2026-07-03 14:39)
TKT-26180  b6b63017 user 0   (2026-07-03 14:41)  «Добрый день! Можно ли получить сейчас доступ…»
TKT-26173  4196c775 support 1 (2026-07-04 15:20)
TKT-26173  dc83fb3d support 0 (2026-07-04 15:21)  «Добрый день. Вот шаблон ответа.»
TKT-26173  769bff67 user 0    (2026-07-04 15:57)  «Огромное спасибо!»
```

После merge все 11 сообщений будут привязаны к TKT-26173 и отсортированы по `created_at ASC`. Хронология:

```
2026-06-30 12:43  user       ООО «Ромашка»…              (из target)
2026-06-30 12:45  user       Добрый день!                (из target)
2026-07-02 09:16  user       Добрый день! Подскажите…    (из TKT-26177)
2026-07-02 09:17  user       [attachment]                (из TKT-26177)
2026-07-03 14:38  user       Можно ли получить ответ…    (из TKT-26179)
2026-07-03 14:38  user       [attachment]                (из TKT-26179)
2026-07-03 14:39  user       [attachment]                (из TKT-26179)
2026-07-03 14:41  user       Модули по видам…            (из TKT-26180)
2026-07-04 15:20  support    [attachment]                (из target)
2026-07-04 15:21  support    Вот шаблон ответа.          (из target)
2026-07-04 15:57  user       Огромное спасибо!           (из target)
+ system @ now()  system     Объединено 3 обращения: TKT-26-26177, TKT-26-26179, TKT-26-26180.
```

Хронология читаемая. System-message ставится в конце (по `created_at=now()`), не ломая исторический порядок.

## Rollback strategy

- Schema rollback (снять индексы + колонки): тривиально, если ещё не запустили backfill.
- Data rollback после backfill: восстанавливается точечно по snapshot выше:
  ```sql
  -- восстановить sources в open
  UPDATE support_tickets SET status='open', merged_into_ticket_id=NULL, merged_at=NULL, closed_at=NULL
   WHERE id IN ('50fe1d8f-…','9e51d8d7-…','799f1ce4-…');
  -- вернуть messages на исходный ticket_id по id
  UPDATE ticket_messages SET ticket_id='50fe1d8f-…' WHERE id IN ('039f0af7-…','dc3885f0-…');
  UPDATE ticket_messages SET ticket_id='9e51d8d7-…' WHERE id IN ('0f2dbe95-…','6bb96efc-…','42de1459-…');
  UPDATE ticket_messages SET ticket_id='799f1ce4-…' WHERE id IN ('b6b63017-…');
  -- удалить system summary message из target
  DELETE FROM ticket_messages WHERE ticket_id='b83a5c97-…' AND author_type='system' AND created_at > '2026-07-04T18:30Z';
  ```

## Что жду от вас

**Approve** для запуска второй миграции (data-changing backfill), которая выполнит merge для Ольги Мацкевич по плану выше.

До approval применяю только:
1. Схемную миграцию (колонки + индексы + RPC — не трогают данные).
2. Frontend-фильтр `merged_into_ticket_id IS NULL` в четырёх query-путях (safe no-op, пока merge не запущен).

## DoD после backfill (проверяется вручную)

- unified inbox у Ольги: 1 строка `Техподдержка TKT-26-26173` вместо 4;
- mono `/admin/…?channel=support`: 1 активный тикет Ольги;
- client `/support` (у самой Ольги): 1 активный тикет с полной хронологией 11 сообщений;
- source-тикеты `closed`, `merged_into_ticket_id` заполнен;
- новый клиентский запрос от Ольги → `create_support_ticket` находит active target и append'ит (не создаёт дубль);
- typecheck clean, консольных ошибок нет.
