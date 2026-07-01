
CREATE OR REPLACE FUNCTION public.admin_create_deal(
  p_profile_id uuid,
  p_title text DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_tariff_id uuid DEFAULT NULL,
  p_pipeline_id uuid DEFAULT NULL,
  p_pipeline_stage_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT 0,
  p_currency text DEFAULT 'BYN',
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT EXISTS(
    SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
    WHERE ur.user_id=v_caller AND r.code IN ('super_admin','admin','manager','employee')
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT id, user_id, email, phone, full_name INTO v_profile
  FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE='22023';
  END IF;

  -- Default pipeline: "Основная" or first
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
    v_amount, v_amount, v_currency, 'draft', false,
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
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_deal(uuid,text,uuid,uuid,uuid,uuid,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_deal(uuid,text,uuid,uuid,uuid,uuid,numeric,text,text) TO authenticated;
