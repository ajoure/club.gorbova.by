-- Keep the reply author's public room identity with the reply itself.
-- The client must not query profiles directly: this trigger applies the same
-- per-event display-name and nickname-color contract as comments/questions.
ALTER TABLE public.live_event_replies
  ADD COLUMN IF NOT EXISTS author_display_name text,
  ADD COLUMN IF NOT EXISTS author_role text,
  ADD COLUMN IF NOT EXISTS author_nickname_color text;

COMMENT ON COLUMN public.live_event_replies.author_display_name IS
  'Privacy-aware public room name snapshotted when the reply is created.';
COMMENT ON COLUMN public.live_event_replies.author_role IS
  'Public room role snapshot: admin, employee, or user.';
COMMENT ON COLUMN public.live_event_replies.author_nickname_color IS
  'Optional per-event nickname color snapshot.';

CREATE OR REPLACE FUNCTION public.snapshot_live_event_reply_author()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  _prefs RECORD;
  _profile RECORD;
  _role_code text;
BEGIN
  SELECT r.code
  INTO _role_code
  FROM public.user_roles_v2 ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = NEW.created_by
    AND r.code IN ('super_admin', 'admin', 'admin_gost')
  ORDER BY CASE r.code
    WHEN 'super_admin' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'admin_gost' THEN 3
  END
  LIMIT 1;

  SELECT display_name, nickname_color
  INTO _prefs
  FROM public.live_event_participant_prefs
  WHERE live_event_id = NEW.live_event_id
    AND user_id = NEW.created_by
  LIMIT 1;

  SELECT full_name, first_name, last_name, email
  INTO _profile
  FROM public.profiles
  WHERE user_id = NEW.created_by
  LIMIT 1;

  -- Never trust client-supplied author identity. Derive it from canonical data
  -- and expose only the privacy-aware per-event name or a masked fallback.
  NEW.author_display_name := COALESCE(
    NULLIF(TRIM(_prefs.display_name), ''),
    NULLIF(TRIM(_profile.full_name), ''),
    NULLIF(TRIM(CONCAT_WS(' ', _profile.first_name, _profile.last_name)), ''),
    CASE WHEN NULLIF(TRIM(_profile.email), '') IS NOT NULL
      THEN CONCAT(LEFT(_profile.email, 3), '***')
      ELSE NULL
    END,
    'Пользователь'
  );
  NEW.author_role := CASE
    WHEN _role_code IN ('super_admin', 'admin') THEN 'admin'
    WHEN _role_code = 'admin_gost' THEN 'employee'
    ELSE 'user'
  END;
  NEW.author_nickname_color := NULLIF(TRIM(_prefs.nickname_color), '');

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_snapshot_live_event_reply_author ON public.live_event_replies;
CREATE TRIGGER trg_snapshot_live_event_reply_author
  BEFORE INSERT ON public.live_event_replies
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_live_event_reply_author();

-- Existing replies need the same snapshot so their authors become visible too.
WITH reply_author_snapshots AS (
  SELECT
    reply.id,
    COALESCE(
      NULLIF(TRIM(prefs.display_name), ''),
      NULLIF(TRIM(profile.full_name), ''),
      NULLIF(TRIM(CONCAT_WS(' ', profile.first_name, profile.last_name)), ''),
      CASE WHEN NULLIF(TRIM(profile.email), '') IS NOT NULL
        THEN CONCAT(LEFT(profile.email, 3), '***')
        ELSE NULL
      END,
      'Пользователь'
    ) AS author_display_name,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.user_roles_v2 ur
        JOIN public.roles role ON role.id = ur.role_id
        WHERE ur.user_id = reply.created_by
          AND role.code IN ('super_admin', 'admin')
      ) THEN 'admin'
      WHEN EXISTS (
        SELECT 1
        FROM public.user_roles_v2 ur
        JOIN public.roles role ON role.id = ur.role_id
        WHERE ur.user_id = reply.created_by
          AND role.code = 'admin_gost'
      ) THEN 'employee'
      ELSE 'user'
    END AS author_role,
    NULLIF(TRIM(prefs.nickname_color), '') AS author_nickname_color
  FROM public.live_event_replies reply
  LEFT JOIN public.live_event_participant_prefs prefs
    ON prefs.live_event_id = reply.live_event_id
   AND prefs.user_id = reply.created_by
  LEFT JOIN public.profiles profile
    ON profile.user_id = reply.created_by
)
UPDATE public.live_event_replies reply
SET
  author_display_name = snapshot.author_display_name,
  author_role = snapshot.author_role,
  author_nickname_color = snapshot.author_nickname_color
FROM reply_author_snapshots snapshot
WHERE snapshot.id = reply.id;

ALTER TABLE public.live_event_replies
  ALTER COLUMN author_display_name SET DEFAULT 'Пользователь',
  ALTER COLUMN author_display_name SET NOT NULL,
  ALTER COLUMN author_role SET DEFAULT 'user',
  ALTER COLUMN author_role SET NOT NULL;