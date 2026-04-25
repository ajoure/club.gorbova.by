-- System variant of resolve_broadcast_audience_user_ids:
-- skips auth.uid()/has_permission check, EXECUTE granted only to service_role.
-- Used by broadcast edge functions when invoked via system-actor bypass
-- (process-scheduled-broadcasts dispatcher with x-broadcast-internal-secret).

CREATE OR REPLACE FUNCTION public.resolve_broadcast_audience_user_ids_system(_filters jsonb)
RETURNS TABLE(user_id uuid, has_telegram boolean, has_email boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _include jsonb := COALESCE(_filters->'include', '[]'::jsonb);
  _exclude jsonb := COALESCE(_filters->'exclude', '[]'::jsonb);
  _club_ids uuid[] := CASE
    WHEN jsonb_typeof(_filters->'club_ids') = 'array'
      THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'club_ids'))::uuid)
    ELSE ARRAY[]::uuid[]
  END;
  _club_membership text := COALESCE(_filters->>'club_membership', 'current');
  _channels text[] := CASE
    WHEN jsonb_typeof(_filters->'channels') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'channels'))
    ELSE ARRAY['telegram','email']
  END;
BEGIN
  -- NOTE: no has_permission() check here. This function is only callable
  -- by service_role (see GRANT below) and is invoked exclusively from the
  -- scheduled-broadcast dispatcher path, which authenticates via the
  -- x-broadcast-internal-secret header at the edge layer.

  RETURN QUERY
  SELECT t.user_id, t.has_telegram, t.has_email
  FROM public.resolve_broadcast_audience_user_ids(
    jsonb_set(
      COALESCE(_filters, '{}'::jsonb),
      '{__system_bypass}',
      'true'::jsonb,
      true
    )
  ) t;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_broadcast_audience_user_ids_system(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_broadcast_audience_user_ids_system(jsonb) TO service_role;

-- We need the underlying function to actually skip the check when called from
-- the system wrapper. Patch it to honour the __system_bypass marker only when
-- auth.uid() is NULL (i.e. service_role context) — never via user JWT.

CREATE OR REPLACE FUNCTION public.resolve_broadcast_audience_user_ids(_filters jsonb)
RETURNS TABLE(user_id uuid, has_telegram boolean, has_email boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _include jsonb := COALESCE(_filters->'include', '[]'::jsonb);
  _exclude jsonb := COALESCE(_filters->'exclude', '[]'::jsonb);
  _club_ids uuid[] := CASE
    WHEN jsonb_typeof(_filters->'club_ids') = 'array'
      THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'club_ids'))::uuid)
    ELSE ARRAY[]::uuid[]
  END;
  _club_membership text := COALESCE(_filters->>'club_membership', 'current');
  _channels text[] := CASE
    WHEN jsonb_typeof(_filters->'channels') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'channels'))
    ELSE ARRAY['telegram','email']
  END;
  _system_bypass boolean := COALESCE((_filters->>'__system_bypass')::boolean, false);
BEGIN
  -- system bypass is only honoured when caller has no auth user
  -- (i.e. service_role context). Any user JWT must still pass permission check.
  IF NOT (_system_bypass AND auth.uid() IS NULL) THEN
    IF NOT public.has_permission(auth.uid(), 'entitlements.manage') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      p.user_id,
      (p.telegram_user_id IS NOT NULL) AS has_tg,
      (p.email IS NOT NULL AND length(p.email) > 0) AS has_em
    FROM profiles p
    WHERE
      ('telegram' = ANY(_channels) AND p.telegram_user_id IS NOT NULL)
      OR ('email' = ANY(_channels) AND p.email IS NOT NULL AND length(p.email) > 0)
  ),
  included AS (
    SELECT b.user_id, b.has_tg, b.has_em
    FROM base b
    WHERE
      jsonb_array_length(_include) = 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(_include) AS inc(uid)
        WHERE inc.uid::uuid = b.user_id
      )
  ),
  excluded AS (
    SELECT i.user_id, i.has_tg, i.has_em
    FROM included i
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(_exclude) AS exc(uid)
      WHERE exc.uid::uuid = i.user_id
    )
  ),
  club_filtered AS (
    SELECT e.user_id, e.has_tg, e.has_em
    FROM excluded e
    WHERE
      array_length(_club_ids, 1) IS NULL
      OR (
        _club_membership = 'current' AND EXISTS (
          SELECT 1 FROM telegram_club_members tcm
          WHERE tcm.user_id = e.user_id
            AND tcm.club_id = ANY(_club_ids)
            AND tcm.status = 'active'
        )
      )
      OR (
        _club_membership = 'former' AND EXISTS (
          SELECT 1 FROM telegram_club_members tcm
          WHERE tcm.user_id = e.user_id
            AND tcm.club_id = ANY(_club_ids)
            AND tcm.status <> 'active'
        )
      )
      OR (
        _club_membership = 'any' AND EXISTS (
          SELECT 1 FROM telegram_club_members tcm
          WHERE tcm.user_id = e.user_id
            AND tcm.club_id = ANY(_club_ids)
        )
      )
  )
  SELECT cf.user_id, cf.has_tg, cf.has_em
  FROM club_filtered cf;
END;
$$;
