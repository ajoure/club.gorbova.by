DROP POLICY IF EXISTS "Users insert own prefs" ON public.live_event_participant_prefs;

CREATE POLICY "Users insert own prefs"
  ON public.live_event_participant_prefs
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      public.has_role_v2(auth.uid(), 'admin')
      OR public.has_role_v2(auth.uid(), 'employee')
      OR public.user_has_live_event_access(auth.uid(), live_event_id)
    )
  );