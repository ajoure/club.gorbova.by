-- Contacts merge foundation. It extends the existing merge_history journal
-- instead of introducing a parallel merge entity. profile_contact_values is
-- the one approved new relation: it preserves multiple values per profile.

CREATE TABLE IF NOT EXISTS public.profile_contact_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'phone', 'telegram')),
  normalized_value text NOT NULL CHECK (normalized_value <> ''),
  display_value text NOT NULL CHECK (display_value <> ''),
  is_primary boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual',
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_contact_values_profile_kind_value_key
    UNIQUE (profile_id, kind, normalized_value)
);

CREATE UNIQUE INDEX IF NOT EXISTS profile_contact_values_one_primary_per_kind_idx
  ON public.profile_contact_values (profile_id, kind)
  WHERE is_primary AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS profile_contact_values_lookup_idx
  ON public.profile_contact_values (kind, normalized_value)
  WHERE archived_at IS NULL;

ALTER TABLE public.profile_contact_values ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_contact_values FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profile_contact_values TO service_role;

CREATE OR REPLACE FUNCTION public.sync_profile_contact_values()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_email text := NULLIF(lower(trim(NEW.email)), '');
  v_phone text := NULLIF(regexp_replace(coalesce(NEW.phone, ''), '[^0-9]', '', 'g'), '');
  v_telegram text := NULLIF(lower(regexp_replace(trim(coalesce(NEW.telegram_username, '')), '^@+', '')), '');
BEGIN
  -- Only rows managed by this compatibility bridge are replaced. Manually
  -- retained secondary values remain untouched.
  UPDATE public.profile_contact_values
     SET is_primary = false,
         archived_at = COALESCE(archived_at, now()),
         updated_at = now()
   WHERE profile_id = NEW.id
     AND is_primary
     AND source = 'profile_sync';

  IF v_email IS NOT NULL THEN
    INSERT INTO public.profile_contact_values (
      profile_id, kind, normalized_value, display_value, is_primary, source, archived_at
    ) VALUES (NEW.id, 'email', v_email, v_email, true, 'profile_sync', NULL)
    ON CONFLICT (profile_id, kind, normalized_value) DO UPDATE
      SET display_value = EXCLUDED.display_value,
          is_primary = true,
          source = 'profile_sync',
          archived_at = NULL,
          updated_at = now();
  END IF;

  IF v_phone IS NOT NULL THEN
    INSERT INTO public.profile_contact_values (
      profile_id, kind, normalized_value, display_value, is_primary, source, archived_at
    ) VALUES (NEW.id, 'phone', v_phone, NEW.phone, true, 'profile_sync', NULL)
    ON CONFLICT (profile_id, kind, normalized_value) DO UPDATE
      SET display_value = EXCLUDED.display_value,
          is_primary = true,
          source = 'profile_sync',
          archived_at = NULL,
          updated_at = now();
  END IF;

  IF v_telegram IS NOT NULL THEN
    INSERT INTO public.profile_contact_values (
      profile_id, kind, normalized_value, display_value, is_primary, source, archived_at
    ) VALUES (NEW.id, 'telegram', v_telegram, NEW.telegram_username, true, 'profile_sync', NULL)
    ON CONFLICT (profile_id, kind, normalized_value) DO UPDATE
      SET display_value = EXCLUDED.display_value,
          is_primary = true,
          source = 'profile_sync',
          archived_at = NULL,
          updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_profile_contact_values() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_sync_contact_values ON public.profiles;
CREATE TRIGGER profiles_sync_contact_values
AFTER INSERT OR UPDATE OF email, phone, telegram_username ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_contact_values();

-- Backfill without eliminating current duplicate evidence. Global uniqueness
-- is intentionally not imposed: duplicate detection needs to see collisions.
INSERT INTO public.profile_contact_values (
  profile_id, kind, normalized_value, display_value, is_primary, source, archived_at
)
SELECT p.id, 'email', lower(trim(p.email)), lower(trim(p.email)), true, 'profile_sync', NULL
  FROM public.profiles p
 WHERE nullif(trim(coalesce(p.email, '')), '') IS NOT NULL
ON CONFLICT (profile_id, kind, normalized_value) DO UPDATE
  SET display_value = EXCLUDED.display_value,
      is_primary = true,
      source = 'profile_sync',
      archived_at = NULL,
      updated_at = now();

INSERT INTO public.profile_contact_values (
  profile_id, kind, normalized_value, display_value, is_primary, source, archived_at
)
SELECT p.id,
       'phone',
       regexp_replace(p.phone, '[^0-9]', '', 'g'),
       p.phone,
       true,
       'profile_sync',
       NULL
  FROM public.profiles p
 WHERE nullif(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
ON CONFLICT (profile_id, kind, normalized_value) DO UPDATE
  SET display_value = EXCLUDED.display_value,
      is_primary = true,
      source = 'profile_sync',
      archived_at = NULL,
      updated_at = now();

INSERT INTO public.profile_contact_values (
  profile_id, kind, normalized_value, display_value, is_primary, source, archived_at
)
SELECT p.id,
       'telegram',
       lower(regexp_replace(trim(p.telegram_username), '^@+', '')),
       p.telegram_username,
       true,
       'profile_sync',
       NULL
  FROM public.profiles p
 WHERE nullif(regexp_replace(trim(coalesce(p.telegram_username, '')), '^@+', ''), '') IS NOT NULL
ON CONFLICT (profile_id, kind, normalized_value) DO UPDATE
  SET display_value = EXCLUDED.display_value,
      is_primary = true,
      source = 'profile_sync',
      archived_at = NULL,
      updated_at = now();

ALTER TABLE public.merge_history
  ADD COLUMN IF NOT EXISTS operation_id uuid,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS source_profile_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS transfer_manifest jsonb,
  ADD COLUMN IF NOT EXISTS source_checksum text,
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_by uuid,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE public.merge_history
  ADD CONSTRAINT merge_history_state_check
  CHECK (state IN ('completed', 'reverted')) NOT VALID;

ALTER TABLE public.merge_history
  ADD CONSTRAINT merge_history_master_profile_fk
  FOREIGN KEY (master_profile_id) REFERENCES public.profiles(id) NOT VALID;

ALTER TABLE public.merge_history
  ADD CONSTRAINT merge_history_merged_profile_fk
  FOREIGN KEY (merged_profile_id) REFERENCES public.profiles(id) NOT VALID;

ALTER TABLE public.merge_history
  ADD CONSTRAINT merge_history_case_fk
  FOREIGN KEY (case_id) REFERENCES public.duplicate_cases(id) NOT VALID;

UPDATE public.merge_history
   SET operation_id = COALESCE(operation_id, id),
       source_profile_snapshot = COALESCE(source_profile_snapshot, merged_data),
       state = COALESCE(state, 'completed')
 WHERE operation_id IS NULL
    OR source_profile_snapshot IS NULL
    OR state IS NULL;

ALTER TABLE public.merge_history
  ALTER COLUMN operation_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS merge_history_operation_source_idx
  ON public.merge_history (operation_id, merged_profile_id)
  WHERE merged_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS merge_history_master_state_created_idx
  ON public.merge_history (master_profile_id, state, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_preview_contact_merge(
  p_master_profile_id uuid,
  p_merged_profile_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_source_ids uuid[];
  v_master public.profiles%ROWTYPE;
  v_missing_ids uuid[];
  v_archived_ids uuid[];
  v_account_linked_ids uuid[];
  v_telegram_conflict_ids uuid[];
  v_sources jsonb;
  v_counts jsonb;
  v_blockers jsonb;
BEGIN
  IF v_caller IS NULL OR NOT (
    coalesce(public.has_role(v_caller, 'super_admin'), false)
    OR coalesce(public.has_role(v_caller, 'admin'), false)
    OR coalesce(public.has_permission(v_caller, 'contacts.edit'), false)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_master_profile_id IS NULL THEN
    RAISE EXCEPTION 'master_profile_required' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT profile_id ORDER BY profile_id)
    INTO v_source_ids
    FROM unnest(coalesce(p_merged_profile_ids, '{}'::uuid[])) AS input(profile_id)
   WHERE profile_id <> p_master_profile_id;

  IF coalesce(cardinality(v_source_ids), 0) = 0 THEN
    RAISE EXCEPTION 'at_least_one_source_profile_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_master
    FROM public.profiles
   WHERE id = p_master_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'master_profile_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(source_id ORDER BY source_id)
    INTO v_missing_ids
    FROM unnest(v_source_ids) AS source(source_id)
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = source.source_id);

  SELECT array_agg(p.id ORDER BY p.id)
    INTO v_archived_ids
    FROM public.profiles p
   WHERE p.id = ANY(v_source_ids)
     AND (coalesce(p.is_archived, false) OR p.status = 'archived' OR p.merged_to_profile_id IS NOT NULL);

  -- A profile with an auth account is an identity/access boundary. The first
  -- reversible release never rewrites or combines auth identities.
  SELECT array_agg(p.id ORDER BY p.id)
    INTO v_account_linked_ids
    FROM public.profiles p
   WHERE p.id = ANY(v_source_ids)
     AND p.user_id IS NOT NULL;

  IF v_master.telegram_user_id IS NOT NULL THEN
    SELECT array_agg(p.id ORDER BY p.id)
      INTO v_telegram_conflict_ids
      FROM public.profiles p
     WHERE p.id = ANY(v_source_ids)
       AND p.telegram_user_id IS NOT NULL
       AND p.telegram_user_id <> v_master.telegram_user_id;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'profile_id', p.id,
    'full_name', p.full_name,
    'email', p.email,
    'phone', p.phone,
    'telegram_username', p.telegram_username,
    'has_account', p.user_id IS NOT NULL
  ) ORDER BY p.created_at, p.id), '[]'::jsonb)
    INTO v_sources
    FROM public.profiles p
   WHERE p.id = ANY(v_source_ids);

  SELECT jsonb_build_object(
    'orders_v2', (SELECT count(*) FROM public.orders_v2 WHERE profile_id = ANY(v_source_ids)),
    'payments_v2', (SELECT count(*) FROM public.payments_v2 WHERE profile_id = ANY(v_source_ids)),
    'entitlements', (SELECT count(*) FROM public.entitlements WHERE profile_id = ANY(v_source_ids)),
    'subscriptions_v2', (SELECT count(*) FROM public.subscriptions_v2 WHERE profile_id = ANY(v_source_ids)),
    'generated_documents', (SELECT count(*) FROM public.generated_documents WHERE profile_id = ANY(v_source_ids)),
    'telegram_club_members', (SELECT count(*) FROM public.telegram_club_members WHERE profile_id = ANY(v_source_ids)),
    'contact_values', (SELECT count(*) FROM public.profile_contact_values WHERE profile_id = ANY(v_source_ids) AND archived_at IS NULL)
  ) INTO v_counts;

  v_blockers := jsonb_strip_nulls(jsonb_build_object(
    'missing_profile_ids', to_jsonb(v_missing_ids),
    'archived_profile_ids', to_jsonb(v_archived_ids),
    'account_linked_profile_ids', to_jsonb(v_account_linked_ids),
    'telegram_conflict_profile_ids', to_jsonb(v_telegram_conflict_ids)
  ));

  RETURN jsonb_build_object(
    'can_merge', coalesce(cardinality(v_missing_ids), 0) = 0
      AND coalesce(cardinality(v_archived_ids), 0) = 0
      AND coalesce(cardinality(v_account_linked_ids), 0) = 0
      AND coalesce(cardinality(v_telegram_conflict_ids), 0) = 0,
    'master_profile_id', p_master_profile_id,
    'source_profile_ids', to_jsonb(v_source_ids),
    'sources', v_sources,
    'transfer_counts', v_counts,
    'blockers', v_blockers
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_preview_contact_merge(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_contact_merge(uuid, uuid[]) TO authenticated, service_role;
