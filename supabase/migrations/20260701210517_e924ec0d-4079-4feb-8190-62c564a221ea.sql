CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _legacy_profile RECORD;
  _legacy_candidates INT := 0;
  _current_policy_version TEXT;
  _new_profile_id UUID;
  _ent_count INT := 0;
  _ent_product_codes TEXT[] := '{}';
  _sub RECORD;
  _email_norm TEXT;
  _new_status TEXT;
BEGIN
  _email_norm := lower(trim(coalesce(NEW.email, '')));

  SELECT (value->>'version')::TEXT INTO _current_policy_version
  FROM public.app_settings WHERE key = 'privacy_policy' LIMIT 1;

  SELECT count(*) INTO _legacy_candidates
  FROM public.profiles
  WHERE lower(trim(coalesce(email, ''))) = _email_norm
    AND user_id IS NULL
    AND coalesce(status, '') IN ('archived', 'imported', 'active', 'blocked');

  SELECT * INTO _legacy_profile
  FROM public.profiles
  WHERE lower(trim(coalesce(email, ''))) = _email_norm
    AND user_id IS NULL
    AND coalesce(status, '') IN ('archived', 'imported', 'active', 'blocked')
  ORDER BY
    CASE coalesce(status, '')
      WHEN 'active' THEN 0
      WHEN 'imported' THEN 1
      WHEN 'archived' THEN 2
      WHEN 'blocked' THEN 3
      ELSE 9
    END,
    coalesce(updated_at, created_at) DESC,
    id DESC
  LIMIT 1;

  IF _legacy_profile.id IS NOT NULL THEN
    _new_status := CASE
      WHEN _legacy_profile.status IN ('archived', 'imported') THEN 'active'
      ELSE _legacy_profile.status
    END;

    UPDATE public.profiles
    SET user_id = NEW.id,
        status = _new_status,
        is_archived = false,
        first_name = COALESCE(NULLIF(first_name, ''), NULLIF(NEW.raw_user_meta_data->>'first_name', '')),
        last_name = COALESCE(NULLIF(last_name, ''), NULLIF(NEW.raw_user_meta_data->>'last_name', '')),
        full_name = COALESCE(NULLIF(full_name, ''), NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'name', ''), full_name),
        phone = COALESCE(NULLIF(phone, ''), NULLIF(NEW.raw_user_meta_data->>'phone', '')),
        updated_at = now()
    WHERE id = _legacy_profile.id;
    _new_profile_id := _legacy_profile.id;

    UPDATE public.orders_v2
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _legacy_profile.id AND user_id IS NULL;

    UPDATE public.subscriptions_v2
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _legacy_profile.id AND user_id IS NULL;

    UPDATE public.entitlements
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _legacy_profile.id AND user_id IS NULL;

    FOR _sub IN
      SELECT
        s.id AS sub_id,
        s.access_end_at,
        s.product_id,
        p2.code AS product_code
      FROM public.subscriptions_v2 s
      LEFT JOIN public.products_v2 p2 ON p2.id = s.product_id
      WHERE s.user_id = NEW.id
        AND s.status IN ('active', 'trial')
        AND p2.code IS NOT NULL
        AND p2.code <> ''
        AND p2.code <> 'cb20'
        AND p2.code <> 'cb_2_step'
    LOOP
      INSERT INTO public.entitlements (user_id, profile_id, product_id, product_code, status, expires_at, meta)
      VALUES (
        NEW.id,
        _legacy_profile.id,
        _sub.product_id,
        _sub.product_code,
        'active',
        _sub.access_end_at,
        jsonb_build_object(
          'source', 'profile_claim',
          'source_patch', 'legacy_auth_claiming_v2',
          'actor_label', 'handle_new_user',
          'subscription_id', _sub.sub_id,
          'synced_at', now()::text
        )
      )
      ON CONFLICT (user_id, product_code) DO UPDATE SET
        status = 'active',
        expires_at = COALESCE(
          GREATEST(entitlements.expires_at, EXCLUDED.expires_at),
          entitlements.expires_at,
          EXCLUDED.expires_at
        ),
        product_id = COALESCE(EXCLUDED.product_id, entitlements.product_id),
        profile_id = COALESCE(EXCLUDED.profile_id, entitlements.profile_id),
        meta = entitlements.meta || EXCLUDED.meta,
        updated_at = now();

      _ent_count := _ent_count + 1;
      _ent_product_codes := _ent_product_codes || _sub.product_code;
    END LOOP;

    INSERT INTO public.audit_logs (actor_type, actor_user_id, actor_label, action, target_user_id, meta)
    VALUES ('system', NULL, 'handle_new_user', 'legacy_profile_linked', NEW.id,
            jsonb_build_object(
              'legacy_profile_id', _legacy_profile.id,
              'legacy_profile_status_before', _legacy_profile.status,
              'legacy_profile_status_after', _new_status,
              'legacy_profile_source', _legacy_profile.source,
              'legacy_candidates', _legacy_candidates,
              'was_club_member', _legacy_profile.was_club_member,
              'linked_at', now(),
              'entitlements_synced', _ent_count,
              'entitlement_product_codes', to_jsonb(_ent_product_codes),
              'source_patch', 'legacy_auth_claiming_v2'
            ));

    BEGIN
      INSERT INTO public.consent_logs (user_id, email, consent_type, policy_version, granted, source)
      VALUES (NEW.id, NEW.email, 'marketing', COALESCE(_current_policy_version, 'unknown'), true, 'registration_legacy_link');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

  ELSE
    INSERT INTO public.profiles (user_id, email, full_name, first_name, last_name, phone, status, created_at, updated_at)
    VALUES (NEW.id, NEW.email,
            COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
            COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
            COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
            COALESCE(NEW.raw_user_meta_data->>'phone', ''),
            'active', now(), now())
    RETURNING id INTO _new_profile_id;

    INSERT INTO public.audit_logs (actor_type, actor_user_id, actor_label, action, target_user_id, meta)
    VALUES ('system', NULL, 'handle_new_user', 'new_profile_created', NEW.id,
            jsonb_build_object('profile_id', _new_profile_id, 'source_patch', 'legacy_auth_claiming_v2'));

    BEGIN
      INSERT INTO public.consent_logs (user_id, email, consent_type, policy_version, granted, source)
      VALUES (NEW.id, NEW.email, 'marketing', COALESCE(_current_policy_version, 'unknown'), true, 'registration_new');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;