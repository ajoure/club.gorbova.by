-- Keep every database-side live-room guard aligned with the canonical
-- live-resolve evaluator. In particular:
--   * a proof is an invitation/session primitive, never standalone access;
--   * a tariff rule needs an exact tariff-bearing source;
--   * an enabled purchase-month gate fails closed when no valid month matches;
--   * aggregate entitlements may prove product access, but not a tariff.
CREATE OR REPLACE FUNCTION public.user_has_live_event_access(
  _user_id uuid,
  _live_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  _event record;
  _rule record;
  _has_rules boolean := false;
  _has_product_access boolean;
  _has_tariff_access boolean;
  _purchase_months text[];
  _purchase_month text;
  _month_gate_passed boolean;
  _legacy_mode text;
  _legacy_product_id uuid;
  _legacy_tariff_id uuid;
BEGIN
  IF _user_id IS NULL OR _live_event_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT le.product_id, le.access_rule, COALESCE(le.metadata, '{}'::jsonb) AS metadata
  INTO _event
  FROM public.live_events le
  WHERE le.id = _live_event_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Moderation is authoritative even for staff accounts.
  IF public.is_user_removed_from_room(_user_id, _live_event_id) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles_v2 ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user_id
      AND r.code IN ('admin', 'super_admin')
  ) THEN
    RETURN true;
  END IF;

  FOR _rule IN
    SELECT lear.id, lear.rule_kind, lear.product_id, lear.tariff_id,
           COALESCE(lear.conditions, '{}'::jsonb) AS conditions
    FROM public.live_event_access_rules lear
    WHERE lear.live_event_id = _live_event_id
    ORDER BY lear.sort_order, lear.id
  LOOP
    _has_rules := true;

    IF _rule.rule_kind = 'any_authenticated' THEN
      RETURN true;
    END IF;

    IF _rule.rule_kind <> 'product' OR _rule.product_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT
      EXISTS (
        SELECT 1
        FROM public.subscriptions_v2 s
        WHERE s.user_id = _user_id
          AND s.product_id = _rule.product_id
          AND s.status::text IN ('active', 'trial', 'past_due', 'canceled')
          AND (
            (s.access_end_at IS NULL AND s.status::text IN ('active', 'trial'))
            OR s.access_end_at > now() - interval '72 hours'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.entitlements e
        WHERE e.user_id = _user_id
          AND e.product_id = _rule.product_id
          AND e.status = 'active'
          AND (e.expires_at IS NULL OR e.expires_at > now())
      )
      OR EXISTS (
        SELECT 1
        FROM public.entitlement_sources es
        WHERE es.user_id = _user_id
          AND es.product_id = _rule.product_id
          AND es.status = 'active'
          AND es.starts_at <= now()
          AND (es.expires_at IS NULL OR es.expires_at > now())
      )
      OR EXISTS (
        SELECT 1
        FROM public.subscriptions_v2 s
        WHERE s.user_id = _user_id
          AND s.product_id = _rule.product_id
          AND s.billing_type = 'provider_managed'
          AND s.status::text <> 'canceled'
          AND (s.next_charge_at AT TIME ZONE 'Europe/Minsk')::date =
              (now() AT TIME ZONE 'Europe/Minsk')::date
      )
    INTO _has_product_access;

    IF NOT _has_product_access THEN
      CONTINUE;
    END IF;

    IF _rule.tariff_id IS NOT NULL THEN
      SELECT
        EXISTS (
          SELECT 1
          FROM public.subscriptions_v2 s
          WHERE s.user_id = _user_id
            AND s.product_id = _rule.product_id
            AND s.tariff_id = _rule.tariff_id
            AND s.status::text IN ('active', 'trial', 'past_due', 'canceled')
            AND (
              (s.access_end_at IS NULL AND s.status::text IN ('active', 'trial'))
              OR s.access_end_at > now() - interval '72 hours'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.entitlement_sources es
          WHERE es.user_id = _user_id
            AND es.product_id = _rule.product_id
            AND es.tariff_id = _rule.tariff_id
            AND es.status = 'active'
            AND es.starts_at <= now()
            AND (es.expires_at IS NULL OR es.expires_at > now())
        )
      INTO _has_tariff_access;

      IF NOT _has_tariff_access THEN
        CONTINUE;
      END IF;
    END IF;

    IF (_rule.conditions->'match_purchase_month') = 'true'::jsonb THEN
      SELECT COALESCE(array_agg(month_value ORDER BY ordinal), ARRAY[]::text[])
      INTO _purchase_months
      FROM (
        SELECT value AS month_value, ordinality AS ordinal
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(_event.metadata->'access_purchase_months') = 'array'
              THEN _event.metadata->'access_purchase_months'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY
        WHERE value ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      ) valid_months;

      IF cardinality(_purchase_months) = 0
         AND COALESCE(_event.metadata->>'content_month', '') ~
             '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        _purchase_months := ARRAY[_event.metadata->>'content_month'];
      END IF;

      _month_gate_passed := false;
      FOREACH _purchase_month IN ARRAY _purchase_months
      LOOP
        IF public.has_month_purchase(
          _user_id,
          _rule.tariff_id,
          _purchase_month
        ) THEN
          _month_gate_passed := true;
          EXIT;
        END IF;
      END LOOP;

      IF NOT _month_gate_passed THEN
        CONTINUE;
      END IF;
    END IF;

    RETURN true;
  END LOOP;

  IF _has_rules THEN
    RETURN false;
  END IF;

  -- Legacy events without rows in live_event_access_rules keep their existing
  -- access_rule behavior, but use the same source validation as modern rules.
  _legacy_mode := COALESCE(_event.access_rule->>'mode', 'product');
  IF _legacy_mode = 'all' THEN
    RETURN true;
  END IF;

  IF COALESCE(_event.access_rule->>'product_id', '') ~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    _legacy_product_id := (_event.access_rule->>'product_id')::uuid;
  ELSE
    _legacy_product_id := _event.product_id;
  END IF;

  IF _legacy_mode = 'tariff'
     AND COALESCE(_event.access_rule->>'tariff_id', '') ~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    _legacy_tariff_id := (_event.access_rule->>'tariff_id')::uuid;
  ELSE
    _legacy_tariff_id := NULL;
  END IF;

  IF _legacy_product_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.subscriptions_v2 s
      WHERE s.user_id = _user_id
        AND s.product_id = _legacy_product_id
        AND s.status::text IN ('active', 'trial', 'past_due', 'canceled')
        AND (
          (s.access_end_at IS NULL AND s.status::text IN ('active', 'trial'))
          OR s.access_end_at > now() - interval '72 hours'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.entitlements e
      WHERE e.user_id = _user_id
        AND e.product_id = _legacy_product_id
        AND e.status = 'active'
        AND (e.expires_at IS NULL OR e.expires_at > now())
    )
    OR EXISTS (
      SELECT 1
      FROM public.entitlement_sources es
      WHERE es.user_id = _user_id
        AND es.product_id = _legacy_product_id
        AND es.status = 'active'
        AND es.starts_at <= now()
        AND (es.expires_at IS NULL OR es.expires_at > now())
    )
    OR EXISTS (
      SELECT 1
      FROM public.subscriptions_v2 s
      WHERE s.user_id = _user_id
        AND s.product_id = _legacy_product_id
        AND s.billing_type = 'provider_managed'
        AND s.status::text <> 'canceled'
        AND (s.next_charge_at AT TIME ZONE 'Europe/Minsk')::date =
            (now() AT TIME ZONE 'Europe/Minsk')::date
    )
  INTO _has_product_access;

  IF NOT _has_product_access THEN
    RETURN false;
  END IF;

  IF _legacy_tariff_id IS NULL THEN
    RETURN true;
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.subscriptions_v2 s
      WHERE s.user_id = _user_id
        AND s.product_id = _legacy_product_id
        AND s.tariff_id = _legacy_tariff_id
        AND s.status::text IN ('active', 'trial', 'past_due', 'canceled')
        AND (
          (s.access_end_at IS NULL AND s.status::text IN ('active', 'trial'))
          OR s.access_end_at > now() - interval '72 hours'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.entitlement_sources es
      WHERE es.user_id = _user_id
        AND es.product_id = _legacy_product_id
        AND es.tariff_id = _legacy_tariff_id
        AND es.status = 'active'
        AND es.starts_at <= now()
        AND (es.expires_at IS NULL OR es.expires_at > now())
    )
  INTO _has_tariff_access;

  RETURN _has_tariff_access;
END;
$function$;

REVOKE ALL ON FUNCTION public.user_has_live_event_access(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_live_event_access(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_has_live_event_access(uuid, uuid)
  TO authenticated, service_role;
