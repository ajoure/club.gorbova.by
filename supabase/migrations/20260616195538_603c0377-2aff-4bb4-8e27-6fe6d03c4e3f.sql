
-- 1) Tighten SELECT on live_event_room_blocks
DROP POLICY IF EXISTS "Authenticated users can read active blocks" ON public.live_event_room_blocks;
DROP POLICY IF EXISTS "Users can view active blocks" ON public.live_event_room_blocks;

CREATE POLICY "Users can view active blocks for accessible events"
ON public.live_event_room_blocks
FOR SELECT
TO authenticated
USING (
  is_active = true
  AND public.user_has_live_event_access(auth.uid(), live_event_id)
);

-- 2) Real rate limit for reactions: max 10 per 5 seconds per (user, event)
CREATE OR REPLACE FUNCTION public.can_send_reaction(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.has_role_v2(_user_id, 'admin')
    OR public.is_room_staff(_user_id)
    OR (
      SELECT count(*) < 10
      FROM public.live_event_reactions r
      WHERE r.user_id = _user_id
        AND r.live_event_id = _event_id
        AND r.created_at > (now() - interval '5 seconds')
    );
$function$;

-- 3) Revoke EXECUTE from anon/PUBLIC on public SECURITY DEFINER functions
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon;',
                   r.nspname, r.proname, r.args);
  END LOOP;
END
$$;
