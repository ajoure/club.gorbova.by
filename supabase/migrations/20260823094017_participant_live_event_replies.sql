-- Replies are part of the webinar conversation, not a staff-only moderation
-- action. Any attendee with access may reply from their own account unless
-- they are muted/removed. Public replies are visible to all attendees of the
-- event; private replies are visible to their author, target and all staff.

DROP POLICY IF EXISTS "Staff can create live event replies" ON public.live_event_replies;
DROP POLICY IF EXISTS "Participants can create live event replies" ON public.live_event_replies;
DROP POLICY IF EXISTS "Users can read visible replies" ON public.live_event_replies;

-- Reply cards must arrive for every connected attendee without refreshing.
-- The guard keeps the migration safe if a managed environment already added
-- the table to the publication independently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'live_event_replies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_replies;
  END IF;
END
$$;

ALTER TABLE public.live_event_replies REPLICA IDENTITY FULL;

CREATE POLICY "Participants can create live event replies"
ON public.live_event_replies
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND public.user_has_live_event_access((SELECT auth.uid()), live_event_id)
  AND NOT public.is_user_removed_from_room((SELECT auth.uid()), live_event_id)
  AND NOT public.is_user_muted_in_room((SELECT auth.uid()), live_event_id)
  AND (
    (
      source_comment_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.live_event_comments AS comment
        WHERE comment.id = source_comment_id
          AND comment.live_event_id = live_event_replies.live_event_id
          AND (
            (
              live_event_replies.visibility_scope = 'public'
              AND live_event_replies.target_user_id IS NULL
            )
            OR (
              live_event_replies.visibility_scope = 'private'
              AND live_event_replies.target_user_id = comment.user_id
            )
          )
      )
    )
    OR (
      source_question_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.live_event_questions AS question
        WHERE question.id = source_question_id
          AND question.live_event_id = live_event_replies.live_event_id
          AND (
            (
              live_event_replies.visibility_scope = 'public'
              AND live_event_replies.target_user_id IS NULL
            )
            OR (
              live_event_replies.visibility_scope = 'private'
              AND live_event_replies.target_user_id = question.user_id
            )
          )
      )
    )
  )
);

CREATE POLICY "Users can read visible replies"
ON public.live_event_replies
FOR SELECT
TO authenticated
USING (
  public.has_role_v2((SELECT auth.uid()), 'employee')
  OR (
    public.user_has_live_event_access((SELECT auth.uid()), live_event_id)
    AND (
      visibility_scope = 'public'
      OR target_user_id = (SELECT auth.uid())
      OR created_by = (SELECT auth.uid())
    )
  )
);
