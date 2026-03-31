-- PATCH v23.1.9D: Generic entitlement sync in handle_new_user
-- Replaces hardcoded club-only entitlement creation with generic loop
-- over ALL active subscriptions for the claimed profile.
-- CB20 order-based deferred is NOT handled here (separate worker).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_role_id uuid;
  _current_policy_version text;
  _archived_profile record;
  _email text;
  _ban_case_id uuid;
  _sub record;
  _ent_count int := 0;
  _ent_product_codes text[] := '{}';
BEGIN
  _email := lower(trim(NEW.email));

  -- ========== BAN CHECK (before anything else) ==========
  SELECT bc.ban_case_id INTO _ban_case_id
  FROM public.check_ban_by_identifiers(_email := _email) bc
  LIMIT 1;

  IF _ban_case_id IS NOT NULL THEN
    -- Check if profile already exists (archived/imported)
    PERFORM 1 FROM public.profiles WHERE user_id = NEW.id;
    IF FOUND THEN
      UPDATE public.profiles SET status = 'banned', updated_at = now() WHERE user_id = NEW.id;
    ELSE
      -- Check for archived/imported profile by email
      UPDATE public.profiles
      SET user_id = NEW.id, status = 'banned', is_archived = false, updated_at = now()
      WHERE status IN ('archived', 'imported')
        AND user_id IS NULL
        AND lower(trim(email)) = _email
        AND id = (
          SELECT id FROM public.profiles
          WHERE status IN ('archived', 'imported')
            AND user_id IS NULL
            AND lower(trim(email)) = _email
          ORDER BY updated_at DESC NULLS LAST
          LIMIT 1
        );

      IF NOT FOUND THEN
        INSERT INTO public.profiles (user_id, email, full_name, first_name, last_name, phone, status)
        VALUES (
          NEW.id, NEW.email,
          COALESCE(NEW.raw_user_meta_data ->> 'full_name',
                   concat_ws(' ', NEW.raw_user_meta_data ->> 'first_name', NEW.raw_user_meta_data ->> 'last_name')),
          NEW.raw_user_meta_data ->> 'first_name',
          NEW.raw_user_meta_data ->> 'last_name',
          NEW.raw_user_meta_data ->> 'phone',
          'banned'
        );
      END IF;
    END IF;

    -- Enrich ban case with email
    PERFORM public.ban_case_upsert_identifiers(_ban_case_id,
      jsonb_build_array(jsonb_build_object('kind', 'email', 'value', NEW.email)));

    -- Audit log (SYSTEM ACTOR proof: columns, NOT meta)
    INSERT INTO public.audit_logs (actor_type, actor_user_id, actor_label, action, target_user_id, meta)
    VALUES ('system', NULL, 'handle_new_user', 'banned_access_denied', NEW.id,
      jsonb_build_object('ban_case_id', _ban_case_id, 'matched_kind', 'email', 'matched_value', _email));

    RETURN NEW; -- NO role assignment
  END IF;
  -- ========== END BAN CHECK ==========

  -- Get current policy version (with safe fallback)
  BEGIN
    SELECT version INTO _current_policy_version
    FROM public.privacy_policy_versions
    WHERE is_current = true
    LIMIT 1;
  EXCEPTION WHEN undefined_table THEN
    _current_policy_version := NULL;
  END;

  -- Find archived/imported profile with FOR UPDATE SKIP LOCKED
  SELECT p.id, p.was_club_member
  INTO _archived_profile
  FROM public.profiles p
  WHERE p.status IN ('archived', 'imported')
    AND p.user_id IS NULL
    AND (
      lower(trim(p.email)) = _email
      OR (p.emails IS NOT NULL AND p.emails @> to_jsonb(_email))
    )
  ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF _archived_profile.id IS NOT NULL THEN
    UPDATE public.profiles
    SET 
      user_id = NEW.id, 
      status = 'active', 
      is_archived = false,
      email = COALESCE(email, NEW.email),
      updated_at = now()
    WHERE id = _archived_profile.id;

    UPDATE public.orders_v2
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _archived_profile.id
      AND (user_id IS NULL OR user_id <> NEW.id);

    UPDATE public.subscriptions_v2
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _archived_profile.id
      AND (user_id IS NULL OR user_id <> NEW.id);

    UPDATE public.entitlements
    SET user_id = NEW.id, updated_at = now()
    WHERE profile_id = _archived_profile.id
      AND (user_id IS NULL OR user_id <> NEW.id);

    -- ========== v23.1.9D: Generic entitlement sync for ALL active subscriptions ==========
    -- Loop over active/trial subscriptions that now belong to this user,
    -- and create/update entitlements for subscription-based products.
    -- CB20 (order-based only) is explicitly excluded.
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
      -- Upsert entitlement: ON CONFLICT never decrease expires_at
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
          'source_patch', 'v23.1.9D',
          'actor_label', 'handle_new_user',
          'subscription_id', _sub.sub_id,
          'synced_at', now()::text
        )
      )
      ON CONFLICT (user_id, product_code) DO UPDATE SET
        status = 'active',
        expires_at = GREATEST(entitlements.expires_at, EXCLUDED.expires_at),
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
              'source_patch', 'v23.1.9D'
            ));

    BEGIN
      INSERT INTO public.consent_logs (user_id, email, consent_type, policy_version, granted, source)
      VALUES (NEW.id, NEW.email, 'marketing', COALESCE(_current_policy_version, 'unknown'), true, 'registration_archived_link');
    EXCEPTION WHEN undefined_table THEN NULL;
    END;

  ELSE
    INSERT INTO public.profiles (user_id, email, full_name, first_name, last_name, phone, marketing_consent)
    VALUES (
      NEW.id, NEW.email,
      COALESCE(NEW.raw_user_meta_data ->> 'full_name',
               concat_ws(' ', NEW.raw_user_meta_data ->> 'first_name', NEW.raw_user_meta_data ->> 'last_name')),
      NEW.raw_user_meta_data ->> 'first_name',
      NEW.raw_user_meta_data ->> 'last_name',
      NEW.raw_user_meta_data ->> 'phone',
      true
    )
    ON CONFLICT (user_id) DO NOTHING;

    BEGIN
      INSERT INTO public.consent_logs (user_id, email, consent_type, policy_version, granted, source)
      VALUES (NEW.id, NEW.email, 'marketing', COALESCE(_current_policy_version, 'unknown'), true, 'registration');
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END IF;

  -- Assign default user role (always — skipped for banned above)
  SELECT id INTO _user_role_id FROM public.roles WHERE code = 'user' LIMIT 1;
  IF _user_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles_v2 (user_id, role_id)
    VALUES (NEW.id, _user_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;