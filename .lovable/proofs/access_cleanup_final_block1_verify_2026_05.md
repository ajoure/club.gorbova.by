# ACCESS-CLEANUP-FINAL Block 1 — verify proof

**Verified at:** 2026-05-20
**Scope:** 3 revoke queue rows from `PATCH-TG-REVOKE-2` (Gorbova Club `fa547c41-3a84-4c4f-904a-427332a0506e`).

## 1. Queue execution

```sql
SELECT id, status, attempts, last_error, processed_at
FROM telegram_access_queue
WHERE meta->>'patch'='PATCH-TG-REVOKE-2';
```

| queue id | user | status | attempts | processed_at |
|---|---|---|---|---|
| `57a8f1f6` | Юлия Станкевич | completed | 1 | 2026-05-18 20:19:02.680+00 |
| `8ae82d41` | **Наталья Морозевич (F3)** | completed | 1 | 2026-05-18 20:19:03.182+00 |
| `b62888e6` | Ирина Протасевич | completed | 1 | 2026-05-18 20:19:03.461+00 |

3/3 completed. 0 errors. ~13 секунд от INSERT до processed.

## 2. Telegram physical state (`telegram_club_members` + last bot check)

| profile | telegram_user_id | in_chat | in_channel | access_status | last_telegram_check (`getChatMember`) |
|---|---|---|---|---|---|
| Юлия Станкевич | 636254679 | false | false | removed | 2026-05-20 12:01:46 — `kicked` |
| **Наталья Морозевич** | 6684263234 (`@marazevichnatallia`) | false | false | removed | 2026-05-20 10:01:08 — `kicked` |
| Ирина Протасевич | 597262024 (`@rinaprot`) | false | false | removed | 2026-05-20 09:01:31 — `kicked` |

F3 Морозевич — фактически удалена из Gorbova Club. ✅

## 3. Запреты — соблюдены

- 0 затронутых admin/founder/staff
- 0 затронутых 6 paid-BUSINESS repair-кейсов (Белозор, Юролайть, Краковская, Пилецкая, Босак, Леоненко — в queue не попадали)
- 0 ручных вызовов Telegram API
- 0 DML вне штатной обработки queue

## 4. DoD

| | |
|---|:---:|
| 3 queue rows = completed | ✅ |
| 3 пользователя physically removed (bot-verified) | ✅ |
| F3 Морозевич удалена | ✅ |
| paid-BUSINESS не затронуты | ✅ |

**ACCESS-CLEANUP-FINAL Block 1 — CLOSED.**

## 5. Next tail

- **PATCH-DATA-REPAIR-MISSING-ENT** — Юролайть execute через `grant-access-for-order` + отдельный source-chain repair для 5 REBILL/do_not_grant кейсов.
- **PATCH-UI-RESOLVER-F1-F2** — Каплия / Гудвилович, SQL-ok но UI/resolver visibility.
- Backlog: zombie past_due Белько `794661f3`, `1d9700de`; `gc_sync_failed`; INV-22 cleanup.
