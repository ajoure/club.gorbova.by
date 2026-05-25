DROP FUNCTION IF EXISTS public.get_ai_access();
DROP FUNCTION IF EXISTS public.get_chat_scenarios();

CREATE OR REPLACE FUNCTION public.get_chat_scenarios()
RETURNS TABLE(
  id uuid,
  launcher_title text,
  launcher_description text,
  type prompt_type,
  input_hint text,
  icon text,
  launcher_order integer,
  code text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id, launcher_title, launcher_description, type, input_hint, icon, launcher_order, code
  FROM ai_user_prompts
  WHERE is_active = true AND is_archived = false AND is_visible_in_chat = true
    AND launcher_title IS NOT NULL AND trim(launcher_title) <> ''
  ORDER BY launcher_order NULLS LAST, created_at;
$function$;

REVOKE ALL ON FUNCTION public.get_chat_scenarios() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_scenarios() TO authenticated;