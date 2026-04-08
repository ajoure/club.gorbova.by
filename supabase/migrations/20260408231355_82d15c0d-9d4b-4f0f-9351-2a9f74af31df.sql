-- ============================================
-- STEP 1: CREATE TABLE app_sections
-- ============================================

CREATE TABLE public.app_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label text NOT NULL,
  icon text,
  route text UNIQUE NOT NULL,
  is_public boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_sections_active ON public.app_sections (is_active, sort_order);

-- ============================================
-- STEP 2: RLS
-- ============================================

ALTER TABLE public.app_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read active or admins read all"
  ON public.app_sections FOR SELECT TO authenticated
  USING (is_active = true OR public.has_role_v2(auth.uid(), 'admin'));

CREATE POLICY "Admins manage sections"
  ON public.app_sections FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));

-- ============================================
-- STEP 3: SEED (all is_public=true)
-- ============================================

INSERT INTO public.app_sections (code, label, icon, route, is_public, sort_order) VALUES
  ('dashboard',        'Пульс',                  'Activity',       '/dashboard',          true, 0),
  ('knowledge',        'База знаний',             'BookOpen',       '/knowledge',          true, 1),
  ('money',            'Деньги',                  'Wallet',         '/money',              true, 2),
  ('self_development', 'Саморазвитие',            'Sparkles',       '/self-development',   true, 3),
  ('ai',               'Нейросеть',               'Cpu',            '/ai',                 true, 4),
  ('live',             'Эфиры',                   'Radio',          '/live',               true, 5),
  ('products',         'Обучение',                'GraduationCap',  '/products',           true, 6),
  ('eisenhower',       'Матрица продуктивности',  'LayoutGrid',     '/tools/eisenhower',   true, 7);

-- ============================================
-- STEP 4: ALTER CHECK constraint (add-only)
-- ============================================

ALTER TABLE public.access_rules
  DROP CONSTRAINT access_rules_grant_target_type_check;

ALTER TABLE public.access_rules
  ADD CONSTRAINT access_rules_grant_target_type_check
  CHECK (grant_target_type = ANY (ARRAY[
    'entitlement','club','email','product_access','training_content','section_access'
  ]));

-- ============================================
-- STEP 5: updated_at trigger for app_sections
-- ============================================

CREATE TRIGGER update_app_sections_updated_at
  BEFORE UPDATE ON public.app_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- STEP 6: RPC get_user_section_access
-- ============================================

CREATE OR REPLACE FUNCTION public.get_user_section_access(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  section_id uuid,
  section_code text,
  section_label text,
  section_route text,
  has_access boolean,
  is_public boolean,
  granted_via_product_id uuid,
  granted_via_product_name text,
  granted_via_tariff_id uuid,
  granted_via_tariff_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_effective_uid uuid;
  v_is_admin boolean;
  v_caller_uid uuid;
BEGIN
  -- Early return: unauthenticated caller
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN; -- empty result set
  END IF;

  -- Auth guard: non-admin always resolves own access
  v_is_admin := public.has_role_v2(v_caller_uid, 'admin');
  IF v_is_admin AND p_user_id IS NOT NULL THEN
    v_effective_uid := p_user_id;
  ELSE
    v_effective_uid := v_caller_uid;
  END IF;

  -- Admin bypass: all sections accessible
  IF public.has_role_v2(v_effective_uid, 'admin') THEN
    RETURN QUERY
      SELECT s.id, s.code, s.label, s.route,
             true::boolean,
             s.is_public,
             NULL::uuid, NULL::text, NULL::uuid, NULL::text
      FROM app_sections s
      WHERE s.is_active = true
      ORDER BY s.sort_order;
    RETURN;
  END IF;

  -- Regular user resolution
  RETURN QUERY
  WITH section_rules AS (
    SELECT
      s.id AS sid, s.code AS scode, s.label AS slabel,
      s.route AS sroute, s.is_public AS spublic, s.sort_order AS ssort,
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
    WHERE s.is_active = true
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
      sr.sid, sr.scode, sr.slabel, sr.sroute, sr.spublic, sr.ssort,
      sr.rule_product_id, sr.pname, sr.rule_tariff_id, sr.tname,
      CASE
        WHEN sr.spublic THEN true
        -- tariff-level rule: check subscriptions only
        WHEN sr.rule_tariff_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM user_subs us WHERE us.tariff_id = sr.rule_tariff_id)
          THEN true
        -- product-level rule: check subscriptions + entitlements
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
    (ARRAY_AGG(r.tname ORDER BY r.rn) FILTER (WHERE r.access_granted))[1]
  FROM resolved r
  GROUP BY r.sid, r.scode, r.slabel, r.sroute, r.spublic, r.ssort
  ORDER BY r.ssort;
END;
$$;