# PATCH-CONTACT-CENTER-SUPPORT-TICKET-DEDUPLICATION

Дата: 2026-07-04
Область: `/support` (создание обращений клиентом), unified inbox (Support).

## Цель
Один активный тикет на клиента. Если у клиента уже есть тикет в статусе `open | in_progress | waiting_user` — новое обращение из формы `/support` дописывается сообщением в этот тикет. Иначе — создаётся новый.

## Что сделано

### 1. RPC `public.create_support_ticket` — переписан (SECURITY DEFINER, jsonb → jsonb)
Signature-совместимо со старой версией: первые 3 параметра прежние, добавлен `p_attachments jsonb DEFAULT '[]'`. Тип возврата не менялся.

Ключевые решения:
- **Dedupe key = `profile_id`** (canonical, NOT NULL). `user_id` пишется в новый тикет как раньше.
- **Race-safety** без unique index / trigger: `pg_advisory_xact_lock(hashtext(v_profile_id::text))` перед SELECT активного тикета.
- **Поиск активного тикета**: `WHERE profile_id = v_profile_id AND status IN ('open','in_progress','waiting_user') ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`.
- **Append-ветка**:
  - INSERT в `ticket_messages` (`author_type='user'`, `is_read=false`, `attachments = p_attachments`);
  - UPDATE `support_tickets`: `has_unread_admin=true`, `updated_at=now()`, `status = CASE WHEN status='waiting_user' THEN 'open' ELSE status END`;
  - **`has_unread_user` НЕ трогается** — собственное сообщение клиента не должно поднимать unread у него.
- **Create-ветка**: как раньше (INSERT ticket + первое сообщение, `generate_ticket_number_atomic()`). `subject` обязателен только здесь.
- **Валидации**: `not_authenticated`, `profile_not_found`, `description_required`, `subject_required` (только новый), `attachments_invalid` (не массив).
- **Возврат**: `{success, ticket_id, ticket_number, message_id, status, created_new}`. Старые поля сохранены → обратная совместимость.

### 2. Frontend `src/hooks/useTickets.ts` — `useCreateTicket`
- В `CreateTicketData` добавлен `attachments?: TicketAttachment[]`, прокидывается в RPC как `p_attachments`.
- Обработка расширенного response: `created_new`, `status`, `message_id`.
- Точные error-коды маппятся в понятные сообщения (не по `includes`).
- `onSuccess` инвалидирует: `["user-tickets"]`, `["ticket-messages", ticket_id]`, `["unified-support-tickets"]`, `["unified-inbox"]` (не полагаемся только на realtime).
- Toast:
  - `created_new=true` → «Обращение создано / Мы ответим в ближайшее время»;
  - `created_new=false` → «Сообщение добавлено / Ваше сообщение добавлено в существующее обращение #NUMBER».

### 3. Что НЕ трогалось
- `CreateTicketDialog.tsx` — по-прежнему закрывается после успеха, `useUserTickets` перерисует список (сортировка по `updated_at DESC` поднимет затронутый тикет наверх).
- `useSendMessage` — не менялся; это append на уже открытом тикете.
- `useUnifiedInbox`, `useInboxRealtimeInvalidation` — не менялись; append естественно обновляет unified через `updated_at` + `has_unread_admin`.

## Что запрещено и НЕ сделано
- BEFORE INSERT trigger с `RETURN NULL` — не создан.
- Unique index `(profile_id) WHERE status IN (...)` — не создан.
- Merge существующих исторических дублей (1 пользователь `e296da5b-...` c 4 открытыми тикетами) — не делается.
- Админский путь «создать тикет за клиента» — вне патча.

## Proof: отсутствие запретных механизмов

```sql
-- Триггеры на support_tickets
SELECT tgname FROM pg_trigger
WHERE tgrelid='public.support_tickets'::regclass AND NOT tgisinternal;
-- => update_support_tickets_updated_at  (только BEFORE UPDATE, из существующей инфраструктуры)

-- Unique-индексы на support_tickets
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename='support_tickets' AND indexdef ILIKE '%unique%';
-- => support_tickets_pkey, support_tickets_ticket_number_key
-- Никаких partial unique по (profile_id, status).
```

## Regression checklist

| Кейс | Ожидание | Как проверять |
|---|---|---|
| Клиент без активного тикета отправляет форму | RPC → `created_new=true`, новый `ticket_id`, тост «Обращение создано» | вручную под клиентом с только `resolved/closed` |
| Клиент с активным тикетом отправляет форму повторно | RPC → `created_new=false`, тот же `ticket_id`, тост «Сообщение добавлено #NUMBER», сообщение видно в тикете | вручную |
| Параллельные запросы того же клиента | Только один тикет в итоге (сериализация advisory-lock) | нагрузочная проверка не требуется, гарантируется lock |
| Клиент с `waiting_user` тикетом → отправляет | Статус тикета переходит в `open`, сообщение append | вручную |
| Обратная совместимость сигнатуры | Старые вызовы без `p_attachments` работают | default `'[]'::jsonb` |
| `has_unread_user` в append | НЕ становится `true` | UPDATE не трогает поле |
| Оператор в unified видит новое сообщение | Строка поднимается наверх, `has_unread_admin=true`, счётчик «Новые» реагирует | ручной прогон |
| Mono `/support` — список/открытие/отправка | Работает | ручной прогон |
| Typecheck | clean | `bunx tsgo -p tsconfig.app.json` ✅ |

## Rollback
Файл миграции: `supabase/migrations/2026-07-04*_create_support_ticket_dedupe.sql`.
Rollback = `CREATE OR REPLACE FUNCTION create_support_ticket(text, text, text)` с телом из discovery-снимка (create-only ветка) и `DROP FUNCTION create_support_ticket(text,text,text,jsonb)` — либо просто вернуть предыдущий SQL функции. Данных миграция не меняет.

## Финальный статус (после ручной проверки regression checklist)
- Support ticket deduplication — PASS
- Existing duplicate tickets — not merged (by design)
- New duplicate client requests — append to latest active ticket
- Hidden triggers / unique index — not used
