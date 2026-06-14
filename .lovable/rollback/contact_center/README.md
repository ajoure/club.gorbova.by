# Rollback — PATCH-CONTACT-CENTER-FIX-V1 corrective

Эти SQL-файлы **намеренно вынесены из `supabase/migrations/`**, чтобы не
применяться автоматически. Они исполняются вручную через `supabase--migration`
только при необходимости отката.

## Состав

- `restore_get_inbox_dialogs_v1.sql` — восстанавливает прежнее тело
  `public.get_inbox_dialogs_v1` (CTE `dialog_stats` + `DISTINCT ON
  last_messages`) ровно из миграции `20260222213936`.
- `drop_v2_rpcs.sql` — снимает V2-функции `mark_dialog_read_v2` и
  `bulk_mark_dialogs_read_v2` после того, как фронт перестал их вызывать.

## Порядок отката (обязательный)

1. **Frontend compatibility**: вернуть фронт к вызовам
   `mark_dialog_read_atomic` / `bulk_mark_dialogs_read_atomic` (старые функции
   НЕ были удалены — они продолжают существовать в БД как compatibility
   layer). После деплоя дождаться окна, в котором новые V2 RPC больше не
   вызываются (PostgREST/Edge logs).
2. **Restore RPC**: применить `restore_get_inbox_dialogs_v1.sql`.
3. **Smoke**: пройти ручной чек контакт-центра (список диалогов
   загружается, отметка прочитанным работает).
4. **Cleanup**: применить `drop_v2_rpcs.sql`.
5. Compatibility-функции V1 можно удалить только отдельным cleanup-патчем
   после подтверждённого отсутствия их вызовов.

## Что НЕ делается в откате

- Не трогаются индексы `idx_telegram_messages_*` (нейтральны к контракту).
- Не трогаются права/RLS чужих таблиц.
- Никаких изменений в исключённых доменах
  (access_rules, entitlements, subscriptions_v2, orders_v2, billing webhooks,
  broadcasts, Stripe/bePaid, storage, telegram lifecycle).
