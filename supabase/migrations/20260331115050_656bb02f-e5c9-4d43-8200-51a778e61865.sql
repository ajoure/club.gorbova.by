
-- v23.1.10 fix: GREATEST NULL safety in handle_new_user trigger
-- GREATEST(x, NULL) returns NULL in PostgreSQL, which can wipe valid expires_at
-- Fix: wrap with COALESCE to preserve existing value when one side is NULL

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  _archived_profile RECORD;
  _current_policy_version TEXT;
  _new_profile_id UUID;
  _ent_count INT := 0;
  _ent_product_codes TEXT[] := '{}';
  _sub RECORD;
BEGIN
  -- Get current policy version
  SELECT (value->>'version')::TEXT INTO _current_policy_version
  FROM public.app_settings WHERE key = 'privacy_policy' LIMIT 1;

  -- Try to find an existing archived/imported profile by email
  SELECT * INTO _archived_profile
  FROM public.profiles
  WHERE email = NEW.email
    AND user_id IS NULL
    AND status IN ('archived', 'imported')
  ORDER BY created_at DESC
  LIMIT 1;

  IF _archived_profile.id IS NOT NULL THEN
    -- Claim the archived profile
    UPDATE public.profiles
    SET user_id = NEW.id,
        status = 'active',
        updated_at = now()
    WHERE id = _archived_profile.id;
    _new_profile_id := _archived_profile.id;

    -- Reassign orders_v2
    UPDATE public.orders_v2
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _archived_profile.id AND user_id IS NULL;

    -- Reassign subscriptions_v2
    UPDATE public.subscriptions_v2
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _archived_profile.id AND user_id IS NULL;

    -- Reassign entitlements
    UPDATE public.entitlements
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _archived_profile.id AND user_id IS NULL;

    -- ========== v23.1.9D: Generic entitlement sync for all active subscriptions ==========
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
        _archived_profile.id,
        _sub.product_id,
        _sub.product_code,
        'active',
        _sub.access_end_at,
        jsonb_build_object(
          'source', 'profile_claim',
          'source_patch', 'v23.1.10',
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
    -- ========== END v23.1.9D ==========

    INSERT INTO public.audit_logs (actor_type, actor_user_id, actor_label, action, target_user_id, meta)
    VALUES ('system', NULL, 'handle_new_user', 'archived_profile_linked', NEW.id,
            jsonb_build_object(
              'archived_profile_id', _archived_profile.id,
              'was_club_member', _archived_profile.was_club_member,
              'linked_at', now(),
              'entitlements_synced', _ent_count,
              'entitlement_product_codes', to_jsonb(_ent_product_codes),
              'source_patch', 'v23.1.10'
            ));

    BEGIN
      INSERT INTO public.consent_logs (user_id, email, consent_type, policy_version, granted, source)
      VALUES (NEW.id, NEW.email, 'marketing', COALESCE(_current_policy_version, 'unknown'), true, 'registration_archived_link');
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
            jsonb_build_object('profile_id', _new_profile_id, 'source_patch', 'v23.1.10'));

    BEGIN
      INSERT INTO public.consent_logs (user_id, email, consent_type, policy_version, granted, source)
      VALUES (NEW.id, NEW.email, 'marketing', COALESCE(_current_policy_version, 'unknown'), true, 'registration_new');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;
