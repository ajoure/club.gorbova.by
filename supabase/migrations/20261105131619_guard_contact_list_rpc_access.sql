-- Close four audited contact-list RPCs without touching client data.
-- One DO statement is one transaction: drift aborts before any DDL;
-- partial/post-check failure rolls every function and ACL change back.
-- Forward-only security repair. Never restore the previous public exposure.
DO $contact_guard_migration$
DECLARE
  v_contract jsonb := $contract$[
  {
    "name": "get_duplicate_contact_profiles",
    "signature": "public.get_duplicate_contact_profiles(integer,integer,text)",
    "old_body_md5": "95ec7a3c88103ce3772a5b6f93f8c11e",
    "new_body_md5": "d896265c679cb66e318c8a3c9a3ee0cf",
    "old_language": "sql",
    "new_language": "plpgsql",
    "return_kind": "setof_profiles",
    "arg_names": [
      "p_limit",
      "p_offset",
      "p_search"
    ],
    "defaults": "100, 0, NULL::text",
    "old_public_anon": true,
    "arg_types": [
      "integer",
      "integer",
      "text"
    ],
    "all_arg_names": [
      "p_limit",
      "p_offset",
      "p_search"
    ],
    "all_arg_types": null,
    "modes": null,
    "return_type": "public.profiles",
    "returns_set": true,
    "old_acl": [
      "PUBLIC|postgres|EXECUTE|false",
      "anon|postgres|EXECUTE|false",
      "authenticated|postgres|EXECUTE|false",
      "postgres|postgres|EXECUTE|false",
      "sandbox_exec_hdjgkjceownmmnrqqtuz|postgres|EXECUTE|false",
      "service_role|postgres|EXECUTE|false"
    ],
    "new_acl": [
      "authenticated|postgres|EXECUTE|false",
      "postgres|postgres|EXECUTE|false",
      "sandbox_exec_hdjgkjceownmmnrqqtuz|postgres|EXECUTE|false",
      "service_role|postgres|EXECUTE|false"
    ]
  },
  {
    "name": "get_profiles_with_paid_orders",
    "signature": "public.get_profiles_with_paid_orders(integer,integer,text)",
    "old_body_md5": "231092dacfaff6e49ad42b7c856bebfd",
    "new_body_md5": "78bf35946813049ce6ac946429a0af36",
    "old_language": "sql",
    "new_language": "plpgsql",
    "return_kind": "paid_table",
    "arg_names": [
      "p_limit",
      "p_offset",
      "p_search"
    ],
    "defaults": "NULL::text",
    "old_public_anon": true,
    "arg_types": [
      "integer",
      "integer",
      "text"
    ],
    "all_arg_names": [
      "p_limit",
      "p_offset",
      "p_search",
      "profile_id",
      "user_id",
      "email",
      "full_name",
      "first_name",
      "last_name",
      "phone",
      "telegram_username",
      "telegram_user_id",
      "status",
      "is_archived",
      "created_at",
      "duplicate_flag",
      "avatar_url",
      "last_seen_at",
      "loyalty_score",
      "loyalty_ai_summary",
      "loyalty_status_reason",
      "loyalty_proofs",
      "loyalty_analyzed_messages_count",
      "loyalty_updated_at",
      "communication_style",
      "last_paid_at",
      "paid_orders_count"
    ],
    "all_arg_types": [
      "integer",
      "integer",
      "text",
      "uuid",
      "uuid",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
      "bigint",
      "text",
      "boolean",
      "timestamptz",
      "text",
      "text",
      "timestamptz",
      "numeric",
      "text",
      "text",
      "jsonb",
      "integer",
      "timestamptz",
      "jsonb",
      "timestamptz",
      "integer"
    ],
    "modes": [
      "i",
      "i",
      "i",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t",
      "t"
    ],
    "return_type": "record",
    "returns_set": true,
    "old_acl": [
      "PUBLIC|postgres|EXECUTE|false",
      "anon|postgres|EXECUTE|false",
      "authenticated|postgres|EXECUTE|false",
      "postgres|postgres|EXECUTE|false",
      "sandbox_exec_hdjgkjceownmmnrqqtuz|postgres|EXECUTE|false",
      "service_role|postgres|EXECUTE|false"
    ],
    "new_acl": [
      "authenticated|postgres|EXECUTE|false",
      "postgres|postgres|EXECUTE|false",
      "sandbox_exec_hdjgkjceownmmnrqqtuz|postgres|EXECUTE|false",
      "service_role|postgres|EXECUTE|false"
    ]
  },
  {
    "name": "get_contact_tab_counts",
    "signature": "public.get_contact_tab_counts(text)",
    "old_body_md5": "3d040e8907cd356beec8486f7d4944f1",
    "new_body_md5": "91f6bc81b5c3ec2292946a1ad8fc12ea",
    "old_language": "sql",
    "new_language": "plpgsql",
    "return_kind": "json",
    "arg_names": [
      "p_search"
    ],
    "defaults": "NULL::text",
    "old_public_anon": false,
    "arg_types": [
      "text"
    ],
    "all_arg_names": [
      "p_search"
    ],
    "all_arg_types": null,
    "modes": null,
    "return_type": "json",
    "returns_set": false,
    "old_acl": [
      "authenticated|postgres|EXECUTE|false",
      "postgres|postgres|EXECUTE|false",
      "sandbox_exec_hdjgkjceownmmnrqqtuz|postgres|EXECUTE|false",
      "service_role|postgres|EXECUTE|false"
    ],
    "new_acl": [
      "authenticated|postgres|EXECUTE|false",
      "postgres|postgres|EXECUTE|false",
      "sandbox_exec_hdjgkjceownmmnrqqtuz|postgres|EXECUTE|false",
      "service_role|postgres|EXECUTE|false"
    ]
  },
  {
    "name": "get_profiles_with_paid_orders_count",
    "signature": "public.get_profiles_with_paid_orders_count(text)",
    "old_body_md5": "671f75a3589bdf860e787d45275e11be",
    "new_body_md5": "f4c13000c7e55e016b0b5c766b6c5dbb",
    "old_language": "sql",
    "new_language": "plpgsql",
    "return_kind": "bigint",
    "arg_names": [
      "p_search"
    ],
    "defaults": "NULL::text",
    "old_public_anon": false,
    "arg_types": [
      "text"
    ],
    "all_arg_names": [
      "p_search"
    ],
    "all_arg_types": null,
    "modes": null,
    "return_type": "bigint",
    "returns_set": false,
    "old_acl": [
      "authenticated|postgres|EXECUTE|false",
      "postgres|postgres|EXECUTE|false",
      "sandbox_exec_hdjgkjceownmmnrqqtuz|postgres|EXECUTE|false",
      "service_role|postgres|EXECUTE|false"
    ],
    "new_acl": [
      "authenticated|postgres|EXECUTE|false",
      "postgres|postgres|EXECUTE|false",
      "sandbox_exec_hdjgkjceownmmnrqqtuz|postgres|EXECUTE|false",
      "service_role|postgres|EXECUTE|false"
    ]
  }
]$contract$::jsonb;
  v_rule jsonb;
  v_meta record;
  v_acl text[];
  v_expected_types oid[];
  v_expected_all_types oid[];
  v_old integer;
  v_new integer;
  v_phase integer;
  v_empty_path boolean;
  v_helper oid := to_regprocedure('public.has_admin_section_access(uuid,text,text)');
BEGIN
  IF v_helper IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE p.oid = v_helper
      AND pg_catalog.md5(p.prosrc) = 'c058bbd825535772cdfc4de69d95b147'
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prokind = 'f' AND p.provolatile = 's' AND p.prosecdef
      AND p.prorettype = 'boolean'::regtype AND NOT p.proretset
      AND l.lanname = 'plpgsql'
      AND p.proargnames = ARRAY['_user_id','_section_code','_min_level']::text[]
      AND pg_catalog.pg_get_expr(p.proargdefaults, 0) = '''view''::text'
      AND cardinality(p.proconfig) = 1
      AND p.proconfig[1] IN ('search_path=', 'search_path=""')
  ) THEN
    RAISE EXCEPTION 'contact_rpc_guard_preflight: canonical helper drift'
      USING ERRCODE = '55000';
  END IF;

  FOR v_phase IN 1..2 LOOP
    v_old := 0;
    v_new := 0;
    FOR v_rule IN SELECT value FROM jsonb_array_elements(v_contract) LOOP
      SELECT p.*, l.lanname INTO v_meta
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure(v_rule->>'signature');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'contact_rpc_guard_preflight: missing %', v_rule->>'signature'
          USING ERRCODE = '55000';
      END IF;

      SELECT array_agg(to_regtype(t.type_name)::oid ORDER BY t.position)
      INTO v_expected_types
      FROM jsonb_array_elements_text(v_rule->'arg_types') WITH ORDINALITY t(type_name, position);
      v_expected_all_types := NULL;
      IF v_rule->>'return_kind' = 'paid_table' THEN
        SELECT array_agg(to_regtype(t.type_name)::oid ORDER BY t.position)
        INTO v_expected_all_types
        FROM jsonb_array_elements_text(v_rule->'all_arg_types') WITH ORDINALITY t(type_name, position);
      END IF;
      IF pg_catalog.pg_get_userbyid(v_meta.proowner) <> 'postgres'
        OR v_meta.prokind <> 'f' OR v_meta.provolatile <> 's'
        OR NOT v_meta.prosecdef OR v_meta.proisstrict OR v_meta.proleakproof
        OR v_meta.prorettype IS DISTINCT FROM to_regtype(v_rule->>'return_type')::oid
        OR v_meta.proretset <> (v_rule->>'returns_set')::boolean
        OR ARRAY(SELECT unnest(v_meta.proargtypes)) IS DISTINCT FROM v_expected_types
        OR v_meta.proallargtypes IS DISTINCT FROM v_expected_all_types
        OR to_jsonb(v_meta.proargnames) IS DISTINCT FROM v_rule->'all_arg_names'
        OR coalesce(to_jsonb(v_meta.proargmodes), 'null'::jsonb) IS DISTINCT FROM v_rule->'modes'
        OR pg_catalog.pg_get_expr(v_meta.proargdefaults, 0) IS DISTINCT FROM v_rule->>'defaults'
      THEN
        RAISE EXCEPTION 'contact_rpc_guard_preflight: identity, shape or owner drift for %', v_rule->>'signature'
          USING ERRCODE = '55000';
      END IF;

      SELECT array_agg(a.entry ORDER BY a.entry COLLATE "C") INTO v_acl
      FROM (
        SELECT format('%s|%s|%s|%s',
          CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END,
          pg_catalog.pg_get_userbyid(x.grantor), x.privilege_type, x.is_grantable::text) AS entry
        FROM pg_catalog.aclexplode(coalesce(v_meta.proacl, pg_catalog.acldefault('f', v_meta.proowner))) x
      ) a;
      v_empty_path := cardinality(v_meta.proconfig) = 1
        AND v_meta.proconfig[1] IN ('search_path=', 'search_path=""');

      IF pg_catalog.md5(v_meta.prosrc) = v_rule->>'old_body_md5'
        AND v_meta.lanname = 'sql'
        AND v_meta.proconfig = ARRAY['search_path=public']::text[]
        AND to_jsonb(v_acl) = v_rule->'old_acl'
      THEN v_old := v_old + 1;
      ELSIF pg_catalog.md5(v_meta.prosrc) = v_rule->>'new_body_md5'
        AND v_meta.lanname = 'plpgsql' AND v_empty_path
        AND to_jsonb(v_acl) = v_rule->'new_acl'
      THEN v_new := v_new + 1;
      ELSE
        RAISE EXCEPTION 'contact_rpc_guard_preflight: body, language, path or ACL drift for %', v_rule->>'signature'
          USING ERRCODE = '55000';
      END IF;
    END LOOP;

    IF v_new = 4 THEN
      -- Exact secured bodies, signatures, helper and ACLs: second application is a no-op.
      RETURN;
    END IF;
    IF v_phase <> 1 OR v_old <> 4 OR v_new <> 0 THEN
      RAISE EXCEPTION 'contact_rpc_guard_preflight: mixed or incomplete state'
        USING ERRCODE = '55000';
    END IF;

    EXECUTE $secured_1$
CREATE OR REPLACE FUNCTION public.get_duplicate_contact_profiles(
  p_limit int DEFAULT 100, p_offset int DEFAULT 0, p_search text DEFAULT NULL
)
RETURNS SETOF public.profiles LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $guard_body$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT coalesce(public.has_admin_section_access(v_actor, 'contacts', 'view'), false) THEN
    RAISE EXCEPTION 'Forbidden: contacts view required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH visible_prof AS (
      SELECT p.* FROM public.profiles p
      WHERE coalesce(p.is_archived,false)=false AND p.status <> 'archived' AND p.merged_to_profile_id IS NULL
        AND (
          p_search IS NULL OR coalesce(p.email,'') ILIKE '%'||p_search||'%' OR coalesce(p.full_name,'') ILIKE '%'||p_search||'%' OR coalesce(p.phone,'') ILIKE '%'||p_search||'%'
          OR EXISTS (
            SELECT 1 FROM public.company_contacts cc JOIN public.companies c ON c.id=cc.company_id
            WHERE cc.profile_id=p.id AND c.status <> 'merged'
              AND (c.full_name ILIKE '%'||p_search||'%' OR c.short_name ILIKE '%'||p_search||'%' OR c.public_id ILIKE '%'||p_search||'%' OR c.unp_normalized ILIKE '%'||p_search||'%')
          )
        )
    ), keys AS (
      SELECT id AS profile_id, 'email'::text AS kind, lower(trim(email)) AS key FROM visible_prof WHERE nullif(trim(coalesce(email,'')),'') IS NOT NULL
      UNION ALL SELECT id AS profile_id, 'phone'::text AS kind, right(regexp_replace(phone,'[^0-9]','','g'),9) AS key FROM visible_prof WHERE length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) >= 7
    ), duplicate_keys AS (
      SELECT kind,key FROM keys WHERE key <> '' GROUP BY kind,key HAVING count(*) > 1
    ), duplicate_profile_ids AS (
      SELECT DISTINCT k.profile_id FROM keys k JOIN duplicate_keys dk ON dk.kind=k.kind AND dk.key=k.key
    )
    SELECT p.* FROM visible_prof p JOIN duplicate_profile_ids d ON d.profile_id=p.id
    ORDER BY p.created_at DESC,p.id DESC LIMIT greatest(p_limit,0) OFFSET greatest(p_offset,0);
END;
$guard_body$;
$secured_1$;

    EXECUTE $secured_2$
CREATE OR REPLACE FUNCTION public.get_profiles_with_paid_orders(
  p_limit int, p_offset int, p_search text DEFAULT NULL
)
RETURNS TABLE (
  profile_id uuid, user_id uuid, email text, full_name text, first_name text,
  last_name text, phone text, telegram_username text, telegram_user_id bigint,
  status text, is_archived boolean, created_at timestamptz, duplicate_flag text,
  avatar_url text, last_seen_at timestamptz, loyalty_score numeric,
  loyalty_ai_summary text, loyalty_status_reason text, loyalty_proofs jsonb,
  loyalty_analyzed_messages_count int, loyalty_updated_at timestamptz,
  communication_style jsonb, last_paid_at timestamptz, paid_orders_count int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $guard_body$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT coalesce(public.has_admin_section_access(v_actor, 'contacts', 'view'), false) THEN
    RAISE EXCEPTION 'Forbidden: contacts view required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH paid AS (
      SELECT o.profile_id, max(o.created_at) AS last_paid_at, count(*)::int AS paid_orders_count
      FROM public.orders_v2 o
      WHERE o.status = 'paid' AND o.profile_id IS NOT NULL
      GROUP BY o.profile_id
    ), filtered AS (
      SELECT p.id AS profile_id, p.user_id, p.email, p.full_name, p.first_name, p.last_name, p.phone,
        p.telegram_username, p.telegram_user_id, p.status, p.is_archived, p.created_at,
        p.duplicate_flag, p.avatar_url, p.last_seen_at, p.loyalty_score, p.loyalty_ai_summary,
        p.loyalty_status_reason, p.loyalty_proofs, p.loyalty_analyzed_messages_count,
        p.loyalty_updated_at, p.communication_style, paid.last_paid_at, paid.paid_orders_count
      FROM paid JOIN public.profiles p ON p.id = paid.profile_id
      WHERE p_search IS NULL
         OR coalesce(p.email,'') ILIKE '%'||p_search||'%'
         OR coalesce(p.full_name,'') ILIKE '%'||p_search||'%'
         OR coalesce(p.phone,'') ILIKE '%'||p_search||'%'
         OR EXISTS (
           SELECT 1 FROM public.company_contacts cc JOIN public.companies c ON c.id = cc.company_id
           WHERE cc.profile_id = p.id AND c.status <> 'merged'
             AND (coalesce(c.full_name,'') ILIKE '%'||p_search||'%' OR coalesce(c.short_name,'') ILIKE '%'||p_search||'%' OR coalesce(c.public_id,'') ILIKE '%'||p_search||'%' OR coalesce(c.unp_normalized,'') ILIKE '%'||p_search||'%')
         )
    )
    SELECT filtered.profile_id,
    filtered.user_id,
    filtered.email,
    filtered.full_name,
    filtered.first_name,
    filtered.last_name,
    filtered.phone,
    filtered.telegram_username,
    filtered.telegram_user_id,
    filtered.status,
    filtered.is_archived,
    filtered.created_at,
    filtered.duplicate_flag,
    filtered.avatar_url,
    filtered.last_seen_at,
    filtered.loyalty_score::numeric AS loyalty_score,
    filtered.loyalty_ai_summary,
    filtered.loyalty_status_reason,
    filtered.loyalty_proofs,
    filtered.loyalty_analyzed_messages_count,
    filtered.loyalty_updated_at,
    filtered.communication_style,
    filtered.last_paid_at,
    filtered.paid_orders_count
  FROM filtered ORDER BY filtered.last_paid_at DESC, filtered.profile_id DESC LIMIT p_limit OFFSET p_offset;
END;
$guard_body$;
$secured_2$;

    EXECUTE $secured_3$
CREATE OR REPLACE FUNCTION public.get_contact_tab_counts(p_search text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $guard_body$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT coalesce(public.has_admin_section_access(v_actor, 'contacts', 'view'), false) THEN
    RAISE EXCEPTION 'Forbidden: contacts view required' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH prof AS (
        SELECT p.*
        FROM public.profiles p
        WHERE p_search IS NULL
           OR coalesce(p.email,'') ILIKE '%'||p_search||'%'
           OR coalesce(p.full_name,'') ILIKE '%'||p_search||'%'
           OR coalesce(p.phone,'') ILIKE '%'||p_search||'%'
           OR EXISTS (
             SELECT 1
             FROM public.company_contacts cc
             JOIN public.companies c ON c.id = cc.company_id
             WHERE cc.profile_id = p.id
               AND c.status <> 'merged'
               AND (
                 coalesce(c.full_name,'') ILIKE '%'||p_search||'%'
                 OR coalesce(c.short_name,'') ILIKE '%'||p_search||'%'
                 OR coalesce(c.public_id,'') ILIKE '%'||p_search||'%'
                 OR coalesce(c.unp_normalized,'') ILIKE '%'||p_search||'%'
               )
           )
      ),
      visible_prof AS (
        SELECT * FROM prof
        WHERE coalesce(is_archived, false) = false
          AND status <> 'archived'
          AND merged_to_profile_id IS NULL
      ),
      duplicate_keys AS (
        SELECT kind, key FROM (
          SELECT 'email'::text AS kind, lower(trim(email)) AS key FROM visible_prof
          WHERE nullif(trim(coalesce(email, '')), '') IS NOT NULL
          UNION ALL
          SELECT 'phone'::text AS kind, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) AS key FROM visible_prof
          WHERE length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
        ) k WHERE key <> '' GROUP BY kind, key HAVING count(*) > 1
      ),
      duplicate_profile_ids AS (
        SELECT DISTINCT k.profile_id
        FROM (
          SELECT id AS profile_id, 'email'::text AS kind, lower(trim(email)) AS key FROM visible_prof
          WHERE nullif(trim(coalesce(email, '')), '') IS NOT NULL
          UNION ALL
          SELECT id AS profile_id, 'phone'::text AS kind, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) AS key FROM visible_prof
          WHERE length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
        ) k JOIN duplicate_keys dk ON dk.kind = k.kind AND dk.key = k.key
      ),
      paid_profiles AS (
        SELECT DISTINCT o.profile_id FROM public.orders_v2 o
        JOIN visible_prof p ON p.id = o.profile_id
        WHERE o.status = 'paid' AND o.profile_id IS NOT NULL
      )
      SELECT json_build_object(
        'all', (SELECT count(*) FROM visible_prof),
        'active', (SELECT count(*) FROM visible_prof WHERE user_id IS NOT NULL),
        'no_account', (SELECT count(*) FROM visible_prof WHERE user_id IS NULL),
        'duplicates', (SELECT count(*) FROM duplicate_profile_ids),
        'archived', (SELECT count(*) FROM prof WHERE status = 'archived' OR coalesce(is_archived, false) = true OR merged_to_profile_id IS NOT NULL),
        'with_deals', (SELECT count(*) FROM paid_profiles),
        'banned', (SELECT count(*) FROM visible_prof WHERE status = 'banned')
      )
  );
END;
$guard_body$;
$secured_3$;

    EXECUTE $secured_4$
CREATE OR REPLACE FUNCTION public.get_profiles_with_paid_orders_count(p_search text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $guard_body$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT coalesce(public.has_admin_section_access(v_actor, 'contacts', 'view'), false) THEN
    RAISE EXCEPTION 'Forbidden: contacts view required' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT count(*)::bigint FROM (
        SELECT DISTINCT o.profile_id
        FROM public.orders_v2 o JOIN public.profiles p ON p.id = o.profile_id
        WHERE o.status = 'paid' AND o.profile_id IS NOT NULL
          AND (
            p_search IS NULL OR coalesce(p.email,'') ILIKE '%'||p_search||'%'
            OR coalesce(p.full_name,'') ILIKE '%'||p_search||'%' OR coalesce(p.phone,'') ILIKE '%'||p_search||'%'
            OR EXISTS (
              SELECT 1 FROM public.company_contacts cc JOIN public.companies c ON c.id = cc.company_id
              WHERE cc.profile_id = p.id AND c.status <> 'merged'
                AND (coalesce(c.full_name,'') ILIKE '%'||p_search||'%' OR coalesce(c.short_name,'') ILIKE '%'||p_search||'%' OR coalesce(c.public_id,'') ILIKE '%'||p_search||'%' OR coalesce(c.unp_normalized,'') ILIKE '%'||p_search||'%')
            )
          )
      ) t
  );
END;
$guard_body$;
$secured_4$;

    FOR v_rule IN SELECT value FROM jsonb_array_elements(v_contract) LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_rule->>'signature');
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_rule->>'signature');
    END LOOP;
    -- Phase two rechecks complete definitions/ACLs, not a marker.
  END LOOP;
  RAISE EXCEPTION 'contact_rpc_guard_postcheck: expected secured state not reached'
    USING ERRCODE = '55000';
END;
$contact_guard_migration$;
