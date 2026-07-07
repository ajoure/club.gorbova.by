CREATE OR REPLACE FUNCTION public.user_has_live_event_access(_user_id uuid, _live_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT (
    (
      EXISTS (
        SELECT 1 FROM public.user_roles_v2 ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = _user_id
          AND r.code IN ('admin', 'super_admin')
      )
      OR EXISTS (
        SELECT 1
        FROM public.live_event_access_rules lear
        WHERE lear.live_event_id = _live_event_id
          AND lear.rule_kind = 'any_authenticated'
      )
      OR EXISTS (
        SELECT 1
        FROM public.live_event_access_rules lear
        WHERE lear.live_event_id = _live_event_id
          AND lear.product_id IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM public.subscriptions_v2 s
              WHERE s.user_id = _user_id
                AND s.product_id = lear.product_id
                AND s.status::text IN ('active', 'past_due')
                AND (s.access_end_at IS NULL OR s.access_end_at > now())
                AND (lear.tariff_id IS NULL OR s.tariff_id = lear.tariff_id)
            )
            OR
            EXISTS (
              SELECT 1 FROM public.entitlements e
              WHERE e.user_id = _user_id
                AND e.product_id = lear.product_id
                AND e.status = 'active'
                AND (e.expires_at IS NULL OR e.expires_at > now())
            )
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.live_access_proofs lap
        WHERE lap.live_event_id = _live_event_id
          AND lap.user_id = _user_id
          AND (lap.expires_at IS NULL OR lap.expires_at > now())
      )
    )
    AND NOT public.is_user_removed_from_room(_user_id, _live_event_id)
  )
$$;