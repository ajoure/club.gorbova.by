# Отчет о выполненной работе: PATCH-CONTACT-CENTER-SUPPORT-TICKET-BACKFILL-MERGE

Дата: 2026-07-04
Scope: scoped merge для одного profile (Ольга Мацкевич), без общего backfill.

## Итоговые статусы

| Блок | Статус |
|---|---|
| PATCH B (mono Telegram regression) | PASS |
| PATCH A schema (merged_into_ticket_id, merged_at, RPC, front-end filters) | PASS |
| PATCH A Olga data merge | **PASS** |
| Existing duplicates for Olga | merged into TKT-26-26173 |
| New support dedupe (create_support_ticket) | unchanged and still active |

## Данные

- profile_id: `3c148831-133a-4dad-b978-06cd46b0ea20` (Ольга Мацкевич)
- target: `TKT-26-26173` (`b83a5c97-1538-4789-a631-467b48145d1f`)
- sources:
  - `TKT-26-26177` (`50fe1d8f-fd5a-47e2-b9de-f6414085ee56`) — 2 msg
  - `TKT-26-26179` (`9e51d8d7-0e05-46eb-b961-e4e4a98c283e`) — 3 msg
  - `TKT-26-26180` (`799f1ce4-90b8-4d8e-808d-c2df2fa95062`) — 1 msg
- attachments в sources: 0

## Safety-check (выполнен внутри миграции, DO-блок)

1. Все 4 тикета принадлежат одному profile_id → OK (count = 4)
2. Ни один не closed/resolved → OK
3. `merged_into_ticket_id IS NULL` у всех 4 → OK
4. sources count = 3 → OK

При провале любого — `RAISE EXCEPTION`, транзакция откатывается. Advisory lock `pg_advisory_xact_lock(hashtext(profile_id))` — race-safety.

## Что сделано

1. Перенос `ticket_messages.ticket_id` sources → target (6 сообщений).
2. Перенос `ticket_attachments.ticket_id` sources → target (0 записей).
3. INSERT в `ticket_messages` системного summary в target (`author_type='system'`).
4. UPDATE sources: `status='closed'`, `merged_into_ticket_id=<target>`, `merged_at=now()`, `closed_at=COALESCE(closed_at, now())`, `updated_at=now()`.
5. UPDATE target: `updated_at=now()`, `has_unread_admin=true`.

## Proof (post-execution)

```
 ticket_number | status | merged_into_ticket_id | merged_at | closed_at
 TKT-26-26173  | open   | NULL                  | NULL      | NULL
 TKT-26-26177  | closed | b83a…5d1f             | 2026-07-04| 2026-07-04
 TKT-26-26179  | closed | b83a…5d1f             | 2026-07-04| 2026-07-04
 TKT-26-26180  | closed | b83a…5d1f             | 2026-07-04| 2026-07-04

 ticket_id (target b83a…5d1f) | messages = 12
   (5 original + 6 moved + 1 system = 12)
```

Список сообщений target упорядочен по created_at: 5 исходных user/support сообщений TKT-26-26173, затем перенесённые из sources, финальным идёт system-summary.

## Ожидаемое поведение UI (по фильтрам `merged_into_ticket_id IS NULL` в hooks)

- unified Support для Ольги: **1 строка** (TKT-26-26173).
- mono support (`useAdminTickets`): **1 active row**.
- client `/support` (`useUserTickets`): **1 active row**.
- `create_support_ticket` для Ольги: append в TKT-26-26173 (target `open`, profile match) — deduplication из первого патча продолжает работать без изменений.

## Rollback

Rollback SQL сохранён в audit, **не выполняется автоматически**. Требует отдельного approval.

```sql
-- ROLLBACK (manual, requires approval):
BEGIN;
  UPDATE public.ticket_messages
     SET ticket_id = '50fe1d8f-fd5a-47e2-b9de-f6414085ee56'
   WHERE ticket_id = 'b83a5c97-1538-4789-a631-467b48145d1f'
     AND created_at BETWEEN '2026-07-02 09:16:53'::timestamptz
                         AND '2026-07-02 09:16:54'::timestamptz;
  -- аналогично для 26179 / 26180 по диапазонам created_at,
  -- либо восстановить по резервной копии, если она снималась перед merge.
  DELETE FROM public.ticket_messages
   WHERE ticket_id = 'b83a5c97-1538-4789-a631-467b48145d1f'
     AND author_type = 'system'
     AND message LIKE 'Системное сообщение: в это обращение объединены%';
  UPDATE public.support_tickets
     SET status = 'open',
         merged_into_ticket_id = NULL,
         merged_at = NULL,
         closed_at = NULL
   WHERE id IN (
     '50fe1d8f-fd5a-47e2-b9de-f6414085ee56',
     '9e51d8d7-0e05-46eb-b961-e4e4a98c283e',
     '799f1ce4-90b8-4d8e-808d-c2df2fa95062'
   );
COMMIT;
```

Точный split перенесённых сообщений по source_id теряется на этом уровне — при необходимости rollback нужно снимать снапшот перед merge отдельным резервированием.

## Далее

После manual regression PASS по этому шагу — старт **PATCH C: CHANNEL-PICKER-SUPPORT-COMPOSER**.
