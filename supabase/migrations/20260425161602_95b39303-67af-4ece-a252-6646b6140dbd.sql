CREATE OR REPLACE FUNCTION public.get_last_broadcast_audit_proof()
RETURNS TABLE (
  created_at timestamptz,
  action text,
  actor_type text,
  actor_label text,
  actor_user_id uuid,
  sent integer,
  failed integer,
  diagnostic jsonb,
  meta jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'entitlements.manage') THEN
    RAISE EXCEPTION 'Forbidden: entitlements.manage permission required';
  END IF;

  RETURN QUERY
  SELECT
    al.created_at,
    al.action,
    al.actor_type,
    al.actor_label,
    al.actor_user_id,
    COALESCE((al.meta->>'sent')::integer, 0) AS sent,
    COALESCE((al.meta->>'failed')::integer, 0) AS failed,
    COALESCE(al.meta->'diagnostic', '{}'::jsonb) AS diagnostic,
    al.meta
  FROM public.audit_logs al
  WHERE al.action = 'email_mass_broadcast'
    AND al.actor_type = 'system'
    AND al.actor_user_id IS NULL
    AND al.actor_label = 'broadcast-dispatcher'
  ORDER BY al.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_last_broadcast_audit_proof() TO authenticated;