
CREATE OR REPLACE FUNCTION public.admin_create_contact(
  p_first_name text DEFAULT NULL, p_last_name text DEFAULT NULL, p_full_name text DEFAULT NULL,
  p_email text DEFAULT NULL, p_phone text DEFAULT NULL, p_telegram_username text DEFAULT NULL,
  p_city text DEFAULT NULL, p_country text DEFAULT NULL, p_position text DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_new_id uuid;
  v_full text;
  v_email_norm text;
  v_phone_norm text;
  v_tg_norm text;
  v_existing_id uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;

  v_is_admin :=
       public.has_role_v2(v_caller,'super_admin')
    OR public.has_role_v2(v_caller,'admin')
    OR public.has_role_v2(v_caller,'manager')
    OR public.has_role_v2(v_caller,'employee');

  IF NOT v_is_admin THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  v_email_norm := NULLIF(lower(trim(p_email)), '');
  v_phone_norm := NULLIF(regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'), '');
  v_tg_norm := NULLIF(regexp_replace(coalesce(p_telegram_username,''), '^@+', ''), '');
  v_full := NULLIF(trim(coalesce(p_full_name, trim(coalesce(p_first_name,'') || ' ' || coalesce(p_last_name,'')))), '');

  IF v_full IS NULL AND v_email_norm IS NULL AND v_phone_norm IS NULL AND v_tg_norm IS NULL THEN
    RAISE EXCEPTION 'empty_contact' USING ERRCODE='22023';
  END IF;

  IF v_email_norm IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.profiles WHERE lower(email) = v_email_norm LIMIT 1;
  END IF;
  IF v_existing_id IS NULL AND v_phone_norm IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.profiles WHERE regexp_replace(coalesce(phone,''),'[^0-9+]','','g') = v_phone_norm LIMIT 1;
  END IF;
  IF v_existing_id IS NULL AND v_tg_norm IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.profiles WHERE lower(telegram_username) = lower(v_tg_norm) LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_contact:%', v_existing_id USING ERRCODE='23505';
  END IF;

  INSERT INTO public.profiles (
    id, user_id, email, full_name, first_name, last_name, phone,
    telegram_username, city, country, "position", status, source, meta
  ) VALUES (
    gen_random_uuid(), NULL, v_email_norm, v_full,
    NULLIF(trim(p_first_name),''), NULLIF(trim(p_last_name),''),
    v_phone_norm, v_tg_norm,
    NULLIF(trim(p_city),''), NULLIF(trim(p_country),''),
    NULLIF(trim(p_position),''),
    'active', 'admin_manual',
    jsonb_build_object('created_by_admin', v_caller, 'notes', NULLIF(trim(p_notes),''))
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.audit_logs (action, actor_user_id, meta)
  VALUES ('admin_create_contact', v_caller,
          jsonb_build_object('profile_id', v_new_id, 'email', v_email_norm, 'phone', v_phone_norm));

  RETURN v_new_id;
END;
$function$;

-- admin_create_deal: patch role check only, keep body intact
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='admin_create_deal';
  -- Replace role check block
  v_def := replace(v_def,
    'SELECT EXISTS(
    SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
    WHERE ur.user_id=v_caller AND r.code IN (''super_admin'',''admin'',''manager'',''employee'')
  ) INTO v_is_admin;',
    'v_is_admin := public.has_role_v2(v_caller,''super_admin'') OR public.has_role_v2(v_caller,''admin'') OR public.has_role_v2(v_caller,''manager'') OR public.has_role_v2(v_caller,''employee'');');
  EXECUTE v_def;
END $$;

REVOKE ALL ON FUNCTION public.admin_create_contact(text,text,text,text,text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_contact(text,text,text,text,text,text,text,text,text,text) TO authenticated;
