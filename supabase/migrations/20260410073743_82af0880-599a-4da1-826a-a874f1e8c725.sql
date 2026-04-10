-- Add author_role column to live_event_comments and live_event_questions
ALTER TABLE public.live_event_comments
  ADD COLUMN IF NOT EXISTS author_role text DEFAULT 'user';

ALTER TABLE public.live_event_questions
  ADD COLUMN IF NOT EXISTS author_role text DEFAULT 'user';

-- Update the snapshot trigger to also capture author's role
CREATE OR REPLACE FUNCTION public.snapshot_author_display_name()
RETURNS TRIGGER AS $$
DECLARE
  _profile RECORD;
  _role_code text;
BEGIN
  IF NEW.author_display_name IS NULL THEN
    SELECT full_name, first_name, last_name, avatar_url, email
    INTO _profile
    FROM public.profiles
    WHERE user_id = NEW.user_id;

    NEW.author_display_name := COALESCE(
      NULLIF(TRIM(_profile.full_name), ''),
      NULLIF(TRIM(CONCAT_WS(' ', _profile.first_name, _profile.last_name)), ''),
      CASE WHEN _profile.email IS NOT NULL AND _profile.email != ''
        THEN CONCAT(LEFT(_profile.email, 3), '***')
        ELSE NULL
      END,
      'Пользователь'
    );

    IF NEW.author_avatar_url IS NULL AND _profile.avatar_url IS NOT NULL THEN
      NEW.author_avatar_url := _profile.avatar_url;
    END IF;
  END IF;

  -- Snapshot author role: admin > super_admin > admin_gost > user
  IF NEW.author_role IS NULL OR NEW.author_role = 'user' THEN
    SELECT r.code INTO _role_code
    FROM public.user_roles_v2 ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = NEW.user_id
      AND r.code IN ('super_admin', 'admin', 'admin_gost')
    ORDER BY CASE r.code
      WHEN 'super_admin' THEN 1
      WHEN 'admin' THEN 2
      WHEN 'admin_gost' THEN 3
    END
    LIMIT 1;

    IF _role_code IS NOT NULL THEN
      NEW.author_role := CASE
        WHEN _role_code IN ('super_admin', 'admin') THEN 'admin'
        WHEN _role_code = 'admin_gost' THEN 'employee'
        ELSE 'user'
      END;
    ELSE
      NEW.author_role := 'user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;