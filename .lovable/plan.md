да, согласен, с учетом правок:

1. **План в целом правильный: явный RPC вместо trigger — принимается.**  
Главный запрет соблюдён:
2. **Но это не новый RPC, а переписывание существующего** `create_support_ticket`**.**  
Это допустимо, потому что discovery подтвердил: frontend уже вызывает RPC и читает `ticket_id` из JSONB. Но в proof обязательно показать:
  - старая сигнатура совместима;
  - старые вызовы с 3 параметрами работают;
  - новый `p_attachments` с default не ломает существующий `rpc()`.
3. **Проверить имя генератора номера тикета.**  
В схеме указано default `generate_ticket_number()`, а в SQL-плане используется:
  &nbsp;
  ```sql
  generate_ticket_number_atomic()
  ```
  Перед миграцией подтвердить, какая функция реально существует и какая используется старой `create_support_ticket`.
  Если старая RPC уже использовала `generate_ticket_number_atomic()` — оставить.  
  Если нет — использовать существующий механизм без смены поведения.
4. `FOR UPDATE` **в текущем SELECT не защищает от гонки, если активного тикета ещё нет.**  
При двух параллельных запросах, когда open ticket отсутствует, оба могут не найти строку и оба создать новый тикет.
  &nbsp;
  В этом патче можно не делать unique index, но нужно добавить advisory lock на пользователя:
  ```sql
  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));
  ```
  Сразу после определения `v_user_id`, до поиска активного тикета.
  Это даст атомарность без unique index и без trigger.
5. **Искать активный тикет лучше по** `profile_id` **или по** `user_id` **— нужно зафиксировать.**  
В плане цель — “один активный тикет на клиента”. Если `support_tickets.profile_id NOT NULL`, а `user_id nullable`, безопаснее искать так:
  &nbsp;
  ```sql
  WHERE profile_id = v_profile_id
    AND status IN (...)
  ```
  Либо по обоим:
  ```sql
  WHERE profile_id = v_profile_id
     OR user_id = v_user_id
  ```
  Но `OR` может дать чужие/старые связи, если данные кривые. Рекомендация:
  ```text
  канон dedupe = profile_id
  user_id используется как дополнительное поле создаваемого тикета
  ```
  Перед реализацией подтвердить по существующему коду `/support`, что у клиента всегда есть `profiles.id`.
6. **Если у пользователя уже есть 4 открытых тикета, append должен идти в самый свежий, но proof должен это явно показать.**  
Сейчас план выбирает:
  &nbsp;
  ```sql
  ORDER BY updated_at DESC LIMIT 1
  ```
  Это нормально, потому что старые дубли не merge-им. В proof указать:
7. `p_subject` **тоже нужно валидировать только при создании нового тикета.**  
Для append-ветки subject может быть пустым или новым, но тикет уже существует. Логика:
  - `p_description` обязателен всегда;
  - `p_subject` обязателен только если создаётся новый тикет;
  - если append — subject можно игнорировать или сохранить в message metadata не надо.
  Если frontend CreateTicketDialog всегда требует subject, можно оставить, но RPC лучше не падать на пустом subject при append.
8. `p_attachments` **нужно валидировать как массив.**  
Добавить guard:
9. **Не проглатывать все ошибки как** `database_error` **без логирования.**  
Возврат JSON можно оставить, но в proof/коде желательно не скрывать диагностику полностью. Минимум:
  &nbsp;
  ```sql
  'error', SQLERRM
  ```
  уже есть. При наличии audit/log-инфраструктуры — не обязательно, но можно не добавлять.
10. `has_unread_user` **при append от клиента не должен становиться true.**  
В плане это не меняется — правильно. Для клиента его же сообщение не должно создавать unread для клиента.

Для append:

```sql
has_unread_admin = true
has_unread_user — не менять
```

11. `is_read` **для сообщения клиента проверить по текущей семантике.**  
В плане `is_read=false`. Если текущая функция уже создаёт первое сообщение клиента с `is_read=false`, оставить. Если иначе — сохранить существующее поведение.
12. **Frontend toast должен быть аккуратным.**  
Для `created_new=false`:

```text
Сообщение добавлено в существующее обращение #...
```

Это хорошо. Но не писать пользователю “тикет не создан”, чтобы не было ощущения ошибки.

13. `useCreateTicket` **должен возвращать реальный** `ticket_id`**, а не объект старой формы.**  
В proof показать:

- первый запрос → `created_new=true`, `ticket_id=A`;
- второй запрос → `created_new=false`, `ticket_id=A`;
- UI открывает `A`.

14. **Инвалидации расширить ещё на support unified/query keys.**  
Помимо:

```text
["user-tickets"]
["ticket-messages", ticket_id]
["unified-support-tickets"]
```

проверить реальные query keys в проекте. Если mono-support использует другие ключи — инвалидировать их тоже.

15. **Realtime не считать достаточным proof.**  
Даже если подписки есть, после RPC нужно делать invalidate вручную. Realtime может прийти с задержкой или не прийти в Preview.
16. **В DoD “unified показывает одну строку на клиента” уточнить.**  
Так как старые 4 открытых тикета не merge-ятся, unified может всё ещё показывать несколько старых строк для проблемного пользователя.

Корректная формулировка:

```text
Для новых повторных обращений не создаётся новая строка; сообщение добавляется в выбранный существующий активный тикет.
```

Не обещать, что старые дубли исчезнут.

17. **Проверить поведение resolved/closed.**  
Для клиента с только `resolved/closed` должен создаваться новый тикет. В proof показать SQL/скрин.
18. **Проверить RLS/SECURITY DEFINER.**  
Функция `SECURITY DEFINER`, но должна:

- использовать `auth.uid()`;
- не принимать `user_id` с фронта;
- не позволять клиенту писать в чужой тикет;
- искать profile только по `profiles.user_id = auth.uid()`.

Это в плане есть — сохранить.

19. **Rollback обязательно добавить.**  
Так как это `CREATE OR REPLACE FUNCTION`, rollback — вернуть предыдущую версию `create_support_ticket`.

В audit указать:

- файл миграции;
- rollback SQL / ссылка на previous function;
- что данных migration не меняет.

20. **Proof по отсутствию триггеров/unique index.**  
В proof добавить:

```sql
SELECT trigger_name
FROM information_schema.triggers
WHERE event_object_table='support_tickets';

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename='support_tickets'
  AND indexdef ILIKE '%status IN%';
```

И показать, что новых forbidden-механизмов нет.

21. **Название отчёта:**

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-SUPPORT-TICKET-DEDUPLICATION
```

22. **Финальный статус после успешного proof:**

```text
Support ticket deduplication — PASS
Existing duplicate tickets — not merged
New duplicate client requests — append to latest active ticket
Hidden triggers / unique index — not used
```

После этих правок план утверждён. Выполнять только этот патч, не начинать `ADMIN-START-SUPPORT-TICKET`.

&nbsp;

План: PATCH-CONTACT-CENTER-SUPPORT-TICKET-DEDUPLICATION

## Цель

Один активный тикет на клиента. Если у пользователя уже есть open/in_progress/waiting_user тикет — новый запрос дописывается сообщением в существующий. Никаких BEFORE INSERT триггеров, отменяющих вставку, никаких unique index'ов, никакого merge истории.

## Итоги discovery

### 1. `support_tickets` — реальная схема

Ключевые поля: `id`, `ticket_number` (default `generate_ticket_number()`), `profile_id NOT NULL`, `user_id` nullable, `subject NOT NULL`, `description NOT NULL`, `category` default `'general'`, `status NOT NULL` default `'open'`, `priority` default `'normal'`, `has_unread_admin/has_unread_user`, `is_starred`, `is_pinned/pinned_at` (из V2-FILTERS-AND-ACTIONS), `assigned_to`, `first_response_at/resolved_at/closed_at`, `telegram_bridge_enabled/telegram_user_id`.

Check-constraint: `status ∈ {open, in_progress, waiting_user, resolved, closed}` — «активными» считаем `open, in_progress, waiting_user`.

Триггеры на таблице: только `update_support_tickets_updated_at BEFORE UPDATE`. Никаких BEFORE INSERT — запрет плана не нарушается ничем существующим.

### 2. `ticket_messages` — реальная схема

`id`, `ticket_id NOT NULL`, `author_id`, `author_type NOT NULL` (check: `user | support | system`), `author_name`, `message NOT NULL`, `attachments jsonb default '[]'`, `is_internal`, `is_read`, `created_at`, `display_user_id`.

RLS:

- клиент вставляет только `author_type='user'` и только в свой тикет (EXISTS по `support_tickets.user_id = auth.uid()`);
- support вставляет при `has_permission('support.manage'|'admins.manage')`.

Дополнительных триггеров нет.

### 3. Статусы в БД

`resolved` 105, `closed` 72, `open` 6. `in_progress` и `waiting_user` не используются, но код и check-constraint их допускают — включаем в набор «активные».

### 4. Дубли на сегодня

Активных тикетов с 2+ на одного `user_id`: **1 пользователь (4 открытых тикета)**. Проблема реальна, но не массовая — миграция данных не требуется (пункт «merge старых дублей» запрещён), дедуп применяется только к новым входящим запросам.

### 5. Текущая точка создания

`src/pages/Support.tsx` → `CreateTicketDialog` → `useCreateTicket` (`src/hooks/useTickets.ts:338-398`) → RPC `create_support_ticket(p_subject, p_description, p_category)` (SECURITY DEFINER, возвращает `jsonb`).

Существующий RPC уже:

- проверяет `auth.uid()` и `profile_id`;
- атомарно создаёт `support_tickets` + первое `ticket_messages`;
- возвращает `{success, ticket_id, ticket_number}` или `{success:false, error, error_code}`.

Frontend НЕ ждёт INSERT-RETURNING 0 rows — он читает `response.ticket_id` из jsonb. Значит замена SQL внутри функции безопасна: контракт `{success, ticket_id, ticket_number}` можно расширить полем `created_new`, а frontend доработать точечно.

`useSendMessage` (client add message) уже пишет в `ticket_messages` через прямой INSERT — трогать его не нужно, он используется на «открытом тикете», у которого уже есть `ticket_id`.

### 6. Регистрируемые эффекты, которые нужно сохранить в append-ветке

- `updated_at = now()` — иначе unified/mono сортировка сломается;
- `has_unread_admin = true` — иначе оператор не увидит новое сообщение как непрочитанное;
- если тикет был `waiting_user` — вернуть его в `open` (клиент снова активен). `in_progress`/`open` оставляем как есть, `closed/resolved` в append не попадают вообще.

## Реализация

### Шаг 1. Миграция: переписать `create_support_ticket`

Единственный SQL-контракт, без hidden trigger, без unique index, без merge истории.

```
CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject text,
  p_description text,
  p_category text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile_id uuid;
  v_existing_id uuid;
  v_existing_number text;
  v_existing_status text;
  v_ticket_id uuid;
  v_ticket_number text;
  v_message_id uuid;
  v_body text := NULLIF(trim(p_description), '');
  v_created_new boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_authenticated');
  END IF;
  SELECT id INTO v_profile_id FROM profiles WHERE user_id = v_user_id;
  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'profile_not_found');
  END IF;
  IF v_body IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'description_required');
  END IF;

  -- Ищем самый свежий активный тикет пользователя
  SELECT id, ticket_number, status
    INTO v_existing_id, v_existing_number, v_existing_status
  FROM support_tickets
  WHERE user_id = v_user_id
    AND status IN ('open','in_progress','waiting_user')
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    -- Append: дописываем сообщение в существующий тикет
    INSERT INTO ticket_messages (ticket_id, author_id, author_type, message, attachments, is_internal, is_read)
    VALUES (v_existing_id, v_user_id, 'user', v_body, COALESCE(p_attachments,'[]'::jsonb), false, false)
    RETURNING id INTO v_message_id;

    UPDATE support_tickets
    SET has_unread_admin = true,
        status = CASE WHEN status = 'waiting_user' THEN 'open' ELSE status END,
        updated_at = now()
    WHERE id = v_existing_id
    RETURNING status INTO v_existing_status;

    v_ticket_id := v_existing_id;
    v_ticket_number := v_existing_number;
  ELSE
    -- Создаём новый тикет + первое сообщение (как раньше)
    v_ticket_number := generate_ticket_number_atomic();
    INSERT INTO support_tickets (user_id, profile_id, subject, description, category,
      ticket_number, status, priority, has_unread_admin, has_unread_user, updated_at)
    VALUES (v_user_id, v_profile_id, p_subject, v_body, COALESCE(p_category,'general'),
      v_ticket_number, 'open', 'normal', true, false, now())
    RETURNING id INTO v_ticket_id;

    INSERT INTO ticket_messages (ticket_id, author_id, author_type, message, attachments, is_internal, is_read)
    VALUES (v_ticket_id, v_user_id, 'user', v_body, COALESCE(p_attachments,'[]'::jsonb), false, false)
    RETURNING id INTO v_message_id;

    v_created_new := true;
    v_existing_status := 'open';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', v_ticket_id,
    'ticket_number', v_ticket_number,
    'message_id', v_message_id,
    'status', v_existing_status,
    'created_new', v_created_new
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'error_code', 'database_error');
END; $$;
```

Что НЕ меняется: сигнатура (три первых параметра совпадают, `p_attachments` — новый с дефолтом, старые вызовы работают), тип возврата (`jsonb`), базовые ключи `success/ticket_id/ticket_number`. Никаких unique index'ов, никаких триггеров.

### Шаг 2. Frontend `useCreateTicket` (`src/hooks/useTickets.ts`)

- добавить в `CreateTicketData` опциональный `attachments?: any[]` и пробросить в RPC;
- расширить обработчик ответа: читать `response.created_new`, `response.status`;
- вернуть из мутации `{ id, ticket_number, created_new }`;
- в `onSuccess` инвалидацию расширить: `["user-tickets"]`, `["ticket-messages", response.ticket_id]`, `["unified-support-tickets"]`;
- тост: `created_new ? "Обращение создано" : "Сообщение добавлено в существующий тикет #<number>"`.

### Шаг 3. `CreateTicketDialog` + `Support.tsx`

- после успеха диалога навигировать на `?ticket=<returned ticket_id>` (уже так и делается — просто убедиться, что открывается `ticket_id` из RPC-ответа, а не сгенерированный клиентом);
- если `created_new=false` — не пересоздавать subject/category в UI: просто закрыть диалог и открыть существующий тикет с приложенным сообщением.

### Шаг 4. Проверки без модификаций

- `useSendMessage` — не трогаем; он и так append.
- Unified `useUnifiedInbox` — не трогаем; append приводит к `updated_at=now()` и `has_unread_admin=true`, что уже поднимает строку в топ и пересчитывает `Новые`.
- Realtime — существующие подписки `useInboxRealtimeInvalidation` уже слушают `support_tickets` и `ticket_messages`.

## Что запрещено (закрепляем)

- BEFORE INSERT trigger, отменяющий INSERT (RETURN NULL) — **не делаем**.
- unique index на `(user_id) WHERE status IN (...)` — **не делаем**.
- Merge/слияние существующих дублей у пользователя `e296da5b-...` — **не делаем**, только для новых запросов.
- Админский путь «создать тикет за клиента» — **вне этого патча**.

## Регрессия

- клиент без активного тикета → создаётся новый (`created_new=true`);
- клиент с активным тикетом → сообщение добавляется в него (`created_new=false`), `updated_at`/`has_unread_admin` обновились, `waiting_user → open`;
- клиент с только `resolved/closed` → создаётся новый;
- frontend навигирует на возвращённый `ticket_id`;
- unified показывает одну строку на клиента;
- mono `/support` работает (список тикетов, открытие, отправка);
- typecheck по `useTickets.ts`, `CreateTicketDialog.tsx`, `Support.tsx` — чисто;
- в консоли нет ошибок.

## Proof

`docs/audit/2026-07-04-support-ticket-deduplication.md` — SQL diff RPC, скриншоты «до/после» на тестовом клиенте (без активного → создание; повторный запрос → append в тот же ticket_id), выборка `SELECT count(*) ... GROUP BY user_id HAVING count>1` до и после (для новых запросов дубли не должны появляться).

## DoD

- Клиент без open → новый тикет.
- Клиент с open → сообщение в существующий.
- Frontend открывает вернувшийся `ticket_id`.
- Unified показывает одну строку.
- Оператор видит новое сообщение и `has_unread_admin=true`.
- Mono `/support` работает.
- Unified Support работает.
- Статусы не ломаются (`waiting_user → open`, остальное без изменений).
- Typecheck clean.
- Никаких новых триггеров, unique index'ов и hidden отмен INSERT.