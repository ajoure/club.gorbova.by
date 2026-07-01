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

  -- Get current policy version
  SELECT (value->>'version')::TEXT INTO _current_policy_version
  FROM public.app_settings WHERE key = 'privacy_policy' LIMIT 1;

  -- Try to find an existing legacy profile by normalized email.
  -- Historically this only linked archived/imported profiles. Some legacy imports
  -- already have status=active but still have user_id IS NULL, so those must be
  -- claimed as the canonical profile instead of creating duplicates.
  SELECT count(*) INTO _legacy_candidates
  FROM public.profiles
  WHERE lower(trim(coalesce(email, ''))) = _email_norm
    AND user_id IS NULL
    AND status IN ('archived', 'imported', 'active', 'blocked');

  SELECT * INTO _legacy_profile
  FROM public.profiles
  WHERE lower(trim(coalesce(email, ''))) = _email_norm
    AND user_id IS NULL
    AND status IN ('archived', 'imported', 'active', 'blocked')
  ORDER BY
    CASE status
      WHEN 'active' THEN 0
      WHEN 'imported' THEN 1
      WHEN 'archived' THEN 2
      WHEN 'blocked' THEN 3
      ELSE 9
    END,
    created_at DESC,
    id DESC
  LIMIT 1;

  IF _legacy_profile.id IS NOT NULL THEN
    _new_status := CASE
      WHEN _legacy_profile.status IN ('archived', 'imported') THEN 'active'
      ELSE _legacy_profile.status
    END;

    -- Claim the legacy profile. Do not create a second source-of-truth profile.
    UPDATE public.profiles
    SET user_id = NEW.id,
        status = _new_status,
        updated_at = now()
    WHERE id = _legacy_profile.id;
    _new_profile_id := _legacy_profile.id;

    -- Reassign orders_v2
    UPDATE public.orders_v2
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _legacy_profile.id AND user_id IS NULL;

    -- Reassign subscriptions_v2
    UPDATE public.subscriptions_v2
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _legacy_profile.id AND user_id IS NULL;

    -- Reassign entitlements
    UPDATE public.entitlements
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _legacy_profile.id AND user_id IS NULL;

    -- ========== v23.1.11: Generic entitlement sync for all active subscriptions ==========
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
        -- Exclude order-based only products (cb20)
        AND p2.code <> 'cb20'
        -- Exclude legacy mismatch codes
        AND p2.code <> 'cb_2_step'
    LOOP
      -- Upsert entitlement: ON CONFLICT never decrease expires_at (NULL-safe)
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
          'source_patch', 'v23.1.11',
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
    -- ========== END v23.1.11 ==========

    INSERT INTO public.audit_logs (actor_type, actor_user_id, actor_label, action, target_user_id, meta)
    VALUES ('system', NULL, 'handle_new_user', 'archived_profile_linked', NEW.id,
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
              'source_patch', 'v23.1.11'
            ));

    BEGIN
      INSERT INTO public.consent_logs (user_id, email, consent_type, policy_version, granted, source)
      VALUES (NEW.id, NEW.email, 'marketing', COALESCE(_current_policy_version, 'unknown'), true, 'registration_legacy_link');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

  ELSE
    -- Create a brand-new profile
    INSERT INTO public.profiles (user_id, email, full_name, status, created_at, updated_at)
    VALUES (NEW.id, NEW.email,
            COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
            'active', now(), now())
    RETURNING id INTO _new_profile_id;

    INSERT INTO public.audit_logs (actor_type, actor_user_id, actor_label, action, target_user_id, meta)
    VALUES ('system', NULL, 'handle_new_user', 'new_profile_created', NEW.id,
            jsonb_build_object('profile_id', _new_profile_id, 'source_patch', 'v23.1.11'));

    BEGIN
      INSERT INTO public.consent_logs (user_id, email, consent_type, policy_version, granted, source)
      VALUES (NEW.id, NEW.email, 'marketing', COALESCE(_current_policy_version, 'unknown'), true, 'registration_new');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;