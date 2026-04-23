-- Safe-cast guard для presenter
CREATE OR REPLACE FUNCTION public.is_live_event_presenter(_user_id uuid, _live_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.live_events le
    WHERE le.id = _live_event_id
      AND le.metadata ? 'presenter_user_id'
      AND NULLIF(le.metadata->>'presenter_user_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (le.metadata->>'presenter_user_id')::uuid = _user_id
  );
$function$;

-- Пересоздать SELECT-policy без мёртвой роли 'employee'
DROP POLICY IF EXISTS "Staff read all, users read own" ON public.live_event_questions;
CREATE POLICY "Staff read all, users read own"
  ON public.live_event_questions
  FOR SELECT
  TO authenticated
  USING (
    user_has_live_event_access(auth.uid(), live_event_id)
    AND (
      auth.uid() = user_id
      OR has_role_v2(auth.uid(), 'admin')
      OR has_role_v2(auth.uid(), 'super_admin')
      OR is_live_event_presenter(auth.uid(), live_event_id)
    )
  );

-- Пересоздать UPDATE-policy без мёртвой роли 'employee'
DROP POLICY IF EXISTS "Staff can update questions" ON public.live_event_questions;
CREATE POLICY "Staff can update questions"
  ON public.live_event_questions
  FOR UPDATE
  TO authenticated
  USING (
    has_role_v2(auth.uid(), 'admin')
    OR has_role_v2(auth.uid(), 'super_admin')
    OR is_live_event_presenter(auth.uid(), live_event_id)
  );