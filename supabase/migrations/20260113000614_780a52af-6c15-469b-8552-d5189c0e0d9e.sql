-- Fix archived→active merge: consolidate all logic into handle_new_user
-- Problem: Two triggers were creating duplicate profiles on signup

-- 0) Remove old trigger on profiles table (was causing duplicate profile creation)
DROP TRIGGER IF EXISTS on_profile_created_link_archived ON public.profiles;

-- 1) Update handle_new_user with complete archived-reuse logic
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  _user_role_id uuid;
  _current_policy_version text;
  _archived_profile record;
  _email text;
BEGIN
  _email := lower(trim(NEW.email));

  -- Get current policy version (with safe fallback)
  BEGIN
    SELECT version INTO _current_policy_version
    FROM public.privacy_policy_versions
    WHERE is_current = true
    LIMIT 1;
  EXCEPTION WHEN undefined_table THEN
    _current_policy_version := NULL;
  END;

  -- Find archived profile with FOR UPDATE SKIP LOCKED (race condition protection)
  SELECT p.id, p.was_club_member
  INTO _archived_profile
  FROM public.profiles p
  WHERE p.status = 'archived'
    AND p.user_id IS NULL
    AND (
      lower(trim(p.email)) = _email
      OR (p.emails IS NOT NULL AND p.emails @> to_jsonb(_email))
    )
  ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF _archived_profile.id IS NOT NULL THEN
    -- REUSE archived profile: activate and link to NEW.id (auth.users.id)
    UPDATE public.profiles
    SET user_id = NEW.id, status = 'active', updated_at = now()
    WHERE id = _archived_profile.id;

    -- Transfer data by profile_id (NOT user_id!)
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

    -- Create club entitlement if paid order exists and no active entitlement
    INSERT INTO public.entitlements (user_id, profile_id, product_code, status, expires_at, meta)
    SELECT NEW.id, _archived_profile.id, 'club', 'active',
           now() + interval '1 month',
           jsonb_build_object('source', 'archived_profile_link', 'original_profile_id', _archived_profile.id)
    FROM public.orders_v2 o
    WHERE o.profile_id = _archived_profile.id
      AND o.status = 'paid'
      AND o.product_id = '11c9f1b8-0355-4753-bd74-40b42aa53616'
      AND NOT EXISTS (
        SELECT 1 FROM public.entitlements e
        WHERE e.user_id = NEW.id
          AND e.product_code = 'club'
          AND e.status = 'active'
          AND (e.expires_at IS NULL OR e.expires_at > now())
      )
    LIMIT 1;

    -- Audit log
    INSERT INTO public.audit_logs (actor_user_id, action, target_user_id, meta)
    VALUES (NEW.id, 'archived_profile_linked', NEW.id,
            jsonb_build_object('archived_profile_id', _archived_profile.id,
                               'was_club_member', _archived_profile.was_club_member,
                               'linked_at', now()));

    -- Consent log (safe insert)
    BEGIN
      INSERT INTO public.consent_logs (user_id, email, consent_type, policy_version, granted, source)
      VALUES (NEW.id, NEW.email, 'marketing', COALESCE(_current_policy_version, 'unknown'), true, 'registration_archived_link');
    EXCEPTION WHEN undefined_table THEN NULL;
    END;

  ELSE
    -- No archived profile: create new one
    INSERT INTO public.profiles (user_id, email, full_name, first_name, last_name, phone, marketing_consent)
    VALUES (
      NEW.id, NEW.email,
      COALESCE(NEW.raw_user_meta_data ->> 'full_name',
               concat_ws(' ', NEW.raw_user_meta_data ->> 'first_name', NEW.raw_user_meta_data ->> 'last_name')),
      NEW.raw_user_meta_data ->> 'first_name',
      NEW.raw_user_meta_data ->> 'last_name',
      NEW.raw_user_meta_data ->> 'phone',
      true
    );

    BEGIN
      INSERT INTO public.consent_logs (user_id, email, consent_type, policy_version, granted, source)
      VALUES (NEW.id, NEW.email, 'marketing', COALESCE(_current_policy_version, 'unknown'), true, 'registration');
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END IF;

  -- Assign default user role (always)
  SELECT id INTO _user_role_id FROM public.roles WHERE code = 'user' LIMIT 1;
  IF _user_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles_v2 (user_id, role_id)
    VALUES (NEW.id, _user_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;