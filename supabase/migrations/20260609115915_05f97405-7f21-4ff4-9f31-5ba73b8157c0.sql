
CREATE OR REPLACE FUNCTION public.normalize_order_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  resolved_auth_id uuid;
  resolved_profile_id uuid;
  original_input uuid;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  original_input := NEW.user_id;

  -- Priority 1: lookup by profiles.user_id = NEW.user_id (real auth user)
  SELECT p.id INTO resolved_profile_id
  FROM profiles p
  WHERE p.user_id = NEW.user_id
  LIMIT 1;

  IF FOUND THEN
    NEW.profile_id := resolved_profile_id;
    RETURN NEW;
  END IF;

  -- Priority 2: legacy fallback — caller passed profile.id instead of auth user_id
  SELECT p.user_id, p.id INTO resolved_auth_id, resolved_profile_id
  FROM profiles p
  WHERE p.id = NEW.user_id
  LIMIT 1;

  IF FOUND THEN
    IF resolved_auth_id IS NOT NULL THEN
      NEW.profile_id := resolved_profile_id;
      NEW.user_id := resolved_auth_id;
      NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
        '_user_id_normalized', true,
        '_original_input', original_input::text,
        '_normalized_at', now()::text
      );
    ELSE
      -- Priority 3: ghost profile (id without auth user_id)
      NEW.profile_id := resolved_profile_id;
      NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
        '_is_ghost_profile', true,
        '_ghost_reason', 'profile_id_without_user_id',
        '_profile_id', resolved_profile_id::text
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
