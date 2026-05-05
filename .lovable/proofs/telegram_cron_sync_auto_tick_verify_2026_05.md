# Telegram Cron Sync — Auto-tick VERIFY (P2 + P3)

**Дата:** 2026-05-05  
**Scope:** read-only verify первого автоматического срабатывания cron `telegram-club-sync-hourly` после P1+P2+P3. Никаких write-операций, UI/queue/invite/access не трогались.

## 1. `audit_logs` — `telegram.cron_sync.batch`

Запросы:
```sql
SELECT created_at, actor_label, meta->>... 
FROM audit_logs WHERE action='telegram.cron_sync.batch'
ORDER BY created_at DESC LIMIT 20;
```

| created_at (UTC) | actor_label | club | processed | updated | kicked | guard_skips | errors | duration_ms | batch_limit | is_partial | remaining_estimate | last_processed_member_id | eligible_total | source |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **2026-05-05 11:01:44** | `telegram-cron-sync` | Gorbova Club | 200 | 200 | 0 | 2 | 0 | 51 370 | 200 | **true** | **242** | `357dd280-…487a` | 442 | **AUTO cron** ✅ |
| **2026-05-05 11:00:52** | `telegram-cron-sync` | Бухгалтерия как бизнес | 200 | 200 | 0 | 1 | 0 | 46 185 | 200 | **false** | 0 | `f15ab232-…7dd5` | 0 | **AUTO cron** ✅ |
| 2026-05-05 10:33:25 | `telegram-cron-sync` | Gorbova Club | 200 | 200 | 0 | 1 | 0 | 58 425 | 200 | true | 442 | `16c36b34-…3655` | 642 | manual (P2+P3 verify) |
| 2026-05-05 10:32:26 | `telegram-cron-sync` | Бухгалтерия как бизнес | 200 | 200 | 0 | 1 | 0 | 49 585 | 200 | false | 0 | `aca3f21d-…a5c0` | 72 | manual (P2+P3 verify) |

**Все требуемые поля присутствуют:** `processed, updated, kicked, guard_skips, errors, duration_ms, batch_limit, is_partial, remaining_estimate, last_processed_member_id, eligible_total`. `actor_label = telegram-cron-sync` для всех записей.

## 2. `telegram_clubs`

```sql
SELECT club_name, last_status_check_at, last_members_sync_at
FROM telegram_clubs WHERE is_active=true;
```

| club | last_status_check_at | last_members_sync_at | поведение |
|---|---|---|---|
| Бухгалтерия как бизнес | **2026-05-05 11:00:52** ✅ | **2026-05-05 11:00:52** ✅ | full pass → оба обновлены |
| Gorbova Club | **2026-05-05 11:01:44** ✅ | 2026-03-13 21:09 ⏸ | partial pass → `last_members_sync_at` НЕ тронут (корректно) |

Контракт `last_members_sync_at` обновляется только при `is_partial=false` — соблюдён.

## 3. Безопасность изменений (last 90 минут)

```sql
SELECT
  COUNT(*) FILTER (WHERE action ILIKE '%revoke%') as revokes,
  COUNT(*) FILTER (WHERE action ILIKE '%kick%')   as kicks,
  COUNT(*) FILTER (WHERE action ILIKE '%invite%') as invites,
  (SELECT COUNT(*) FROM telegram_access_queue WHERE created_at > now() - interval '90 minutes') as queue_added
FROM audit_logs WHERE action ILIKE 'telegram%' AND created_at > now() - interval '90 minutes';
```

| revokes | kicks | invites | queue_added |
|---|---|---|---|
| **0** | 5 | **0** | **0** |

Все 5 «kick»-записей — это `telegram.autokick.admin_protected`, то есть **guard сработал и отказался кикать админов/creator**. Реальных kick — **0**.

- ❌ массовых ошибочных revoke/kick — **нет**;
- ❌ изменений invite/queue — **нет**;
- ❌ изменений access/subscriptions/entitlements — не было (cron их не трогает по контракту);
- ❌ BOOT_ERROR — отсутствует (последняя запись в edge-логах — успешный boot и `Starting Telegram cron sync...` обоих клубов).

## 4. Gorbova Club — продвижение cursor

Сравнение двух последовательных запусков по этому клубу:

| run | last_processed_member_id | eligible_total (head-only) | remaining_estimate |
|---|---|---|---|
| 10:33 (manual) | `16c36b34-2457-…b8adbdf83655` | 642 | 442 |
| 11:01 (auto)   | `357dd280-87b2-…45369476487a` | 442 | **242** |

- `last_processed_member_id` **изменился** → cursor продвинулся, обработаны следующие 200, не одни и те же.
- `eligible_total` уменьшилось на ровно 200 (642 → 442), `remaining_estimate` 442 → 242.
- Ещё ~2 cron-тика (12:00, 13:00 UTC) и Gorbova полностью догонится → следующим тиком `is_partial` станет `false` и `last_members_sync_at` обновится.

## DoD

1. ✅ Автоматический cron-tick зафиксирован (11:00 UTC, оба клуба).
2. ✅ Все требуемые поля в `audit_logs.meta` присутствуют.
3. ✅ `last_status_check_at` обновился у обоих клубов; `last_members_sync_at` — только у full pass.
4. ✅ BOOT_ERROR нет; revoke/kick/invite/queue/access не менялись.
5. ✅ Cursor по Gorbova Club реально продвигается (новый `last_processed_member_id`, `remaining_estimate` 442 → 242).

## Дальше

Можно переходить к **P4 UI**: статус синхронизации по всем активным клубам в карточке контакта (с использованием `last_telegram_check_at` / `last_verified_at` per-club + `telegram_clubs.last_members_sync_at` / `last_status_check_at`).
