# да, согласен, с учетом правок:

План в целом корректно устраняет найденные блокеры S2/S3. Перед выполнением нужно внести следующие обязательные изменения.

Да, согласен, с учетом правок:

1. Не менять сигнатуру уже развёрнутых RPC через `DROP FUNCTION` в основной миграции.

Считать, что текущие функции уже могут вызываться production-фронтом. Использовать безопасный compatibility-flow:

- создать `mark_dialog_read_v2(p_user_id uuid, p_boundary timestamptz)`;
- создать `bulk_mark_dialogs_read_v2(p_items jsonb)`;
- переключить frontend на V2;
- выполнить runtime/proof;
- старые `mark_dialog_read_atomic` и `bulk_mark_dialogs_read_atomic` пока оставить как deprecated compatibility layer;
- удалять старые RPC только отдельным cleanup-патчем после доказательства отсутствия вызовов.

Нельзя допускать окно, в котором старый frontend вызывает уже удалённую функцию.

2. Boundary после отправки сообщения фиксировать ДО начала отправки, а не внутри `onMessageSent`.

Правильный flow:

- перед вызовом `telegram-admin-chat` сохранить `observedIncomingBoundary`;
- выполнить отправку;
- только при подтверждённом `success=true` передать ранее сохранённую boundary в mark-as-read;
- incoming, пришедший во время отправки, не должен попасть в эту boundary, даже если realtime уже добавил его в клиентский cache к моменту `onMessageSent`.

3. Явно разделить boundary для разных действий:

- открытый чат + ответ оператора:  
`MAX(created_at)` среди incoming, загруженных до начала отправки;
- ручная отметка одного диалога из списка:  
`last_message_at` строки списка допустима как observed preview boundary;
- bulk mark:  
собственный `last_message_at` для каждого выбранного диалога;
- boundary отсутствует:  
RPC не вызывается, cache не меняется, показывается понятный toast, а не только `console.warn`.

4. Серверная V2 RPC должна строго валидировать boundary:

- `p_boundary IS NULL` → `boundary_required`, SQLSTATE `22023`;
- boundary в будущем относительно серверного времени с заметным допуском → STOP/error;
- `p_user_id IS NULL` → validation error, а не тихий no-op;
- timestamp возвращать в ответе ровно тот, который фактически применён.

5. Для одиночной RPC утвердить структурированный контракт:

```text
dialog_user_id
boundary
marked_count
remaining_unread_count
```

В одной транзакции:

1. UPDATE только сообщений `created_at <= boundary`;
2. подсчёт всех оставшихся unread;
3. возврат результата.

Frontend устанавливает `unread_count` исключительно по `remaining_unread_count`.

6. Bulk RPC не должна молча отбрасывать невалидные элементы.

Вместо частичного silent processing:

- проверить, что `p_items` является массивом;
- установить разумный batch limit;
- каждый элемент обязан содержать валидные `user_id` и `boundary`;
- дубликаты `user_id` дедуплицировать детерминированно либо отклонять;
- при любом невалидном элементе отклонять весь запрос с validation error;
- не создавать частично выполненный bulk без явного контракта.

Audit invalid input можно писать одной агрегированной записью, но он не заменяет ошибку вызывающему клиенту.

7. Ограничить размер bulk-запроса.

Добавить guard, например:

```text
1 <= количество элементов <= безопасный установленный лимит
```

При превышении лимита — STOP/error без UPDATE.

Не допускать произвольный JSON-массив неограниченного размера в `SECURITY DEFINER` RPC.

8. Уточнить доступ service role.

Текущий guard через `auth.uid()` несовместим с обычным вызовом service role без пользовательского JWT.

Выбрать один вариант:

- если service role для этих RPC не требуется — не выдавать ей отдельный GRANT;
- если требуется системный вызов — добавить отдельный явно ограниченный system-path и audit.

Не оставлять формальный `GRANT service_role`, который фактически всегда падает на `auth.uid() IS NULL`.

9. TTL-guard realtime нельзя реализовывать как локальный `Set` внутри несвязанных компонентов.

Нужен один shared coordination layer, доступный mutation и realtime bus:

- до RPC зарегистрировать `{user_id, operation_id, expires_at}`;
- при ошибке RPC удалить регистрацию немедленно;
- при успехе оставить только на время доставки row-events;
- cleanup timer обязателен;
- повторный mount не должен терять или дублировать registry;
- incoming INSERT никогда не подавляется;
- подавляются только ожидаемые UPDATE `is_read: false → true`.

Если надёжно определить ожидаемое собственное событие невозможно, не использовать хрупкий TTL suppression. Допустим один debounced reconciliation-refetch после пачки UPDATE, но запрещены повторные запросы на каждую строку.

10. Не полагаться на `commit_timestamp` как на признак собственного события.

`commit_timestamp` не идентифицирует инициатора. Он может использоваться только как временная метка, но не как доказательство ownership.

Proof должен показать:

- собственная mutation не вызывает дублирующий Network request;
- изменение другим оператором не теряется;
- новое incoming не проглатывается;
- после TTL cache остаётся консистентным.

11. Добавить fallback reconciliation после точечного cache patch.

Основной flow:

- RPC response;
- `setQueryData` по `remaining_unread_count`;
- без немедленного полного invalidate.

Но нужен один контролируемый safety reconciliation:

- либо trailing debounced refetch после завершения row-event burst;
- либо delayed refetch через ограниченный интервал;
- без одновременного mutation invalidate + realtime invalidate + manual refetch.

В proof показать фактическое число Network requests.

12. Для permission proof использовать реальный JWT-контекст.

`SET LOCAL ROLE authenticated` сам по себе не формирует `auth.uid()` и может доказать только часть поведения.

Нужно проверить минимум:

- anon без JWT;
- authenticated JWT без admin/superadmin;
- admin JWT;
- superadmin JWT;
- при наличии system-path — отдельный system proof.

Ожидание для первых двух: SQLSTATE `42501`.

13. Concurrency fixture выполнять только на выделенном тестовом диалоге.

Обязательно:

- подтвердить, что UUID относится к тестовому профилю;
- добавить test metadata;
- сохранить созданные message IDs;
- после proof удалить fixture либо вернуть исходный `is_read`;
- не использовать данные реального клиента;
- зафиксировать cleanup.

14. S3 parity проверять не через один `array_agg(row(...))`.

Использовать более доказуемый двусторонний diff:

```sql
old_result
EXCEPT ALL
new_result;

new_result
EXCEPT ALL
old_result;
```

Оба результата должны вернуть 0 строк.

Проверить матрицу:

- `p_search=NULL`;
- `p_search=''`;
- search по имени;
- search по email;
- search без результатов;
- `limit=1/50/200`;
- несколько offset;
- unread=0 и unread>0;
- pending media true/false;
- несколько ботов;
- одинаковый `created_at` у сообщений.

15. Для одинакового `created_at` добавить детерминированный tie-breaker.

В LATERAL last-message:

```sql
ORDER BY created_at DESC, id DESC
```

Старый и новый RPC должны выбирать одно и то же сообщение при равном timestamp. Иначе row-by-row parity может быть недетерминированной.

16. S3 performance proof выполнять со строгими guards:

- `statement_timeout`;
- `lock_timeout`;
- только read-only;
- вне пикового окна;
- ограниченное число повторов;
- old/new функции под разными временными именами;
- никаких изменений production-данных;
- после proof временные функции удалить.

`pg_stat_statements` использовать только если можно изолировать конкретные query IDs. Иначе снимать client-side timings 20 одинаковых прогонов и считать P50/P95 отдельно.

17. Не утверждать заранее, что новый LATERAL-вариант лучше.

Решение принимается только после proof:

- parity = 100%;
- новый P95 не хуже старого;
- buffers/rows scanned не хуже;
- search и pagination корректны.

Если доказательства нет или новый вариант хуже — немедленно восстановить старую функцию.

18. Rollback SQL нельзя помещать в обычную папку `supabase/migrations/`, если он не должен автоматически применяться.

Файл вида:

```text
supabase/migrations/<ts>_restore_get_inbox_dialogs_v1.sql
```

будет воспринят как обычная следующая миграция и может автоматически отменить исправление.

Хранить rollback-артефакты отдельно, например:

```text
.lovable/rollback/contact_center/
supabase/rollback/
```

или в proof-файле как полный исполняемый SQL.

В основной migrations-папке должны находиться только миграции, которые действительно должны применяться по порядку.

19. Не создавать «пустую rollback migration» с закомментированным DROP.

Она не даёт реального rollback и засоряет историю миграций.

Нужно сохранить:

- полный restore SQL старого `get_inbox_dialogs_v1`;
- полный cleanup SQL deprecated RPC;
- точный порядок применения;
- проверки до и после rollback.

20. Rollback порядок зафиксировать так:
21. выкатить frontend compatibility, который не зависит от V2;
22. проверить отсутствие вызовов V2;
23. восстановить старое тело `get_inbox_dialogs_v1`;
24. проверить старый UI flow;
25. отдельным cleanup удалить V2 RPC;
26. deprecated V1 удалить только после подтверждения отсутствия вызовов.
27. S4 housekeeping принимается без изменения кода.

Статус оставить:

```text
ENGINEERING IMPLEMENTED
LIVE MOBILE UAT PENDING
```

Anti-duplication proof через `rg` достаточен только для hooks-каталога. Дополнительно проверить `visualViewport` по всему `src`, чтобы исключить локальную реализацию внутри компонентов.

22. Финальный corrective proof должен отдельно показать:

- реальные имена V2 RPC;
- старые RPC оставлены или удалены;
- frontend commit, который переключает вызовы;
- boundary captured before send;
- concurrency result;
- remaining unread result;
- permission matrix;
- realtime Network count;
- S3 EXPLAIN old/new;
- EXCEPT ALL parity matrix;
- расположение rollback SQL вне migrations;
- cleanup временных функций и тестовых данных.

23. Финальный заголовок:

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-FIX-V1 — корректирующий проход S2/S3
```

После внесения этих правок план считается утверждённым. Выполнять корректирующий проход без нового общего discovery и без дополнительных промежуточных согласований, кроме фактического критического STOP-guard.

Ключевые обязательные изменения: **V2 compatibility вместо DROP существующих RPC, boundary фиксируется до отправки, bulk не выполняется частично, rollback SQL не размещается среди автоматически применяемых миграций**. Это соответствует обязательному безопасному циклу и запрету ломать существующую production-логику.  

&nbsp;

План: PATCH-CONTACT-CENTER-FIX-V1 — корректирующий проход (S2/S3 + housekeeping S4)

Новый общий discovery не выполняется. Корректируем существующий спринт по 11 пунктам из ревью. Никаких изменений в исключённых доменах (доступы, billing, broadcasts, Stripe/bePaid, RLS чужих таблиц, Storage, telegram lifecycle).

## Главный блокер

S2 в текущем виде может пометить прочитанным incoming, которого оператор ещё не видел: серверный `now()` фиксирует время выполнения RPC, а не observed snapshot. Все правки ниже устраняют именно это.

---

## S2 — Корректирующий патч (FAIL → PASS)

### 2.1 Канон observed boundary

- Источник истины: `MAX(created_at)` среди реально загруженных incoming-сообщений диалога. Это серверные timestamptz из ответа edge function `telegram-admin-chat` action `get_messages` (в `ContactTelegramChat.tsx` уже есть кэш `["telegram-messages", userId]`). Никакого `new Date()` на клиенте.
- В `InboxTabContent.tsx` при клике «отметить прочитанным» или после успешной отправки ответа клиент вычисляет boundary из ближайшего источника:
  1. кэш `["telegram-messages", userId]` (если чат открывался — есть точная граница);
  2. fallback: значение `last_message_at` из строки `INBOX_DIALOGS_QK` для этого `user_id` (доказанно серверное и не больше реально показанного last preview);
  3. если ни одного источника нет → mutation не отправляется, кнопка не вызывает RPC и UI не меняется (graceful no-op + console.warn). Это явно отдельный режим — пользовательский flow никогда не уходит в `now()`.

### 2.2 RPC `mark_dialog_read_atomic` — новый структурированный контракт

Меняется сигнатура (создаём миграцию с `CREATE OR REPLACE`, тип возврата другой → сначала `DROP FUNCTION ... mark_dialog_read_atomic(uuid, timestamptz)` в той же миграции, так как функция была применена в этом же спринте и фронт ещё не в проде — приемлемо). Если на момент применения уже есть production-трафик — миграция выполняется в порядке: создаём новую функцию `mark_dialog_read_v2(...)`, переключаем фронт, затем drop старой.

```sql
CREATE OR REPLACE FUNCTION public.mark_dialog_read_atomic(
  p_user_id  uuid,
  p_boundary timestamptz       -- обязательный, без DEFAULT
)
RETURNS TABLE(
  dialog_user_id          uuid,
  boundary                timestamptz,
  marked_count            integer,
  remaining_unread_count  integer
)
```

Поведение:

- `p_boundary IS NULL` → `RAISE EXCEPTION 'boundary_required' USING ERRCODE='22023'`. Никакого fallback на `now()`.
- admin guard (`auth.uid()` + `has_role(admin|superadmin)`) сохранён.
- `UPDATE ... WHERE user_id=p_user_id AND direction='incoming' AND is_read=false AND created_at <= p_boundary` → `marked_count`.
- В той же транзакции: `SELECT count(*) FROM telegram_messages WHERE user_id=p_user_id AND direction='incoming' AND is_read=false` → `remaining_unread_count`. Любое incoming, пришедшее в T2 ∈ (T_boundary, T_RPC], попадает в remaining и остаётся unread.
- `REVOKE FROM PUBLIC` + `GRANT EXECUTE` только `authenticated`, `service_role`.

### 2.3 RPC `bulk_mark_dialogs_read_atomic` — per-dialog контракт

```sql
CREATE OR REPLACE FUNCTION public.bulk_mark_dialogs_read_atomic(
  p_items jsonb              -- [{ "user_id": "...", "boundary": "..." }, ...]
)
RETURNS TABLE(
  dialog_user_id         uuid,
  boundary               timestamptz,
  marked_count           integer,
  remaining_unread_count integer
)
```

- Каждая запись — собственная granular boundary. Один общий `now()` запрещён.
- Валидация: пустой массив → пустой результат; элементы без `user_id` или `boundary` отбрасываются с записью в `audit_logs` (`telegram.mark_read.invalid_item`).
- Внутри один цикл `FOR rec IN SELECT ... FROM jsonb_to_recordset(p_items)`, каждое обновление — собственный `UPDATE ... RETURNING` + локальный count. Идемпотентно.

### 2.4 Frontend контракт mutations

В `InboxTabContent.tsx`:

- `markAsRead.mutationFn` принимает `{ userId, boundary }`; если `boundary` не получен — функция не запускается (см. 2.1).
- `onMutate` больше **не** ставит безусловный `unread_count = 0`. Вместо этого:
  - snapshot кэша сохраняется (rollback на ошибку);
  - UI оставляет текущее значение до ответа сервера, чтобы избежать ложного нуля.
- `onSuccess(data)` патчит ровно одну строку диалога: `unread_count = data.remaining_unread_count`. Никаких полных invalidate — это убирает дубликат с realtime-bus.
- `onError` — восстанавливает snapshot, тост через `normalizeEdgeFunctionError`.
- `bulkMarkAsRead` собирает массив `{ user_id, boundary }` из текущего кэша `INBOX_DIALOGS_QK` (по `last_message_at` каждого выбранного диалога) и патчит результат построчно.
- Триггер после отправки ответа (`onMessageSent`) использует `MAX(created_at)` из локального `["telegram-messages", userId]` (всегда есть, чат открыт).

### 2.5 Удаление двойной инвалидации

- `mark_dialog_read_atomic` точечно патчит кэш через `setQueryData`, поэтому **mutation не вызывает invalidateQueries**.
- В `useInboxRealtimeInvalidation.ts` UPDATE-ветка остаётся (для incoming-сообщений от других операторов), но добавляется guard: если payload `new.is_read = true AND payload.commit_timestamp` приходит в окне 1.5 с после нашей собственной mutation — событие проглатывается (используем `Set<string>` recently-marked user_id с TTL). Это устраняет «mutation + realtime = 2 запроса».
- Альтернатива (если guard признаём хрупким): RPC возвращает ответ → клиент патчит → realtime UPDATE на тех же id просто проигнорирован дедупликацией React Query (queryKey уже свежий, in-flight нет). Контракт описывается в proof.

### 2.6 Concurrency proof

Скрипт (SQL fixture, выполняется как часть proof, не как миграция):

```sql
-- T1: snapshot
SELECT max(created_at) FROM telegram_messages
 WHERE user_id=$dialog AND direction='incoming';  -- => B

-- T2: симулируем новое incoming
INSERT INTO telegram_messages (... created_at=now() ...);

-- T3: RPC
SELECT * FROM mark_dialog_read_atomic($dialog, $B);
-- => marked_count = N (старые), remaining_unread_count >= 1 (новое)

SELECT count(*) FROM telegram_messages
 WHERE user_id=$dialog AND direction='incoming' AND is_read=false;  -- = remaining
```

Ожидание: новое сообщение `created_at > B` остаётся `is_read=false`.

### 2.7 Permission-denied proof

```sql
SET LOCAL ROLE authenticated;  -- jwt без admin/superadmin
SELECT * FROM mark_dialog_read_atomic('<uuid>', now());
-- ERROR: forbidden (SQLSTATE 42501)
```

Также: anon → 42501.

---

## S3 — Корректирующий патч (PARTIAL → PASS либо revert)

### 3.1 EXPLAIN/parity proof

Запускаем (read-only) и сохраняем в proof:

- `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM get_inbox_dialogs_v1(50, 0, NULL);` — старое тело (восстанавливается локально в shadow-схеме для замера) и новое.
- P50/P95 за 20 повторов через `pg_stat_statements` (или таймер по запросу).
- Полный row-by-row diff: `SELECT array_agg(row(t.*) ORDER BY user_id) FROM <old>() t` vs `<new>() t` — должно быть идентично (контракт parity по всем столбцам, включая `has_pending_media` и `last_bot_*`).
- Дополнительно: `EXPLAIN` показывает, какой индекс используется в каждом LATERAL.

### 3.2 Признание ограничения

В отчёте честно фиксируется: первый CTE `users AS (SELECT DISTINCT user_id ...)` всё ещё делает полный index scan по `telegram_messages` (хоть и не sort+GROUP BY). Формулировка «full scan устранён» удаляется. Корректный текст: «устранён двойной агрегирующий проход (GROUP BY + DISTINCT ON); распределённая работа на пользователя стала O(unread_index_seek) вместо O(rows_per_user)».

### 3.3 Условие принятия

- Если EXPLAIN/parity proof подтверждает: новая функция не медленнее старой ни на одном из планов и parity 100% → S3 PASS.
- Если хоть один из критериев не выполнен → миграция-restore возвращает прежнее тело RPC.

---

## Rollback — durable

- Создаём файл `supabase/migrations/<ts>_restore_get_inbox_dialogs_v1.sql` со ВЗЯТЫМ ИЗ `pg_get_functiondef` ДО-патч телом (тем, что лежало до S3). Это restore migration в репозитории, не `/tmp`.
- Создаём файл `supabase/migrations/<ts>_restore_mark_dialog_read_atomic.sql` — пустая операция (`-- intentionally empty; rollback path documented below`) + комментированный SQL `DROP FUNCTION` обеих новых RPC.
- Документ rollback процедуры в proof:
  1. выкатить frontend, где `markAsRead`/`bulkMarkAsRead` снова используют прямой `update().eq(...)`;
  2. дождаться отсутствия вызовов новых RPC (логи Edge / PostgREST);
  3. применить restore migration get_inbox_dialogs_v1;
  4. только затем `DROP FUNCTION` mark_dialog_read_atomic / bulk_mark_dialogs_read_atomic.

---

## S4 — статус и anti-duplication

- Статус S4: **ENGINEERING IMPLEMENTED, LIVE MOBILE UAT PENDING**. Не помечать PASS.
- Anti-duplication proof для `useVisualViewportInset`: `rg -n "visualViewport" src/hooks` показывает единственный hook (`src/hooks/useVisualViewportInset.ts`). Других реализаций нет — это новый файл, дубликата не создан. Фиксируем в proof.
- Никаких изменений кода S4 в этом проходе.

---

## Файлы и миграции (минимально)

```text
Миграции:
  supabase/migrations/<ts>_mark_dialog_read_atomic_v2_contract.sql
    - DROP FUNCTION public.mark_dialog_read_atomic(uuid, timestamptz);
    - DROP FUNCTION public.bulk_mark_dialogs_read_atomic(uuid[], timestamptz);
    - CREATE FUNCTION mark_dialog_read_atomic(uuid, timestamptz NOT NULL)
        RETURNS TABLE(dialog_user_id, boundary, marked_count, remaining_unread_count)
    - CREATE FUNCTION bulk_mark_dialogs_read_atomic(p_items jsonb)
        RETURNS TABLE(dialog_user_id, boundary, marked_count, remaining_unread_count)
    - REVOKE/GRANT
  supabase/migrations/<ts>_restore_get_inbox_dialogs_v1.sql   (только для on-demand rollback; не запускать)

Код:
  src/components/admin/communication/InboxTabContent.tsx
    - вычисление boundary из ["telegram-messages", userId] или из INBOX_DIALOGS_QK
    - mutations: новый контракт, no optimistic-zero, setQueryData по remaining_unread_count
    - bulk: сборка jsonb [{user_id, boundary}]
  src/components/admin/ContactTelegramChat.tsx
    - onMessageSent передаёт boundary = max(created_at) incoming из локального кэша
  src/hooks/useInboxRealtimeInvalidation.ts
    - guard «recently-marked user_id TTL 1500 ms» для UPDATE incoming.is_read=true
  src/constants/inboxQueryKeys.ts — без изменений
  src/hooks/useVisualViewportInset.ts — без изменений (anti-duplication подтверждён)
```

## Артефакт

`.lovable/proofs/patch_contact_center_s2_s3_corrective_2026-06-14.md` — содержит:

- boundary contract (источник, fallback, no-op case);
- RPC parity и новый контракт ответа;
- concurrency fixture лог;
- permission-denied лог;
- EXPLAIN (ANALYZE, BUFFERS) старой и новой `get_inbox_dialogs_v1` + P50/P95;
- row-by-row diff parity;
- durable rollback процедуру и пути migration-файлов;
- anti-duplication proof для `useVisualViewportInset`;
- подтверждение отсутствия изменений в исключённых доменах.

## Definition of Done

1. RPC `mark_dialog_read_atomic` требует `p_boundary`, возвращает `(dialog_user_id, boundary, marked_count, remaining_unread_count)`.
2. RPC `bulk_mark_dialogs_read_atomic` принимает `jsonb` per-dialog boundary, возвращает per-dialog результат.
3. Frontend не использует `new Date()` для boundary, не показывает оптимистический ноль до ответа RPC, не вызывает invalidateQueries в mutation success.
4. Realtime bus не порождает повторный refetch на собственное событие mark-as-read (TTL-guard ≥ 1.5 s).
5. Concurrency proof в репозитории: incoming в окне (T_boundary, T_RPC] остаётся unread.
6. Permission-denied proof: anon и authenticated-без-admin → 42501.
7. EXPLAIN/parity proof для `get_inbox_dialogs_v1` принят либо restore migration применена.
8. Restore migration `get_inbox_dialogs_v1` лежит в `supabase/migrations/`, не в `/tmp`.
9. Rollback процедура задокументирована в правильном порядке (frontend → wait → restore → drop).
10. S4 явно остаётся в статусе ENGINEERING IMPLEMENTED / LIVE MOBILE UAT PENDING.
11. Anti-duplication proof для `useVisualViewportInset` сохранён.
12. Изменений в исключённых доменах нет (grep + ручная проверка).

## Что НЕ делается

- Никаких изменений в `access_rules`, `entitlements`, `subscriptions_v2`, `orders_v2`, billing-webhooks, broadcasts, Stripe/bePaid edge functions, Storage policy, telegram grant/queue/lifecycle.
- S0 runtime baseline и S1 live UAT остаются в deferred-листе для единого operational прохода — этим патчем не затрагиваются.
- S4 код не меняется в этом проходе.