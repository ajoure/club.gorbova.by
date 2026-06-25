-- ============================================================
-- RBAC v3 — Migration C: RPC и хелперы
-- ============================================================

-- ------------------------------------------------------------
-- 1) get_admin_access(user_id) — основной резолвер
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_access(_user_id uuid)
RETURNS TABLE (
  section_code  text,
  resource_code text,    -- NULL для записи на уровне секции
  access_level  text,    -- 'view' | 'manage'
  source        text     -- 'admin_full' | 'section' | 'resource_override'
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;

  v_is_admin :=
    public.has_role_v2(_user_id, 'super_admin')
    OR public.has_role_v2(_user_id, 'admin');

  -- ---------- администраторы: полный доступ ко всему активному
  IF v_is_admin THEN
    RETURN QUERY
      SELECT s.code, NULL::text, 'manage'::text, 'admin_full'::text
        FROM public.admin_section s
       WHERE s.is_active
      UNION ALL
      SELECT s.code, r.code, 'manage'::text, 'admin_full'::text
        FROM public.admin_resource r
        JOIN public.admin_section s ON s.id = r.section_id
       WHERE s.is_active AND r.is_active;
    RETURN;
  END IF;

  -- ---------- обычные роли: section_access + resource_override
  RETURN QUERY
  WITH user_roles AS (
    SELECT ur.role_id
      FROM public.user_roles_v2 ur
     WHERE ur.user_id = _user_id
  ),
  section_grants AS (
    SELECT s.id            AS section_id,
           s.code          AS section_code,
           MAX(CASE rsa.access_level
                 WHEN 'manage' THEN 2
                 WHEN 'view'   THEN 1
                 ELSE 0
               END) AS lvl_rank
      FROM public.admin_section s
      JOIN public.role_admin_section_access rsa
        ON rsa.section_id = s.id
      JOIN user_roles ur ON ur.role_id = rsa.role_id
     WHERE s.is_active
     GROUP BY s.id, s.code
  ),
  resource_grants AS (
    SELECT r.id               AS resource_id,
           r.section_id       AS section_id,
           r.code             AS resource_code,
           s.code             AS section_code,
           MAX(CASE rra.access_level
                 WHEN 'manage' THEN 2
                 WHEN 'view'   THEN 1
                 ELSE 0
               END) AS lvl_rank
      FROM public.admin_resource r
      JOIN public.admin_section s ON s.id = r.section_id
      JOIN public.role_admin_resource_access rra ON rra.resource_id = r.id
      JOIN user_roles ur ON ur.role_id = rra.role_id
     WHERE r.is_active AND s.is_active
     GROUP BY r.id, r.section_id, r.code, s.code
  )
  -- a) уровень секции (без resource override)
  SELECT sg.section_code,
         NULL::text,
         CASE sg.lvl_rank WHEN 2 THEN 'manage' WHEN 1 THEN 'view' END,
         'section'::text
    FROM section_grants sg
   WHERE sg.lvl_rank > 0

  UNION ALL
  -- b) ресурс с явным override (главенствует над секцией)
  SELECT rg.section_code,
         rg.resource_code,
         CASE rg.lvl_rank WHEN 2 THEN 'manage' WHEN 1 THEN 'view' END,
         'resource_override'::text
    FROM resource_grants rg
   WHERE rg.lvl_rank > 0

  UNION ALL
  -- c) ресурсы без override — наследуют уровень секции
  SELECT s.code,
         r.code,
         CASE sg.lvl_rank WHEN 2 THEN 'manage' WHEN 1 THEN 'view' END,
         'section'::text
    FROM public.admin_resource r
    JOIN public.admin_section s ON s.id = r.section_id
    JOIN section_grants sg ON sg.section_id = s.id
   WHERE r.is_active
     AND s.is_active
     AND sg.lvl_rank > 0
     AND NOT EXISTS (
       SELECT 1 FROM resource_grants rg2 WHERE rg2.resource_id = r.id
     );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_access(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) assert_admin_self_role_lock — guard для self-revoke
-- ------------------------------------------------------------
-- Возвращает true, если выставление 'none' допустимо.
-- Бросает exception, если actor пытается выставить себе самому 'none'
-- на секции «roles» (потеря возможности управлять ролями).
CREATE OR REPLACE FUNCTION public.assert_admin_self_role_lock(
  _actor uuid,
  _role_id uuid,
  _section_code text,
  _access_level text
) RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_has_this_role boolean;
BEGIN
  IF _section_code <> 'roles' OR _access_level <> 'none' THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles_v2
     WHERE user_id = _actor AND role_id = _role_id
  ) INTO actor_has_this_role;

  IF actor_has_this_role THEN
    RAISE EXCEPTION 'self_role_lock: cannot revoke own access to roles section'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_admin_self_role_lock(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_admin_self_role_lock(uuid, uuid, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) sync_admin_menu_registry — idempotent upsert каталога
-- ------------------------------------------------------------
-- payload: jsonb массив
--   [{ code, label, route_prefix, icon, sort_order, group_code,
--      resources: [{ code, label, route, sort_order }] }, ...]
CREATE OR REPLACE FUNCTION public.sync_admin_menu_registry(_payload jsonb)
RETURNS TABLE (
  sections_added    int,
  sections_updated  int,
  sections_disabled int,
  resources_added   int,
  resources_updated int,
  resources_disabled int
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_sec_added int := 0; v_sec_updated int := 0; v_sec_disabled int := 0;
  v_res_added int := 0; v_res_updated int := 0; v_res_disabled int := 0;
  v_section_codes text[];
  v_section jsonb;
  v_existing_section public.admin_section%ROWTYPE;
  v_section_id uuid;
  v_resource jsonb;
  v_resource_codes text[];
  v_existing_resource public.admin_resource%ROWTYPE;
BEGIN
  -- доступ: только admin/super_admin (или service_role обходит RLS, но проверим явно)
  v_is_admin :=
    v_actor IS NOT NULL AND (
      public.has_role_v2(v_actor, 'super_admin')
      OR public.has_role_v2(v_actor, 'admin')
    );

  IF NOT v_is_admin AND v_actor IS NOT NULL THEN
    RAISE EXCEPTION 'sync_admin_menu_registry: forbidden' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(_payload) <> 'array' THEN
    RAISE EXCEPTION 'sync_admin_menu_registry: payload must be jsonb array';
  END IF;

  v_section_codes := ARRAY(
    SELECT lower(trim(s->>'code'))
      FROM jsonb_array_elements(_payload) s
     WHERE coalesce(s->>'code','') <> ''
  );

  -- ---------- секции: upsert
  FOR v_section IN SELECT * FROM jsonb_array_elements(_payload)
  LOOP
    IF coalesce(v_section->>'code','') = '' THEN CONTINUE; END IF;

    SELECT * INTO v_existing_section
      FROM public.admin_section
     WHERE code = lower(trim(v_section->>'code'));

    IF NOT FOUND THEN
      INSERT INTO public.admin_section (
        code, label, route_prefix, icon, sort_order, group_code, is_active, created_by, updated_by
      ) VALUES (
        lower(trim(v_section->>'code')),
        coalesce(v_section->>'label', v_section->>'code'),
        coalesce(v_section->>'route_prefix', '/'),
        v_section->>'icon',
        coalesce((v_section->>'sort_order')::int, 0),
        v_section->>'group_code',
        true,
        v_actor, v_actor
      ) RETURNING id INTO v_section_id;
      v_sec_added := v_sec_added + 1;
    ELSE
      v_section_id := v_existing_section.id;
      UPDATE public.admin_section
         SET label        = coalesce(v_section->>'label', label),
             route_prefix = coalesce(v_section->>'route_prefix', route_prefix),
             icon         = coalesce(v_section->>'icon', icon),
             sort_order   = coalesce((v_section->>'sort_order')::int, sort_order),
             group_code   = coalesce(v_section->>'group_code', group_code),
             is_active    = true,
             updated_by   = v_actor
       WHERE id = v_section_id
         AND (
           label        IS DISTINCT FROM coalesce(v_section->>'label', label)
           OR route_prefix IS DISTINCT FROM coalesce(v_section->>'route_prefix', route_prefix)
           OR icon       IS DISTINCT FROM coalesce(v_section->>'icon', icon)
           OR sort_order IS DISTINCT FROM coalesce((v_section->>'sort_order')::int, sort_order)
           OR group_code IS DISTINCT FROM coalesce(v_section->>'group_code', group_code)
           OR is_active = false
         );
      IF FOUND THEN
        v_sec_updated := v_sec_updated + 1;
      END IF;
    END IF;

    -- ----- ресурсы внутри секции
    v_resource_codes := ARRAY[]::text[];
    IF jsonb_typeof(v_section->'resources') = 'array' THEN
      v_resource_codes := ARRAY(
        SELECT lower(trim(r->>'code'))
          FROM jsonb_array_elements(v_section->'resources') r
         WHERE coalesce(r->>'code','') <> ''
      );

      FOR v_resource IN SELECT * FROM jsonb_array_elements(v_section->'resources')
      LOOP
        IF coalesce(v_resource->>'code','') = '' THEN CONTINUE; END IF;

        SELECT * INTO v_existing_resource
          FROM public.admin_resource
         WHERE section_id = v_section_id
           AND code = lower(trim(v_resource->>'code'));

        IF NOT FOUND THEN
          INSERT INTO public.admin_resource (
            section_id, code, label, route, sort_order, is_active, created_by, updated_by
          ) VALUES (
            v_section_id,
            lower(trim(v_resource->>'code')),
            coalesce(v_resource->>'label', v_resource->>'code'),
            coalesce(v_resource->>'route', ''),
            coalesce((v_resource->>'sort_order')::int, 0),
            true,
            v_actor, v_actor
          );
          v_res_added := v_res_added + 1;
        ELSE
          UPDATE public.admin_resource
             SET label      = coalesce(v_resource->>'label', label),
                 route      = coalesce(v_resource->>'route', route),
                 sort_order = coalesce((v_resource->>'sort_order')::int, sort_order),
                 is_active  = true,
                 updated_by = v_actor
           WHERE id = v_existing_resource.id
             AND (
               label      IS DISTINCT FROM coalesce(v_resource->>'label', label)
               OR route   IS DISTINCT FROM coalesce(v_resource->>'route', route)
               OR sort_order IS DISTINCT FROM coalesce((v_resource->>'sort_order')::int, sort_order)
               OR is_active = false
             );
          IF FOUND THEN
            v_res_updated := v_res_updated + 1;
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- soft-disable orphan ресурсов внутри этой секции
    WITH disabled AS (
      UPDATE public.admin_resource
         SET is_active = false, updated_by = v_actor
       WHERE section_id = v_section_id
         AND is_active = true
         AND NOT (code = ANY(v_resource_codes))
      RETURNING 1
    )
    SELECT count(*) FROM disabled INTO v_res_disabled;
    v_res_disabled := coalesce(v_res_disabled, 0) + (
      SELECT 0
    );
  END LOOP;

  -- soft-disable orphan секций
  WITH disabled_sections AS (
    UPDATE public.admin_section
       SET is_active = false, updated_by = v_actor
     WHERE is_active = true
       AND NOT (code = ANY(v_section_codes))
    RETURNING 1
  )
  SELECT count(*) FROM disabled_sections INTO v_sec_disabled;

  -- audit
  BEGIN
    INSERT INTO public.audit_logs (
      action, actor_id, target_type, payload, metadata
    ) VALUES (
      'admin_menu_registry.sync',
      v_actor,
      'admin_section',
      jsonb_build_object(
        'sections_added', v_sec_added,
        'sections_updated', v_sec_updated,
        'sections_disabled', coalesce(v_sec_disabled,0),
        'resources_added', v_res_added,
        'resources_updated', v_res_updated,
        'resources_disabled', coalesce(v_res_disabled,0)
      ),
      jsonb_build_object('source', 'sync_admin_menu_registry')
    );
  EXCEPTION WHEN OTHERS THEN
    -- если структура audit_logs другая, не валим основную операцию
    NULL;
  END;

  RETURN QUERY SELECT
    v_sec_added,
    v_sec_updated,
    coalesce(v_sec_disabled,0),
    v_res_added,
    v_res_updated,
    coalesce(v_res_disabled,0);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_admin_menu_registry(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_admin_menu_registry(jsonb) TO authenticated, service_role;