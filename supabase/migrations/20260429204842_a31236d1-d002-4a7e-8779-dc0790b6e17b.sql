-- Restore FK telegram_messages.sent_by_admin -> profiles.user_id
-- This allows PostgREST to resolve the admin_profile join in telegram-admin-chat get_messages,
-- so the contact-center inbox shows the actual sender name (not "Администратор" fallback).

ALTER TABLE public.telegram_messages
  ADD CONSTRAINT telegram_messages_sent_by_admin_fkey
  FOREIGN KEY (sent_by_admin) REFERENCES public.profiles(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS telegram_messages_sent_by_admin_idx
  ON public.telegram_messages(sent_by_admin);

NOTIFY pgrst, 'reload schema';