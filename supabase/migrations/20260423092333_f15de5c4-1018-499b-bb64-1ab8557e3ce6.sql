CREATE OR REPLACE FUNCTION public.can_send_reaction(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT true;
$function$;