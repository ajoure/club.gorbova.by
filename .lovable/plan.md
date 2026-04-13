# Отчет о выполнении: Unified Telegram Access System

## Дата: 2026-04-13

## Что было сделано

### PATCH A: Унификация всех backend call-sites (11 файлов)

Все broken call-sites исправлены на единый контракт `{ user_id, club_id, source_id, source }` (snake_case):

| # | Файл | Было | Стало | Verdict |
|---|------|------|-------|---------|
| 1 | `grant-access-for-order:938` | camelCase `userId, clubId, orderId` | `user_id, club_id, source_id, source` | ✅ Fixed |
| 2 | `bepaid-webhook:4417` | нет club_id | + `club_id, source_id, source` | ✅ Fixed |
| 3 | `bepaid-webhook:5496` | нет club_id, fallback без контекста | Заблокирован (skip + warning log) | ✅ Disabled |
| 4 | `direct-charge:615` | нет club_id | + `club_id, source_id, source` | ✅ Fixed |
| 5 | `direct-charge:1080` | нет club_id | + `club_id, source_id, source` | ✅ Fixed |
| 6 | `telegram-webhook:618` | нет club_id | + `club_id` из product | ✅ Fixed |
| 7 | `telegram-webhook:682` | нет club_id | + club_id через join products_v2 | ✅ Fixed |
| 8 | `telegram-webhook:701` | legacy subscriptions, нет club_id | Заблокирован (legacy skip) | ✅ Disabled |
| 9 | `subscription-admin-actions:828` | нет club_id | + `club_id, source_id, source` | ✅ Fixed |
| 10 | `subscription-admin-actions:942` | нет club_id | + `club_id, source_id, source` | ✅ Fixed |
| 11 | `payments-reconcile:708` | camelCase, нет club_id | Заблокирован (legacy path) | ✅ Disabled |

### PATCH B: Запрет прямых UI write-path

- `EditSubscriptionDialog.tsx:createTelegramAccess()` (строки 332-355) — **удалён**
- Кнопка "Привязать" теперь вызывает `grantTelegramAccess()` (backend path)
- Прямых insert/update в `telegram_access` из UI больше нет

### PATCH D: Cohort repair

**Before:** 13 пользователей с `revoked` + active subscription

**Repair result:** 12/13 успешно восстановлены через `telegram-grant-access`:
- Все 12 получили invite-ссылки (dm_sent=true)
- 1 пользователь (Мария Гришенкова) — Telegram не привязан, repair невозможен до привязки

**After:** 0 пользователей с `revoked` + active sub + linked Telegram

### Forensic: Светлана Василевская
- **Before:** state_chat=pending, state_channel=pending, active_until=2026-05-13
- **Verdict:** valid-pending — backend grant от 13.04 07:50 реально вызван, invite создан (chat_invite_sent=true, channel_invite_sent=true), ожидание вступления
- **Не требует repair** — штатное ожидание

## Changed files

1. `supabase/functions/grant-access-for-order/index.ts` — snake_case fix
2. `supabase/functions/bepaid-webhook/index.ts` — club_id fix (2 места) + fallback disabled
3. `supabase/functions/direct-charge/index.ts` — club_id fix (2 места)
4. `supabase/functions/telegram-webhook/index.ts` — club_id fix (2 места) + legacy disabled
5. `supabase/functions/subscription-admin-actions/index.ts` — club_id fix (2 места)
6. `supabase/functions/payments-reconcile/index.ts` — legacy path disabled
7. `src/components/admin/EditSubscriptionDialog.tsx` — createTelegramAccess() удалён

## Техдолг (PATCH E — backlog)

- `telegram-grant-access` state-machine: pending ставится до invite, нет rollback при ошибке шагов 3-5
- Нет различия в UI между "TG not linked pending" и "invite sent pending"
- 155 pending пользователей требуют drill-down классификации (valid/false/stuck)
