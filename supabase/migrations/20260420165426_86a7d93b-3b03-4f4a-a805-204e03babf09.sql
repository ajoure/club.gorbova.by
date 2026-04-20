-- Закрываем server-side bypass mute-блокировки.
-- Дублирующая weak-policy без mute-check позволяла обойти заглушение через OR-логику permissive policy.
-- Оставляем только канонические policy с проверкой is_user_muted_in_room И is_user_removed_from_room.

DROP POLICY IF EXISTS "Users with access can insert own comments" ON public.live_event_comments;
DROP POLICY IF EXISTS "Users with access can insert own questions" ON public.live_event_questions;