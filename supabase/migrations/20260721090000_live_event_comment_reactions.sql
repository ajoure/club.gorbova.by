-- Telegram-style reactions for individual live chat comments.
-- This is intentionally separate from the legacy room-level reaction stream.

CREATE TABLE IF NOT EXISTS public.live_event_comment_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.live_event_comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji = ANY (ARRAY[
    '👍','👎','❤️','🔥','🥰','👏','😁','🤔','🤯','😱','🤬','😢','🎉','🤩','🤮','💩','🙏','👌','🕊','🤡',
    '🥱','🥴','😍','🐳','❤️‍🔥','🌚','🌭','💯','🤣','⚡','🍌','🏆','💔','🤨','😐','🍓','🍾','💋','🖕','😈',
    '😴','😭','🤓','👻','👨‍💻','👀','🎃','🙈','😇','😨','🤝','✍️','🤗','🫡','🎅','🎄','☃️','💅','🤪','🗿',
    '🆒','💘','🙉','🦄','😘','💊','🙊','😎','👾','🤷‍♂️','🤷','🤷‍♀️','😡'
  ])),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_live_comment_reactions_comment_created
  ON public.live_event_comment_reactions (comment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_comment_reactions_user_recent
  ON public.live_event_comment_reactions (user_id, created_at DESC);

ALTER TABLE public.live_event_comment_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_event_comment_reactions REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.can_send_live_comment_reaction(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_room_staff(_user_id)
    OR (
      SELECT count(*) < 10
      FROM public.live_event_comment_reactions r
      WHERE r.user_id = _user_id
        AND r.created_at > now() - interval '5 seconds'
    );
$$;

REVOKE ALL ON FUNCTION public.can_send_live_comment_reaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_send_live_comment_reaction(uuid) TO authenticated;

CREATE POLICY "Users read visible live comment reactions"
  ON public.live_event_comment_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.live_event_comments c
      WHERE c.id = comment_id
        AND public.user_has_live_event_access(auth.uid(), c.live_event_id)
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.live_events e
            WHERE e.id = c.live_event_id AND e.event_type = 'autowebinar'
          )
          OR c.user_id = auth.uid()
          OR public.is_room_staff(auth.uid())
        )
    )
  );

CREATE POLICY "Users add own live comment reactions"
  ON public.live_event_comment_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_send_live_comment_reaction(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.live_event_comments c
      WHERE c.id = comment_id
        AND public.user_has_live_event_access(auth.uid(), c.live_event_id)
        AND NOT public.is_user_removed_from_room(auth.uid(), c.live_event_id)
        AND NOT public.is_user_muted_in_room(auth.uid(), c.live_event_id)
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.live_events e
            WHERE e.id = c.live_event_id AND e.event_type = 'autowebinar'
          )
          OR c.user_id = auth.uid()
          OR public.is_room_staff(auth.uid())
        )
    )
  );

CREATE POLICY "Users remove own live comment reactions"
  ON public.live_event_comment_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- The browser needs only a counter and its own selection state. Returning
-- aggregates keeps other viewers' identifiers out of the chat payload.
CREATE OR REPLACE FUNCTION public.live_event_comment_reaction_summary(_comment_ids uuid[])
RETURNS TABLE (
  comment_id uuid,
  emoji text,
  reaction_count integer,
  user_reacted boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    r.comment_id,
    r.emoji,
    count(*)::integer AS reaction_count,
    bool_or(r.user_id = auth.uid()) AS user_reacted
  FROM public.live_event_comment_reactions r
  WHERE r.comment_id = ANY(_comment_ids)
  GROUP BY r.comment_id, r.emoji
  ORDER BY r.comment_id, reaction_count DESC, r.emoji ASC;
$$;

REVOKE ALL ON FUNCTION public.live_event_comment_reaction_summary(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_event_comment_reaction_summary(uuid[]) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_comment_reactions;
