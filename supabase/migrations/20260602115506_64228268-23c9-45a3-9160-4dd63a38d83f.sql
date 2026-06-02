CREATE OR REPLACE FUNCTION public.get_user_section_access(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(section_id uuid, section_code text, section_label text, section_route text, has_access boolean, is_public boolean, granted_via_product_id uuid, granted_via_product_name text, granted_via_tariff_id uuid, granted_via_tariff_name text, is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_effective_uid uuid;
  v_is_admin boolean;
  v_caller_uid uuid;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN;
  END IF;

  v_is_admin := public.has_role_v2(v_caller_uid, 'admin');
  IF v_is_admin AND p_user_id IS NOT NULL THEN
    v_effective_uid := p_user_id;
  ELSE
    v_effective_uid := v_caller_uid;
  END IF;

  -- Admin bypass
  IF public.has_role_v2(v_effective_uid, 'admin') THEN
    RETURN QUERY
      SELECT s.id, s.code, s.label, s.route,
             true::boolean,
             s.is_public,
             NULL::uuid, NULL::text, NULL::uuid, NULL::text,
             s.is_active
      FROM app_sections s
      ORDER BY s.sort_order;
    RETURN;
  END IF;

  RETURN QUERY
  WITH section_rules AS (
    -- Branch 1: legacy section_access with target_ref = section UUID
    SELECT
      s.id AS sid, s.code AS scode, s.label AS slabel,
      s.route AS sroute, s.is_public AS spublic, s.sort_order AS ssort,
      s.is_active AS sactive,
      ar.product_id AS rule_product_id,
      ar.tariff_id AS rule_tariff_id,
      p.name AS pname,
      t.name AS tname
    FROM app_sections s
    LEFT JOIN access_rules ar
      ON ar.grant_target_type = 'section_access'
      AND ar.is_active = true
      AND ar.target_ref IS NOT NULL
      AND ar.target_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND ar.target_ref::uuid = s.id
    LEFT JOIN products_v2 p ON p.id = ar.product_id
    LEFT JOIN tariffs t ON t.id = ar.tariff_id

    UNION ALL

    -- Branch 2: domain rule grant_target_type='document_generation' (sentinel target_ref),
    -- bridged ONLY to section app_sections.code='document_generation'.
    -- Visibility-only: partial/full and allowed_package_ids are NOT applied here;
    -- package-level filtering remains in get_user_document_package_ids() / RLS.
    SELECT
      s.id AS sid, s.code AS scode, s.label AS slabel,
      s.route AS sroute, s.is_public AS spublic, s.sort_order AS ssort,
      s.is_active AS sactive,
      ar.product_id AS rule_product_id,
      ar.tariff_id AS rule_tariff_id,
      p.name AS pname,
      t.name AS tname
    FROM app_sections s
    JOIN access_rules ar
      ON ar.grant_target_type = 'document_generation'
      AND ar.is_active = true
      AND ar.target_ref = 'document_generation'
    LEFT JOIN products_v2 p ON p.id = ar.product_id
    LEFT JOIN tariffs t ON t.id = ar.tariff_id
    WHERE s.code = 'document_generation'
  ),
  user_subs AS (
    SELECT sub.tariff_id, sub.product_id
    FROM subscriptions_v2 sub
    WHERE sub.user_id = v_effective_uid AND sub.status IN ('active', 'trial')
  ),
  user_ents AS (
    SELECT ent.product_id
    FROM entitlements ent
    WHERE ent.user_id = v_effective_uid AND ent.status = 'active'
  ),
  resolved AS (
    SELECT
      sr.sid, sr.scode, sr.slabel, sr.sroute, sr.spublic, sr.ssort, sr.sactive,
      sr.rule_product_id, sr.pname, sr.rule_tariff_id, sr.tname,
      CASE
        WHEN NOT sr.sactive THEN false
        WHEN sr.spublic THEN true
        WHEN sr.rule_tariff_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM user_subs us WHERE us.tariff_id = sr.rule_tariff_id)
          THEN true
        WHEN sr.rule_tariff_id IS NULL AND sr.rule_product_id IS NOT NULL
          AND (
            EXISTS (SELECT 1 FROM user_subs us WHERE us.product_id = sr.rule_product_id)
            OR EXISTS (SELECT 1 FROM user_ents ue WHERE ue.product_id = sr.rule_product_id)
          ) THEN true
        ELSE false
      END AS access_granted,
      ROW_NUMBER() OVER (
        PARTITION BY sr.sid
        ORDER BY
          CASE WHEN sr.rule_tariff_id IS NOT NULL THEN 0 ELSE 1 END,
          sr.rule_product_id NULLS LAST
      ) AS rn
    FROM section_rules sr
  )
  SELECT
    r.sid, r.scode, r.slabel, r.sroute,
    bool_or(r.access_granted),
    r.spublic,
    (ARRAY_AGG(r.rule_product_id ORDER BY r.rn) FILTER (WHERE r.access_granted))[1],
    (ARRAY_AGG(r.pname ORDER BY r.rn) FILTER (WHERE r.access_granted))[1],
    (ARRAY_AGG(r.rule_tariff_id ORDER BY r.rn) FILTER (WHERE r.access_granted))[1],
    (ARRAY_AGG(r.tname ORDER BY r.rn) FILTER (WHERE r.access_granted))[1],
    r.sactive
  FROM resolved r
  GROUP BY r.sid, r.scode, r.slabel, r.sroute, r.spublic, r.ssort, r.sactive
  ORDER BY r.ssort;
END;
$function$;