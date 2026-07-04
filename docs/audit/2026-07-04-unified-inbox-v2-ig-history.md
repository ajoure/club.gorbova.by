# PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-IG-HISTORY

Дата: 2026-07-04
Скоуп: только P0. P1–P3 (channel picker, merge, кликабельное имя) — отдельным патчем после PASS.

## Диагноз

В unified inbox правая панель Instagram-диалога показывала «Нет сообщений». Причина — рассинхрон контракта:

- Моно-IG (`InstagramInboxView`) передаёт в `ContactInstagramChat` `threadId={selectedDialog.ig_thread_id}`.
- Edge-функция `instagram-admin-chat` action=`get_history` фильтрует историю через `.eq('ig_thread_id', thread_id)` (см. `supabase/functions/instagram-admin-chat/index.ts:283`).
- Unified (`UnifiedInboxView` → `ChatPanel`) до патча передавал `threadId={row.meta.instagramThreadKey || null}`, куда клался `d.thread_key` из `get_instagram_dialogs_v1` — это другое поле (стабильный ключ строки для preferences/mark_read), не `ig_thread_id`.

Итог: `get_history` фильтровал по неверному значению → пустой ответ → «Нет сообщений».

## Fix

Минимальный, изолированный от channel picker / merge / карточки контакта.

Файлы:

1. `src/hooks/useUnifiedInbox.ts`
   - В `UnifiedDialog.meta` добавлено поле `instagramThreadId?: string | null`.
   - При нормализации IG-диалога: `instagramThreadId: d.ig_thread_id ?? null` (наряду с существующим `instagramThreadKey: d.thread_key`, который остаётся для `mark_read`/сортировки).

2. `src/components/admin/communication/unified/UnifiedInboxView.tsx`
   - В `ChatPanel` для `source === "instagram"` передаём `threadId={row.meta.instagramThreadId ?? null}` (вместо `instagramThreadKey`).

Не тронуто:
- `mark_read` (продолжает идти через `thread_key`).
- Моно-IG (`InstagramInboxView` / `ContactInstagramChat`).
- Feature-flag (`useUnifiedInboxRolloutStatus`) — unified остаётся видимым только superadmin, kill-switch не тронут.
- БД, RPC, edge-функции.

## DoD

- [x] TS-типизация: unified передаёт `ig_thread_id` в `ContactInstagramChat`, поле помечено nullable.
- [ ] Ручная проверка (superadmin): Катерина Коток — IG-история грузится; ещё один IG-контакт — грузится.
- [ ] Ручная проверка: `mark_read` (клик на галочку в строке IG) уменьшает unread.
- [ ] Регрессия моно-IG: `/admin/communication` → dropdown Instagram → диалоги открываются как раньше.
- [ ] Регрессия Telegram unified: строка Telegram-контакта показывает историю (root-cause fix из V2 — без изменений).

## Rollback

Один коммит, две строковые правки. Rollback: revert коммита. Ни схема БД, ни RPC не менялись.

## Скоуп следующего патча

`PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-CHANNELS` — стартует только после PASS этого патча:

1. DB discovery: `instagram_contacts.profile_id` vs новая bridge-таблица.
2. `ChannelPicker` (переключает правую панель между существующими доступными каналами, без создания новых тикетов/IG-разговоров).
3. Merge IG↔profile (только Instagram; Telegram остаётся `profiles.telegram_user_id` read-only).
4. Клик по имени в IG-строке → `ContactDetailSheet` (event.stopPropagation, tooltip «не привязан»).
