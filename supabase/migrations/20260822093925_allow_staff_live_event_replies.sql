-- The room UI exposes replies to every canonical staff role, while the
-- original INSERT path only allowed role code "admin".  Keep the existing
-- admin management policy intact and add the missing, narrowly scoped INSERT
-- permission for staff (has_role_v2('employee') is the canonical umbrella).
--
-- The row must be authored by the current user, target an event the user can
-- access, and reference a comment/question from that same event.
DROP POLICY IF EXISTS "Staff can create live event replies" ON public.live_event_replies;

CREATE POLICY "Staff can create live event replies"
ON public.live_event_replies
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND public.has_role_v2((SELECT auth.uid()), 'employee')
  AND public.user_has_live_event_access((SELECT auth.uid()), live_event_id)
  AND (
    (
      source_comment_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.live_event_comments AS comment
        WHERE comment.id = source_comment_id
          AND comment.live_event_id = live_event_replies.live_event_id
      )
    )
    OR (
      source_question_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.live_event_questions AS question
        WHERE question.id = source_question_id
          AND question.live_event_id = live_event_replies.live_event_id
      )
    )
  )
);
