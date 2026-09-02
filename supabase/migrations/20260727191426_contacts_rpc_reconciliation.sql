-- Reconcile the Contacts UI with the managed schema without adding tables or
-- columns. These RPC names are already consumed by the client; the managed
-- database is missing them. Every public SECURITY DEFINER entrypoint checks
-- the current RBAC model and revokes PUBLIC/anon execution explicitly.

CREATE OR REPLACE FUNCTION public.admin_create_contact(
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_full_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_telegram_username text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_new_id uuid;
  v_full_name text;
  v_email_normalized text;
  v_phone_normalized text;
  v_telegram_normalized text;
  v_existing_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    coalesce(public.has_role(v_caller, 'super_admin'), false)
    OR coalesce(public.has_role(v_caller, 'admin'), false)
    OR coalesce(public.has_permission(v_caller, 'contacts.edit'), false)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_email_normalized := NULLIF(lower(trim(p_email)), '');
  v_phone_normalized := NULLIF(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_telegram_normalized := NULLIF(lower(regexp_replace(trim(coalesce(p_telegram_username, '')), '^@+', '')), '');
  v_full_name := NULLIF(
    trim(coalesce(p_full_name, trim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, '')))),
    ''
  );

  IF v_full_name IS NULL
     AND v_email_normalized IS NULL
     AND v_phone_normalized IS NULL
     AND v_telegram_normalized IS NULL THEN
    RAISE EXCEPTION 'empty_contact' USING ERRCODE = '22023';
  END IF;

  -- The managed schema has no normalized-contact columns or uniqueness
  -- constraints. Transaction-scoped advisory locks make the subsequent
  -- lookup-and-insert sequence race-safe for every populated identity key.
  IF v_email_normalized IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('contact-email:' || v_email_normalized));
  END IF;
  IF v_phone_normalized IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('contact-phone:' || v_phone_normalized));
  END IF;
  IF v_telegram_normalized IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('contact-telegram:' || v_telegram_normalized));
  END IF;

  SELECT p.id
    INTO v_existing_id
    FROM public.profiles p
   WHERE (v_email_normalized IS NOT NULL AND lower(p.email) = v_email_normalized)
      OR (v_phone_normalized IS NOT NULL
          AND regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') = v_phone_normalized)
      OR (v_telegram_normalized IS NOT NULL
          AND lower(regexp_replace(coalesce(p.telegram_username, ''), '^@+', '')) = v_telegram_normalized)
   ORDER BY p.created_at ASC, p.id ASC
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_contact:%', v_existing_id USING ERRCODE = '23505';
  END IF;

  -- p_city, p_country and p_notes are intentionally not persisted: those
  -- columns do not exist in the managed profiles schema. Keeping the RPC
  -- signature preserves the existing form while avoiding a schema fork.
  INSERT INTO public.profiles (
    id,
    user_id,
    email,
    full_name,
    first_name,
    last_name,
    phone,
    telegram_username,
    "position",
    status,
    source
  ) VALUES (
    gen_random_uuid(),
    NULL,
    v_email_normalized,
    v_full_name,
    NULLIF(trim(p_first_name), ''),
    NULLIF(trim(p_last_name), ''),
    v_phone_normalized,
    v_telegram_normalized,
    NULLIF(trim(p_position), ''),
    'active',
    'admin_manual'
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.audit_logs (action, actor_user_id, meta)
  VALUES (
    'admin_create_contact',
    v_caller,
    jsonb_build_object('profile_id', v_new_id)
  );

  RETURN v_new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_contact(text, text, text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_contact(text, text, text, text, text, text, text, text, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_lookup_contact_duplicate(
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_telegram_username text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_email_normalized text := NULLIF(lower(trim(p_email)), '');
  v_phone_normalized text := NULLIF(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_telegram_normalized text := NULLIF(lower(regexp_replace(trim(coalesce(p_telegram_username, '')), '^@+', '')), '');
  v_row record;
  v_matched_field text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    coalesce(public.has_role(v_caller, 'super_admin'), false)
    OR coalesce(public.has_role(v_caller, 'admin'), false)
    OR coalesce(public.has_permission(v_caller, 'contacts.edit'), false)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.full_name, p.email, p.phone, p.telegram_username,
         CASE
           WHEN v_email_normalized IS NOT NULL AND lower(p.email) = v_email_normalized THEN 'email'
           WHEN v_phone_normalized IS NOT NULL
             AND regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') = v_phone_normalized THEN 'phone'
           ELSE 'telegram'
         END AS matched_field
    INTO v_row
    FROM public.profiles p
   WHERE (v_email_normalized IS NOT NULL AND lower(p.email) = v_email_normalized)
      OR (v_phone_normalized IS NOT NULL
          AND regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') = v_phone_normalized)
      OR (v_telegram_normalized IS NOT NULL
          AND lower(regexp_replace(coalesce(p.telegram_username, ''), '^@+', '')) = v_telegram_normalized)
   ORDER BY p.created_at ASC, p.id ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_matched_field := v_row.matched_field;
  RETURN jsonb_build_object(
    'id', v_row.id,
    'full_name', v_row.full_name,
    'email', v_row.email,
    'phone', v_row.phone,
    'telegram_username', v_row.telegram_username,
    'matched_field', v_matched_field
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_lookup_contact_duplicate(text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_lookup_contact_duplicate(text, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_contact_tab_counts(p_search text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_result json;
BEGIN
  IF v_caller IS NULL OR NOT (
    coalesce(public.has_role(v_caller, 'super_admin'), false)
    OR coalesce(public.has_role(v_caller, 'admin'), false)
    OR coalesce(public.has_permission(v_caller, 'contacts.view'), false)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH prof AS (
    SELECT p.*
      FROM public.profiles p
     WHERE p_search IS NULL
        OR coalesce(p.email, '') ILIKE '%' || p_search || '%'
        OR coalesce(p.full_name, '') ILIKE '%' || p_search || '%'
        OR coalesce(p.phone, '') ILIKE '%' || p_search || '%'
  ),
  visible_prof AS (
    SELECT *
      FROM prof
     WHERE coalesce(is_archived, false) = false
       AND status <> 'archived'
       AND merged_to_profile_id IS NULL
  ),
  duplicate_keys AS (
    SELECT kind, value
      FROM (
        SELECT 'email'::text AS kind, lower(trim(email)) AS value
          FROM visible_prof
         WHERE nullif(trim(coalesce(email, '')), '') IS NOT NULL
        UNION ALL
        SELECT 'phone'::text, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9)
          FROM visible_prof
         WHERE length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
      ) keys
     WHERE value <> ''
     GROUP BY kind, value
    HAVING count(*) > 1
  ),
  duplicate_profile_ids AS (
    SELECT DISTINCT keys.profile_id
      FROM (
        SELECT id AS profile_id, 'email'::text AS kind, lower(trim(email)) AS value
          FROM visible_prof
         WHERE nullif(trim(coalesce(email, '')), '') IS NOT NULL
        UNION ALL
        SELECT id, 'phone'::text, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9)
          FROM visible_prof
         WHERE length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
      ) keys
      JOIN duplicate_keys ON duplicate_keys.kind = keys.kind
                         AND duplicate_keys.value = keys.value
  ),
  paid_profiles AS (
    SELECT DISTINCT o.profile_id
      FROM public.orders_v2 o
      JOIN visible_prof p ON p.id = o.profile_id
     WHERE o.status = 'paid'
       AND o.profile_id IS NOT NULL
  )
  SELECT json_build_object(
    'all', (SELECT count(*) FROM visible_prof),
    'active', (SELECT count(*) FROM visible_prof WHERE user_id IS NOT NULL),
    'no_account', (SELECT count(*) FROM visible_prof WHERE user_id IS NULL),
    'duplicates', (SELECT count(*) FROM duplicate_profile_ids),
    'archived', (SELECT count(*) FROM prof WHERE status = 'archived' OR coalesce(is_archived, false) = true OR merged_to_profile_id IS NOT NULL),
    'with_deals', (SELECT count(*) FROM paid_profiles),
    'banned', (SELECT count(*) FROM visible_prof WHERE status = 'banned')
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_contact_tab_counts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_tab_counts(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_duplicate_contact_profiles(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR NOT (
    coalesce(public.has_role(v_caller, 'super_admin'), false)
    OR coalesce(public.has_role(v_caller, 'admin'), false)
    OR coalesce(public.has_permission(v_caller, 'contacts.view'), false)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH visible_prof AS (
    SELECT p.*
      FROM public.profiles p
     WHERE coalesce(p.is_archived, false) = false
       AND p.status <> 'archived'
       AND p.merged_to_profile_id IS NULL
       AND (
         p_search IS NULL
         OR coalesce(p.email, '') ILIKE '%' || p_search || '%'
         OR coalesce(p.full_name, '') ILIKE '%' || p_search || '%'
         OR coalesce(p.phone, '') ILIKE '%' || p_search || '%'
       )
  ),
  identity_keys AS (
    SELECT id AS profile_id, 'email'::text AS kind, lower(trim(email)) AS value
      FROM visible_prof
     WHERE nullif(trim(coalesce(email, '')), '') IS NOT NULL
    UNION ALL
    SELECT id, 'phone'::text, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9)
      FROM visible_prof
     WHERE length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
  ),
  duplicate_keys AS (
    SELECT kind, value
      FROM identity_keys
     WHERE value <> ''
     GROUP BY kind, value
    HAVING count(*) > 1
  )
  SELECT p.*
    FROM visible_prof p
    JOIN (
      SELECT DISTINCT identity_keys.profile_id
        FROM identity_keys
        JOIN duplicate_keys USING (kind, value)
    ) duplicates ON duplicates.profile_id = p.id
   ORDER BY p.created_at DESC, p.id DESC
   LIMIT least(greatest(coalesce(p_limit, 100), 0), 500)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_duplicate_contact_profiles(integer, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_duplicate_contact_profiles(integer, integer, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_profiles_with_paid_orders(
  p_limit integer,
  p_offset integer,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  profile_id uuid,
  user_id uuid,
  email text,
  full_name text,
  first_name text,
  last_name text,
  phone text,
  telegram_username text,
  telegram_user_id bigint,
  status text,
  is_archived boolean,
  created_at timestamptz,
  duplicate_flag text,
  avatar_url text,
  last_seen_at timestamptz,
  loyalty_score numeric,
  loyalty_ai_summary text,
  loyalty_status_reason text,
  loyalty_proofs jsonb,
  loyalty_analyzed_messages_count integer,
  loyalty_updated_at timestamptz,
  communication_style jsonb,
  last_paid_at timestamptz,
  paid_orders_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR NOT (
    coalesce(public.has_role(v_caller, 'super_admin'), false)
    OR coalesce(public.has_role(v_caller, 'admin'), false)
    OR coalesce(public.has_permission(v_caller, 'contacts.view'), false)
    OR coalesce(public.has_permission(v_caller, 'deals.view'), false)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH paid AS (
    SELECT o.profile_id, max(o.created_at) AS last_paid_at, count(*)::integer AS paid_orders_count
      FROM public.orders_v2 o
     WHERE o.status = 'paid'
       AND o.profile_id IS NOT NULL
     GROUP BY o.profile_id
  )
  SELECT p.id, p.user_id, p.email, p.full_name, p.first_name, p.last_name,
         p.phone, p.telegram_username, p.telegram_user_id, p.status,
         p.is_archived, p.created_at, p.duplicate_flag, p.avatar_url,
         p.last_seen_at, p.loyalty_score::numeric, p.loyalty_ai_summary,
         p.loyalty_status_reason, p.loyalty_proofs,
         p.loyalty_analyzed_messages_count, p.loyalty_updated_at,
         p.communication_style, paid.last_paid_at, paid.paid_orders_count
    FROM paid
    JOIN public.profiles p ON p.id = paid.profile_id
   WHERE p_search IS NULL
      OR coalesce(p.email, '') ILIKE '%' || p_search || '%'
      OR coalesce(p.full_name, '') ILIKE '%' || p_search || '%'
      OR coalesce(p.phone, '') ILIKE '%' || p_search || '%'
   ORDER BY paid.last_paid_at DESC, p.id DESC
   LIMIT least(greatest(coalesce(p_limit, 100), 0), 500)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_profiles_with_paid_orders(integer, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profiles_with_paid_orders(integer, integer, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.search_global(
  p_query text,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_can_view_contacts boolean;
  v_can_view_deals boolean;
  v_contacts jsonb := '[]'::jsonb;
  v_deals jsonb := '[]'::jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := nullif(trim(p_query), '');
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  v_can_view_contacts := coalesce(public.has_role(v_caller, 'super_admin'), false)
    OR coalesce(public.has_role(v_caller, 'admin'), false)
    OR coalesce(public.has_permission(v_caller, 'contacts.view'), false);
  v_can_view_deals := coalesce(public.has_role(v_caller, 'super_admin'), false)
    OR coalesce(public.has_role(v_caller, 'admin'), false)
    OR coalesce(public.has_permission(v_caller, 'deals.view'), false);

  IF NOT v_can_view_contacts AND NOT v_can_view_deals THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_query IS NULL THEN
    RETURN jsonb_build_object('contacts', v_contacts, 'deals', v_deals, 'messages', '[]'::jsonb, 'companies', '[]'::jsonb);
  END IF;

  IF v_can_view_contacts THEN
    SELECT coalesce(jsonb_agg(row_to_json(contact_row)), '[]'::jsonb)
      INTO v_contacts
      FROM (
        SELECT p.id AS profile_id, p.full_name, p.email, p.phone,
               p.telegram_username, p.status
          FROM public.profiles p
         WHERE coalesce(p.full_name, '') ILIKE '%' || v_query || '%'
            OR coalesce(p.email, '') ILIKE '%' || v_query || '%'
            OR coalesce(p.phone, '') ILIKE '%' || v_query || '%'
            OR coalesce(p.telegram_username, '') ILIKE '%' || v_query || '%'
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT v_limit OFFSET v_offset
      ) contact_row;
  END IF;

  IF v_can_view_deals THEN
    SELECT coalesce(jsonb_agg(row_to_json(deal_row)), '[]'::jsonb)
      INTO v_deals
      FROM (
        SELECT o.id AS order_id, o.order_number, o.status::text, o.profile_id,
               o.customer_email, p.full_name AS contact_name
          FROM public.orders_v2 o
          LEFT JOIN public.profiles p ON p.id = o.profile_id
         WHERE coalesce(o.order_number, '') ILIKE '%' || v_query || '%'
            OR coalesce(o.customer_email, '') ILIKE '%' || v_query || '%'
            OR coalesce(o.customer_phone, '') ILIKE '%' || v_query || '%'
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT v_limit OFFSET v_offset
      ) deal_row;
  END IF;

  -- The managed schema has no message or company relations. Preserve the
  -- client response contract without fabricating data or adding new entities.
  RETURN jsonb_build_object(
    'contacts', v_contacts,
    'deals', v_deals,
    'messages', '[]'::jsonb,
    'companies', '[]'::jsonb
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.search_global(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_global(text, integer, integer) TO authenticated, service_role;
