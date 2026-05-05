# Telegram Cron Sync — Final VERIFY (промежуточный snapshot)

**Дата:** 2026-05-05 12:0X UTC
**Scope:** read-only verify прогресса Gorbova Club к full pass. Никаких write-операций.

## 1. Прогресс Gorbova Club (cursor)

| cron-tick (UTC) | processed | remaining_estimate | is_partial | last_processed_member_id |
|---|---|---|---|---|
| 10:33 (manual) | 200 | 442 | true | `16c36b34-…3655` |
| 11:01 (auto) | 200 | 242 | true | `357dd280-…487a` |
| **12:01 (auto)** | **200** | **42** | **true** | `4c064d2e-…f55c` |
| 13:01 (ожидаем) | 42 | **0** | **false** | — |

Cursor продвигается строго вперёд (442 → 242 → 42). Следующий tick (13:00 UTC) закроет остаток 42 → `is_partial=false`, `remaining_estimate=0`, `last_members_sync_at` обновится.

## 2. `telegram_clubs` (текущий снимок)

| club | last_status_check_at | last_members_sync_at | статус |
|---|---|---|---|
| Бухгалтерия как бизнес | 2026-05-05 12:00:53 | **2026-05-05 12:00:53** ✅ full | Полная синхронизация |
| Gorbova Club | 2026-05-05 12:01:43 | 2026-03-13 21:09 ⏸ | Частичная синхронизация (ожидает финальный tick) |

`last_members_sync_at` для Gorbova остаётся мартовским — корректно, т.к. контракт обновляет его только при полном проходе.

## 3. Безопасность (последние 90 минут)

| revokes | real_kicks | guard_skips | invites | queue_added |
|---|---|---|---|---|
| **0** | **0** | 4 | **0** | **0** |

- BOOT_ERROR — нет;
- массовых revoke/kick — нет (4 «kick» это `telegram.autokick.admin_protected`, guard сработал);
- invite/queue — нет;
- access/subscriptions/entitlements — не трогались.

## 4. UI карточки контакта (после 13:00 UTC tick)

После закрытия Gorbova Club full pass карточка контакта (через RPC `admin_get_club_memberships_all`) автоматически отрендерит:
- Gorbova Club → зелёный бейдж **«Полная синхронизация»**;
- presence (`Не в чате` / `Не в канале`) показывается отдельным бейджем и не смешивается со sync-статусом — это уже соблюдено в `ContactClubMembershipsList.tsx`.

## DoD (финальный — будет дозакрыт после 13:00 UTC)

- [x] Cursor реально продвигается (442 → 242 → 42);
- [x] `last_status_check_at` обновляется каждый tick;
- [x] `last_members_sync_at` НЕ обновляется при partial (контракт);
- [x] Безопасность чистая (0 revoke/kick/invite/queue);
- [x] BOOT_ERROR отсутствует;
- [ ] **Ожидаем 13:00 UTC**: Gorbova `is_partial=false`, `remaining_estimate=0`, `last_members_sync_at` обновлён;
- [ ] **После 13:00 UTC**: UI карточки покажет «Полная синхронизация» для Gorbova Club.

## Follow-up (не в текущем scope)

- Алерты по клубам со stale-синхронизацией;
- Кнопка ручного re-check на одного пользователя;
- Отдельная страница системного статуса всех Telegram-клубов.
