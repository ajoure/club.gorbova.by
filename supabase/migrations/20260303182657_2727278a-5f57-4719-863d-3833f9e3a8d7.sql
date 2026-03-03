
-- =============================================
-- BAN-LIST SYSTEM: tables, normalizers, functions, handle_new_user patch
-- =============================================

-- 1) Tables
CREATE TABLE public.ban_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id),
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.ban_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ban_case_id uuid NOT NULL REFERENCES public.ban_cases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email','phone','telegram_user_id','telegram_username')),
  value text NOT NULL,
  value_norm text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ban_identifiers_unique_active
ON public.ban_identifiers(kind, value_norm)
WHERE is_active = true;

CREATE INDEX idx_ban_cases_active ON public.ban_cases(is_active) WHERE is_active = true;
CREATE INDEX idx_ban_identifiers_lookup ON public.ban_identifiers(kind, value_norm) WHERE is_active = true;

-- 2) RLS
ALTER TABLE public.ban_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ban_identifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin can manage ban_cases"
ON public.ban_cases FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "admin can view ban_cases"
ON public.ban_cases FOR SELECT TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin'));

CREATE POLICY "super_admin can manage ban_identifiers"
ON public.ban_identifiers FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "admin can view ban_identifiers"
ON public.ban_identifiers FOR SELECT TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin'));

-- 3) Normalizer functions (IMMUTABLE)
CREATE OR REPLACE FUNCTION public.norm_email(_val text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN trim(COALESCE(_val, '')) = '' THEN NULL
    ELSE lower(trim(_val))
  END;
$$;

CREATE OR REPLACE FUNCTION public.norm_phone(_val text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN length(regexp_replace(COALESCE(_val, ''), '[^0-9]', '', 'g')) < 7 THEN NULL
    ELSE regexp_replace(
      regexp_replace(COALESCE(_val, ''), '[^0-9+]', '', 'g'),
      '^\+?(\+*)', '+', ''
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.norm_tg_username(_val text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN trim(COALESCE(_val, '')) = '' THEN NULL
    ELSE lower(ltrim(trim(_val), '@'))
  END;
$$;

-- 4) check_ban_by_identifiers
CREATE OR REPLACE FUNCTION public.check_ban_by_identifiers(
  _email text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _tg_user_id bigint DEFAULT NULL,
  _tg_username text DEFAULT NULL
)
RETURNS TABLE(ban_case_id uuid, matched_kind text, matched_value text)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _norm_email text;
  _norm_phone text;
  _norm_tg_username text;
  _norm_tg_user_id text;
BEGIN
  _norm_email := public.norm_email(_email);
  _norm_phone := public.norm_phone(_phone);
  _norm_tg_username := public.norm_tg_username(_tg_username);
  _norm_tg_user_id := CASE WHEN _tg_user_id IS NOT NULL THEN trim(_tg_user_id::text) ELSE NULL END;

  RETURN QUERY
  SELECT bi.ban_case_id, bi.kind, bi.value_norm
  FROM public.ban_identifiers bi
  JOIN public.ban_cases bc ON bc.id = bi.ban_case_id AND bc.is_active = true
  WHERE bi.is_active = true
    AND (
      (_norm_email IS NOT NULL AND bi.kind = 'email' AND bi.value_norm = _norm_email)
      OR (_norm_phone IS NOT NULL AND bi.kind = 'phone' AND bi.value_norm = _norm_phone)
      OR (_norm_tg_user_id IS NOT NULL AND bi.kind = 'telegram_user_id' AND bi.value_norm = _norm_tg_user_id)
      OR (_norm_tg_username IS NOT NULL AND bi.kind = 'telegram_username' AND bi.value_norm = _norm_tg_username)
    )
  LIMIT 1;
END;
$$;

-- 5) ban_case_upsert_identifiers
CREATE OR REPLACE FUNCTION public.ban_case_upsert_identifiers(
  _ban_case_id uuid,
  _identifiers jsonb
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _item jsonb;
  _kind text;
  _value text;
  _value_norm text;
  _added int := 0;
  _existing_case_id uuid;
  _existing_id uuid;
  _remaining int;
BEGIN
  FOR _item IN SELECT * FROM jsonb_array_elements(_identifiers)
  LOOP
    _kind := _item ->> 'kind';
    _value := _item ->> 'value';

    -- Normalize
    _value_norm := CASE _kind
      WHEN 'email' THEN public.norm_email(_value)
      WHEN 'phone' THEN public.norm_phone(_value)
      WHEN 'telegram_username' THEN public.norm_tg_username(_value)
      WHEN 'telegram_user_id' THEN trim(_value)
      ELSE NULL
    END;

    IF _value_norm IS NULL THEN CONTINUE; END IF;

    -- Check if active identifier already exists
    SELECT bi.id, bi.ban_case_id INTO _existing_id, _existing_case_id
    FROM public.ban_identifiers bi
    WHERE bi.kind = _kind AND bi.value_norm = _value_norm AND bi.is_active = true
    LIMIT 1;

    IF _existing_id IS NOT NULL THEN
      IF _existing_case_id = _ban_case_id THEN
        -- Already in target case, skip
        CONTINUE;
      ELSE
        -- Move to target case (reassign)
        UPDATE public.ban_identifiers SET ban_case_id = _ban_case_id WHERE id = _existing_id;

        -- Check if loser case has remaining active identifiers
        SELECT count(*) INTO _remaining
        FROM public.ban_identifiers
        WHERE ban_case_id = _existing_case_id AND is_active = true;

        IF _remaining = 0 THEN
          UPDATE public.ban_cases SET is_active = false WHERE id = _existing_case_id;
        END IF;

        -- Audit merge
        INSERT INTO public.audit_logs (actor_type, actor_user_id, actor_label, action, meta)
        VALUES ('system', NULL, 'ban_case_upsert', 'ban_case_merged',
          jsonb_build_object('from_case', _existing_case_id, 'to_case', _ban_case_id, 'kind', _kind, 'value_norm', _value_norm));

        _added := _added + 1;
      END IF;
    ELSE
      -- Insert new identifier
      INSERT INTO public.ban_identifiers (ban_case_id, kind, value, value_norm, is_active)
      VALUES (_ban_case_id, _kind, _value, _value_norm, true);
      _added := _added + 1;
    END IF;
  END LOOP;

  RETURN _added;
END;
$$;

-- 6) Patch handle_new_user with ban-check
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

    INSERT INTO public.audit_logs (actor_user_id, action, target_user_id, meta)
    VALUES (NEW.id, 'archived_profile_linked', NEW.id,
            jsonb_build_object('archived_profile_id', _archived_profile.id,
                               'was_club_member', _archived_profile.was_club_member,
                               'linked_at', now()));

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
