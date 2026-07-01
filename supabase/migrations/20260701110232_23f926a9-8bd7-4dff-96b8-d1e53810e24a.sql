
-- 1) admin_create_deal: use 'pending' instead of 'draft' so deals appear in main list
CREATE OR REPLACE FUNCTION public.admin_create_deal(
  p_profile_id uuid,
  p_title text DEFAULT NULL::text,
  p_product_id uuid DEFAULT NULL::uuid,
  p_tariff_id uuid DEFAULT NULL::uuid,
  p_pipeline_id uuid DEFAULT NULL::uuid,
  p_pipeline_stage_id uuid DEFAULT NULL::uuid,
  p_amount numeric DEFAULT 0,
  p_currency text DEFAULT 'BYN'::text,
  p_notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_profile RECORD;
  v_pipeline_id uuid := p_pipeline_id;
  v_stage_id uuid := p_pipeline_stage_id;
  v_order_id uuid;
  v_order_number text;
  v_amount numeric := COALESCE(p_amount, 0);
  v_currency text := COALESCE(NULLIF(trim(p_currency),''),'BYN');
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;

  v_is_admin := public.has_role_v2(v_caller,'super_admin')
             OR public.has_role_v2(v_caller,'admin')
             OR public.has_role_v2(v_caller,'manager')
             OR public.has_role_v2(v_caller,'employee');
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT id, user_id, email, phone, full_name INTO v_profile
  FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE='22023';
  END IF;

  IF v_pipeline_id IS NULL THEN
    SELECT id INTO v_pipeline_id FROM public.crm_pipelines
    ORDER BY (name='Основная') DESC, name LIMIT 1;
  END IF;

  IF v_stage_id IS NULL AND v_pipeline_id IS NOT NULL THEN
    SELECT id INTO v_stage_id FROM public.crm_pipeline_stages
    WHERE pipeline_id = v_pipeline_id
    ORDER BY is_default DESC NULLS LAST, order_index ASC NULLS LAST LIMIT 1;
  END IF;

  v_order_number := 'M-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  INSERT INTO public.orders_v2 (
    id, order_number, user_id, profile_id, product_id, tariff_id,
    base_price, final_price, currency, status, is_trial,
    customer_email, customer_phone, pipeline_id, pipeline_stage_id,
    deal_date, meta
  ) VALUES (
    gen_random_uuid(), v_order_number, v_profile.user_id, v_profile.id,
    p_product_id, p_tariff_id,
    v_amount, v_amount, v_currency, 'pending', false,
    v_profile.email, v_profile.phone, v_pipeline_id, v_stage_id,
    now(),
    jsonb_build_object(
      'source','admin_manual',
      'created_by_admin', v_caller,
      'title', NULLIF(trim(p_title),''),
      'notes', NULLIF(trim(p_notes),'')
    )
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.audit_logs (action, actor_user_id, meta)
  VALUES ('admin_create_deal', v_caller,
          jsonb_build_object('order_id', v_order_id, 'profile_id', v_profile.id,
                             'product_id', p_product_id, 'amount', v_amount));

  RETURN v_order_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_create_deal(uuid,text,uuid,uuid,uuid,uuid,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_deal(uuid,text,uuid,uuid,uuid,uuid,numeric,text,text) TO authenticated, service_role;

-- 2) Duplicate lookup for CreateContactDialog (inline dup detection)
CREATE OR REPLACE FUNCTION public.admin_lookup_contact_duplicate(
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_telegram_username text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_email_norm text;
  v_phone_norm text;
  v_tg_norm text;
  v_row RECORD;
  v_field text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;

  v_is_admin := public.has_role_v2(v_caller,'super_admin')
             OR public.has_role_v2(v_caller,'admin')
             OR public.has_role_v2(v_caller,'manager')
             OR public.has_role_v2(v_caller,'employee');
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  v_email_norm := NULLIF(lower(trim(p_email)), '');
  v_phone_norm := NULLIF(regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'), '');
  v_tg_norm := NULLIF(lower(regexp_replace(coalesce(p_telegram_username,''), '^@+', '')), '');

  IF v_email_norm IS NOT NULL THEN
    SELECT id, full_name, email, phone, telegram_username INTO v_row
    FROM public.profiles WHERE lower(email) = v_email_norm LIMIT 1;
    IF FOUND THEN v_field := 'email'; END IF;
  END IF;

  IF v_row IS NULL AND v_phone_norm IS NOT NULL THEN
    SELECT id, full_name, email, phone, telegram_username INTO v_row
    FROM public.profiles
    WHERE regexp_replace(coalesce(phone,''),'[^0-9+]','','g') = v_phone_norm LIMIT 1;
    IF FOUND THEN v_field := 'phone'; END IF;
  END IF;

  IF v_row IS NULL AND v_tg_norm IS NOT NULL THEN
    SELECT id, full_name, email, phone, telegram_username INTO v_row
    FROM public.profiles WHERE lower(telegram_username) = v_tg_norm LIMIT 1;
    IF FOUND THEN v_field := 'telegram'; END IF;
  END IF;

  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'full_name', v_row.full_name,
    'email', v_row.email,
    'phone', v_row.phone,
    'telegram_username', v_row.telegram_username,
    'matched_field', v_field
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_lookup_contact_duplicate(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_lookup_contact_duplicate(text,text,text) TO authenticated, service_role;
