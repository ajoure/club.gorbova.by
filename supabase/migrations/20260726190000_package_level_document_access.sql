-- Package-level visibility is independent from the global document-generation
-- section. "Available to everyone" means every authenticated client, not anon.
ALTER TABLE public.document_package_templates
  ADD COLUMN IF NOT EXISTS is_available_to_all boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.document_package_templates.is_available_to_all IS
  'Makes this active global document package visible to every authenticated client.';

CREATE INDEX IF NOT EXISTS document_package_templates_default_access_idx
  ON public.document_package_templates (id)
  WHERE profile_id IS NULL AND is_active = true AND is_available_to_all = true;

CREATE OR REPLACE FUNCTION public.set_global_document_package_default_access(
  _package_id uuid,
  _is_available_to_all boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor uuid := auth.uid();
  _package record;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'set_global_document_package_default_access: not authenticated';
  END IF;
  IF NOT (public.has_role_v2(_actor, 'admin') OR public.has_role_v2(_actor, 'super_admin')) THEN
    RAISE EXCEPTION 'set_global_document_package_default_access: admin role required';
  END IF;

  SELECT id, name, profile_id, is_available_to_all
  INTO _package
  FROM public.document_package_templates
  WHERE id = _package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'package_id', _package_id);
  END IF;
  IF _package.profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'set_global_document_package_default_access: not a global package';
  END IF;

  UPDATE public.document_package_templates
  SET is_available_to_all = COALESCE(_is_available_to_all, false),
      updated_at = now()
  WHERE id = _package_id;

  IF _package.is_available_to_all IS DISTINCT FROM _is_available_to_all THEN
    INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
    VALUES (
      _actor,
      'user',
      CASE WHEN _is_available_to_all
        THEN 'document_package.default_access_enabled'
        ELSE 'document_package.default_access_disabled'
      END,
      jsonb_build_object('package_id', _package_id, 'package_name', _package.name)
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'updated',
    'package_id', _package_id,
    'is_available_to_all', COALESCE(_is_available_to_all, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_global_document_package_default_access(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_global_document_package_default_access(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_document_package_ids()
RETURNS TABLE(full_access boolean, package_ids uuid[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_full boolean := false;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_default_package_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, ARRAY[]::uuid[];
    RETURN;
  END IF;

  IF public.has_role_v2(v_user, 'admin') OR public.has_role_v2(v_user, 'super_admin') THEN
    RETURN QUERY SELECT true, ARRAY[]::uuid[];
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(p.id ORDER BY p.id), ARRAY[]::uuid[])
  INTO v_default_package_ids
  FROM public.document_package_templates p
  WHERE p.profile_id IS NULL
    AND p.is_active = true
    AND p.is_available_to_all = true;

  SELECT EXISTS (
    SELECT 1
    FROM public.access_rules ar
    WHERE ar.is_active = true
      AND (
        (ar.grant_target_type = 'section_access' AND ar.target_ref = 'document_generation')
        OR (
          ar.grant_target_type = 'document_generation'
          AND COALESCE(ar.conditions->>'access_mode', 'full') = 'full'
        )
      )
      AND public.user_has_access_to_rule(v_user, ar.id)
  ) INTO v_full;

  IF v_full THEN
    RETURN QUERY SELECT true, ARRAY[]::uuid[];
    RETURN;
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT package_id
    FROM unnest(v_default_package_ids || COALESCE((
      SELECT array_agg(DISTINCT pid::uuid)
      FROM public.access_rules ar
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(ar.conditions->'allowed_package_ids', '[]'::jsonb)) AS pid
      WHERE ar.is_active = true
        AND ar.grant_target_type = 'document_generation'
        AND COALESCE(ar.conditions->>'access_mode', 'full') = 'partial'
        AND public.user_has_access_to_rule(v_user, ar.id)
    ), ARRAY[]::uuid[])) AS package_id
    ORDER BY package_id
  ) INTO v_ids;

  RETURN QUERY SELECT false, v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_document_package_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_document_package_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_section_access(p_user_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(
  section_id uuid, section_code text, section_label text, section_route text,
  has_access boolean, is_public boolean, granted_via_product_id uuid,
  granted_via_product_name text, granted_via_tariff_id uuid,
  granted_via_tariff_name text, is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_effective_uid uuid;
  v_is_admin boolean;
  v_caller_uid uuid;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN RETURN; END IF;

  v_is_admin := public.has_role_v2(v_caller_uid, 'admin');
  IF v_is_admin AND p_user_id IS NOT NULL THEN
    v_effective_uid := p_user_id;
  ELSE
    v_effective_uid := v_caller_uid;
  END IF;

  IF public.has_role_v2(v_effective_uid, 'admin') THEN
    RETURN QUERY
      SELECT s.id, s.code, s.label, s.route, true::boolean, s.is_public,
             NULL::uuid, NULL::text, NULL::uuid, NULL::text, s.is_active
      FROM public.app_sections s
      ORDER BY s.sort_order;
    RETURN;
  END IF;

  RETURN QUERY
  WITH section_rules AS (
    SELECT
      s.id AS sid, s.code AS scode, s.label AS slabel, s.route AS sroute,
      s.is_public AS spublic, s.sort_order AS ssort, s.is_active AS sactive,
      ar.product_id AS rule_product_id, ar.tariff_id AS rule_tariff_id,
      p.name AS pname, t.name AS tname
    FROM public.app_sections s
    LEFT JOIN public.access_rules ar
      ON ar.grant_target_type = 'section_access'
      AND ar.is_active = true
      AND ar.target_ref IS NOT NULL
      AND ar.target_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND ar.target_ref::uuid = s.id
    LEFT JOIN public.products_v2 p ON p.id = ar.product_id
    LEFT JOIN public.tariffs t ON t.id = ar.tariff_id

    UNION ALL

    SELECT
      s.id, s.code, s.label, s.route, s.is_public, s.sort_order, s.is_active,
      ar.product_id, ar.tariff_id, p.name, t.name
    FROM public.app_sections s
    JOIN public.access_rules ar
      ON ar.grant_target_type = 'document_generation'
      AND ar.is_active = true
      AND ar.target_ref = 'document_generation'
    LEFT JOIN public.products_v2 p ON p.id = ar.product_id
    LEFT JOIN public.tariffs t ON t.id = ar.tariff_id
    WHERE s.code = 'document_generation'
  ),
  user_subs AS (
    SELECT sub.tariff_id, sub.product_id
    FROM public.subscriptions_v2 sub
    WHERE sub.user_id = v_effective_uid AND sub.status IN ('active', 'trial')
  ),
  user_ents AS (
    SELECT ent.product_id
    FROM public.entitlements ent
    WHERE ent.user_id = v_effective_uid AND ent.status = 'active'
  ),
  resolved AS (
    SELECT
      sr.sid, sr.scode, sr.slabel, sr.sroute, sr.spublic, sr.ssort, sr.sactive,
      sr.rule_product_id, sr.pname, sr.rule_tariff_id, sr.tname,
      CASE
        WHEN NOT sr.sactive THEN false
        -- The document-generation route is opened only by its package-level
        -- setting or a product rule; the generic section switch must not
        -- expose every document package.
        WHEN sr.spublic AND sr.scode <> 'document_generation' THEN true
        WHEN sr.scode = 'document_generation' AND EXISTS (
          SELECT 1 FROM public.document_package_templates p
          WHERE p.profile_id IS NULL AND p.is_active = true AND p.is_available_to_all = true
        ) THEN true
        WHEN sr.rule_tariff_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM user_subs us WHERE us.tariff_id = sr.rule_tariff_id) THEN true
        WHEN sr.rule_product_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM user_subs us WHERE us.product_id = sr.rule_product_id) THEN true
        WHEN sr.rule_product_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM user_ents ue WHERE ue.product_id = sr.rule_product_id) THEN true
        ELSE false
      END AS access_granted,
      ROW_NUMBER() OVER (
        PARTITION BY sr.sid
        ORDER BY CASE WHEN sr.rule_tariff_id IS NOT NULL THEN 0 ELSE 1 END, sr.rule_product_id NULLS LAST
      ) AS rn
    FROM section_rules sr
  )
  SELECT
    r.sid, r.scode, r.slabel, r.sroute, bool_or(r.access_granted), r.spublic,
    (ARRAY_AGG(r.rule_product_id ORDER BY r.rn) FILTER (WHERE r.access_granted))[1],
    (ARRAY_AGG(r.pname ORDER BY r.rn) FILTER (WHERE r.access_granted))[1],
    (ARRAY_AGG(r.rule_tariff_id ORDER BY r.rn) FILTER (WHERE r.access_granted))[1],
    (ARRAY_AGG(r.tname ORDER BY r.rn) FILTER (WHERE r.access_granted))[1], r.sactive
  FROM resolved r
  GROUP BY r.sid, r.scode, r.slabel, r.sroute, r.spublic, r.ssort, r.sactive
  ORDER BY r.ssort;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_section_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_section_access(uuid) TO authenticated;
