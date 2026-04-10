
-- 1. Drop old CHECK constraint and add new one with muted/unmuted
ALTER TABLE public.live_event_room_moderation
  DROP CONSTRAINT IF EXISTS live_event_room_moderation_action_type_check;

ALTER TABLE public.live_event_room_moderation
  ADD CONSTRAINT live_event_room_moderation_action_type_check
  CHECK (action_type IN ('removed', 'banned', 'restored', 'muted', 'unmuted'));

-- 2. RPC: is_user_muted_in_room
CREATE OR REPLACE FUNCTION public.is_user_muted_in_room(_user_id uuid, _live_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT action_type = 'muted'
      FROM public.live_event_room_moderation
      WHERE user_id = _user_id
        AND live_event_id = _live_event_id
      ORDER BY created_at DESC
      LIMIT 1
    ),
    false
  );
$$;

-- 3. Update INSERT policies for comments to block muted users
DROP POLICY IF EXISTS "Users can insert own comments" ON public.live_event_comments;
CREATE POLICY "Users can insert own comments"
  ON public.live_event_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND user_has_live_event_access(auth.uid(), live_event_id)
    AND NOT is_user_removed_from_room(auth.uid(), live_event_id)
    AND NOT is_user_muted_in_room(auth.uid(), live_event_id)
  );

-- 4. Update INSERT policies for questions to block muted users
DROP POLICY IF EXISTS "Users can insert own questions" ON public.live_event_questions;
CREATE POLICY "Users can insert own questions"
  ON public.live_event_questions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND user_has_live_event_access(auth.uid(), live_event_id)
    AND NOT is_user_removed_from_room(auth.uid(), live_event_id)
    AND NOT is_user_muted_in_room(auth.uid(), live_event_id)
  );
