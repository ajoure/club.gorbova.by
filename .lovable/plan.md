# План: обновление физической инвентаризации участников двух клубов (без access-действий)

## Diagnose — проверка задеплоенного контракта `telegram-club-members`

Проверен исходник ветки, соответствующий задеплоенной функции (`supabase/functions/telegram-club-members/index.ts`, 1193 строки). Ветка `action === 'check_status'` (строки 329–481):

| Требование | Факт | Вердикт |
| --- | --- | --- |
| Только `getChatMember` для существующих записей | Список берётся из `telegram_club_members` по `club_id`; на каждого — `checkMembership` → `getChatMember` по `chat_id` и (если задан) `channel_id` | PASS |
| Только обновление статуса/меток проверки + аудит | `update` полей `in_chat`, `in_channel`, `last_telegram_check_at`, `last_telegram_check_result`, `updated_at`; `telegram_clubs.last_status_check_at`; записи в `telegram_club_audit` (`STATUS_CHECK`) и `audit_logs` (`telegram.status_check_completed`) | PASS с оговоркой (см. ниже) |
| Никаких grant/revoke/send/kick/ban/unban | В ветке нет вызовов `kickMember`, `banChatMember`, `unbanChatMember`, `sendMessage`, нет создания инвайтов и записей доступа | PASS |
| Требуется текущая админ-авторизация | Без `Authorization` — 401; иначе проверка `is_super_admin` / permission / роль `admin`\|`superadmin`; альтернатива — service-ключ | PASS |
| Полный детерминированный список | Без `member_ids` — постраничная выборка по 200 с `order('id')` до исчерпания | PASS |
| Отчёт `checked_count == total_expected` | Возвращаются оба поля + STOP-GUARD лог при расхождении | PASS (сравнение делаем на нашей стороне) |

Оговорка (единственная запись, меняющая смысловое поле): ADMIN GUARD — если Telegram отвечает `administrator`/`creator`, а запись имеет `access_status = 'removed'`, поле переводится в `'ok'` (строки 392–405). Это не выдача доступа в Telegram, а исправление проекции для админов/владельцев; в отчёте оно считается как `restored_from_removed`.

## Текущее состояние (read-only)

| Клуб | club_id | chat | channel | channel_grant_enabled | записей в инвентаре | последняя проверка |
| --- | --- | --- | --- | --- | --- | --- |
| Gorbova Club | fa547c41-3a84-4c4f-904a-427332a0506e | есть | есть | true | 650 | 2026-08-08 10:00:55Z |
| Бухгалтерия как бизнес | 4f8f9d8f-07ce-4898-8012-39f1035c1456 | есть | есть | false | 642 | 2026-08-08 10:01:39Z |

Важно: инвентарь уже был полностью пересчитан сегодня в 10:00–10:02 UTC, то есть данные не устарели. Повторный прогон допустим, но фактически он подтверждающий, а не восстановительный.

## EXECUTE-план (максимум 2 вызова, только после отдельного одобрения)

1. Вызов 1 — Gorbova Club: `telegram-club-members`, тело `{ "action": "check_status", "club_id": "fa547c41-3a84-4c4f-904a-427332a0506e" }`, без `member_ids`, с админской авторизацией.
   - Ожидание: `success: true`, `full_scan: true`, `checked_count == total_expected == 650` (±расхождение только если инвентарь изменился между чтением и вызовом — тогда сверяем с фактическим `count(*)`).
2. Пауза, сверка ответа. STOP при `checked_count != total_expected`, ошибке авторизации, отличии задеплоенного кода или любом признаке kick/ban/send в ответе или логах.
3. Вызов 2 — «Бухгалтерия как бизнес»: то же тело с `club_id = 4f8f9d8f-07ce-4898-8012-39f1035c1456`, ожидание `checked_count == total_expected == 642`.
4. Никаких других действий: `sync`, `kick`, `kick_present`, `mark_removed`, `telegram-cron-sync` (автокик) — запрещены.
5. После обоих вызовов — повторный read-only mismatch-аудит по свежим физическим статусам и текущим оплаченным периодам: списки «есть право, нет присутствия», «присутствует без права», служебные аккаунты, дефекты проекции, счётчики по GC (чат+канал) и BB (только чат). Cleanup не выполняется.

## Ограничения и риски

- Объём: примерно 2600 вызовов `getChatMember` (по 2 на запись), время выполнения — минуты; возможен rate limit Telegram. При таймауте прогон не считается успешным, `checked_count` сравнивается по факту.
- Побочные записи ограничены полями проверки, `last_status_check_at` и аудит-логами, плюс ADMIN GUARD-исправление `access_status` для админов.
- Publish, миграции, деплой и сообщения пользователям не выполняются ни на одном шаге.
