
-- =========================================================
-- PATCH-CONTACT-CENTER-FIX-V1 — корректирующий проход S2 (V2 контракт)
-- Создаёт mark_dialog_read_v2 / bulk_mark_dialogs_read_v2 с обязательной
-- observed boundary и структурированным результатом.
-- СТАРЫЕ функции mark_dialog_read_atomic / bulk_mark_dialogs_read_atomic
-- НЕ удаляются (compatibility layer для отката фронта).
-- =========================================================

CREATE OR REPLACE FUNCTION public.mark_dialog_read_v2(
  p_user_id  uuid,
  p_boundary timestamptz
)
RETURNS TABLE(
  dialog_user_id         uuid,
  boundary               timestamptz,
  marked_count           integer,
  remaining_unread_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_marked   integer := 0;
  v_remain   integer := 0;
  v_max_skew interval := interval '60 seconds';
BEGIN
  -- AuthN/AuthZ
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_caller, 'admin'::app_role)
       OR public.has_role(v_caller, 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Strict validation: никакого fallback на now()
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_boundary IS NULL THEN
    RAISE EXCEPTION 'boundary_required' USING ERRCODE = '22023';
  END IF;
  IF p_boundary > now() + v_max_skew THEN
    RAISE EXCEPTION 'boundary_in_future' USING ERRCODE = '22023';
  END IF;

  -- Атомарно: UPDATE по observed boundary + count оставшихся unread.
  WITH upd AS (
    UPDATE public.telegram_messages
       SET is_read = true
     WHERE user_id   = p_user_id
       AND direction = 'incoming'
       AND is_read   = false
       AND created_at <= p_boundary
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_marked FROM upd;

  SELECT COUNT(*)::int INTO v_remain
    FROM public.telegram_messages
   WHERE user_id   = p_user_id
     AND direction = 'incoming'
     AND is_read   = false;

  RETURN QUERY SELECT p_user_id, p_boundary, v_marked, v_remain;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_dialog_read_v2(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_dialog_read_v2(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_dialog_read_v2(uuid, timestamptz) TO service_role;


CREATE OR REPLACE FUNCTION public.bulk_mark_dialogs_read_v2(
  p_items jsonb
)
RETURNS TABLE(
  dialog_user_id         uuid,
  boundary               timestamptz,
  marked_count           integer,
  remaining_unread_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller    uuid := auth.uid();
  v_count     integer;
  v_max_skew  interval := interval '60 seconds';
  v_batch_max integer  := 500;
  rec         record;
  v_marked    integer;
  v_remain    integer;
BEGIN
  -- AuthN/AuthZ
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_caller, 'admin'::app_role)
       OR public.has_role(v_caller, 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Shape validation
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items_must_be_array' USING ERRCODE = '22023';
  END IF;

  v_count := jsonb_array_length(p_items);
  IF v_count = 0 THEN
    RETURN;
  END IF;
  IF v_count > v_batch_max THEN
    RAISE EXCEPTION 'batch_too_large' USING ERRCODE = '22023';
  END IF;

  -- Per-item validation (без silent drop)
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_items) elt
     WHERE jsonb_typeof(elt) <> 'object'
        OR (elt->>'user_id')  IS NULL
        OR (elt->>'boundary') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_item_shape' USING ERRCODE = '22023';
  END IF;

  -- Type validation (uuid/timestamptz cast may raise) + future check
  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_items) AS x(user_id uuid, boundary timestamptz)
     WHERE x.user_id IS NULL
        OR x.boundary IS NULL
        OR x.boundary > now() + v_max_skew
  ) THEN
    RAISE EXCEPTION 'invalid_item_value' USING ERRCODE = '22023';
  END IF;

  -- Per-dialog atomic processing (детерминированная дедупликация: последняя boundary
  -- для одинакового user_id побеждает через DISTINCT ON + ORDER BY boundary DESC).
  FOR rec IN
    SELECT DISTINCT ON (x.user_id) x.user_id, x.boundary
      FROM jsonb_to_recordset(p_items) AS x(user_id uuid, boundary timestamptz)
     ORDER BY x.user_id, x.boundary DESC
  LOOP
    WITH upd AS (
      UPDATE public.telegram_messages
         SET is_read = true
       WHERE user_id   = rec.user_id
         AND direction = 'incoming'
         AND is_read   = false
         AND created_at <= rec.boundary
      RETURNING 1
    )
    SELECT COUNT(*)::int INTO v_marked FROM upd;

    SELECT COUNT(*)::int INTO v_remain
      FROM public.telegram_messages
     WHERE user_id   = rec.user_id
       AND direction = 'incoming'
       AND is_read   = false;

    dialog_user_id := rec.user_id;
    boundary := rec.boundary;
    marked_count := v_marked;
    remaining_unread_count := v_remain;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_mark_dialogs_read_v2(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_mark_dialogs_read_v2(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_mark_dialogs_read_v2(jsonb) TO service_role;
