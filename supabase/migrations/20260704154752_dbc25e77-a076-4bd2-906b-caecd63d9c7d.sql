-- PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-CHANNELS P2
-- RPC для ручной привязки Instagram-контакта к profile.
-- Роли: admin / superadmin (public.has_role + app_role enum).
-- Никакой bridge-таблицы: используем канон instagram_contacts.profile_id.

CREATE OR REPLACE FUNCTION public.link_instagram_contact_to_profile(
  p_instagram_contact_id uuid,
  p_profile_id uuid,
  p_overwrite boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current_profile uuid;
  v_ig_username text;
  v_ig_account uuid;
  v_profile_exists boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'admin'::app_role)
    OR public.has_role(v_actor, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden: admin or superadmin required'
      USING ERRCODE = '42501';
  END IF;

  IF p_instagram_contact_id IS NULL OR p_profile_id IS NULL THEN
    RAISE EXCEPTION 'p_instagram_contact_id and p_profile_id required'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile_id, instagram_username, instagram_account_id
    INTO v_current_profile, v_ig_username, v_ig_account
  FROM public.instagram_contacts
  WHERE id = p_instagram_contact_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'instagram_contact not found: %', p_instagram_contact_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id)
    INTO v_profile_exists;
  IF NOT v_profile_exists THEN
    RAISE EXCEPTION 'profile not found: %', p_profile_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current_profile IS NOT NULL
     AND v_current_profile <> p_profile_id
     AND NOT p_overwrite THEN
    RAISE EXCEPTION 'instagram_contact already linked to another profile; pass p_overwrite=true to reassign'
      USING ERRCODE = '23505';
  END IF;

  -- Идемпотентно: если уже привязан к тому же профилю — no-op, но лог пишем.
  UPDATE public.instagram_contacts
     SET profile_id = p_profile_id,
         updated_at = now()
   WHERE id = p_instagram_contact_id;

  INSERT INTO public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id, meta
  ) VALUES (
    v_actor,
    'admin',
    'instagram_contact.link_to_profile',
    'instagram_contact',
    p_instagram_contact_id::text,
    jsonb_build_object(
      'profile_id', p_profile_id,
      'previous_profile_id', v_current_profile,
      'overwrite', p_overwrite,
      'instagram_username', v_ig_username,
      'instagram_account_id', v_ig_account
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'instagram_contact_id', p_instagram_contact_id,
    'profile_id', p_profile_id,
    'previous_profile_id', v_current_profile
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_instagram_contact_from_profile(
  p_instagram_contact_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current_profile uuid;
  v_ig_username text;
  v_ig_account uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'admin'::app_role)
    OR public.has_role(v_actor, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden: admin or superadmin required'
      USING ERRCODE = '42501';
  END IF;

  IF p_instagram_contact_id IS NULL THEN
    RAISE EXCEPTION 'p_instagram_contact_id required' USING ERRCODE = '22023';
  END IF;

  SELECT profile_id, instagram_username, instagram_account_id
    INTO v_current_profile, v_ig_username, v_ig_account
  FROM public.instagram_contacts
  WHERE id = p_instagram_contact_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'instagram_contact not found: %', p_instagram_contact_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.instagram_contacts
     SET profile_id = NULL,
         updated_at = now()
   WHERE id = p_instagram_contact_id;

  INSERT INTO public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id, meta
  ) VALUES (
    v_actor,
    'admin',
    'instagram_contact.unlink_from_profile',
    'instagram_contact',
    p_instagram_contact_id::text,
    jsonb_build_object(
      'previous_profile_id', v_current_profile,
      'instagram_username', v_ig_username,
      'instagram_account_id', v_ig_account
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'instagram_contact_id', p_instagram_contact_id,
    'previous_profile_id', v_current_profile
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_instagram_contact_to_profile(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_instagram_contact_from_profile(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.link_instagram_contact_to_profile(uuid, uuid, boolean) FROM anon, public;
REVOKE ALL ON FUNCTION public.unlink_instagram_contact_from_profile(uuid) FROM anon, public;