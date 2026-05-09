
-- ============================================================================
-- C5-G: Document numbering v2 (DDMM/N, Europe/Minsk)
-- ============================================================================

-- 1. Counters table -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_number_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_date date NOT NULL,
  document_timezone text NOT NULL DEFAULT 'Europe/Minsk',
  last_seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_date, document_timezone)
);

ALTER TABLE public.document_number_counters ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "doc_num_counters_admin_read"
    ON public.document_number_counters FOR SELECT TO authenticated
    USING (
      has_role_v2(auth.uid(), 'admin')
      OR has_role_v2(auth.uid(), 'super_admin')
      OR has_role_v2(auth.uid(), 'owner')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Columns on ai_generated_documents ---------------------------------------
ALTER TABLE public.ai_generated_documents
  ADD COLUMN IF NOT EXISTS document_number text,
  ADD COLUMN IF NOT EXISTS document_date date,
  ADD COLUMN IF NOT EXISTS document_seq integer,
  ADD COLUMN IF NOT EXISTS document_timezone text DEFAULT 'Europe/Minsk',
  ADD COLUMN IF NOT EXISTS document_number_assigned_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_gen_docs_document_number
  ON public.ai_generated_documents (document_number)
  WHERE document_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_gen_docs_tz_date_seq
  ON public.ai_generated_documents (document_timezone, document_date, document_seq)
  WHERE document_seq IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_gen_docs_context_doc_number
  ON public.ai_generated_documents (context_type, context_id, document_number)
  WHERE document_number IS NOT NULL;

-- 3. Immutability trigger ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_generated_documents_immutable_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allow_override boolean := false;
BEGIN
  BEGIN
    allow_override := coalesce(current_setting('app.allow_document_number_override', true), '0') = '1';
  EXCEPTION WHEN OTHERS THEN
    allow_override := false;
  END;

  IF allow_override THEN
    RETURN NEW;
  END IF;

  IF OLD.document_number IS NOT NULL
     AND NEW.document_number IS DISTINCT FROM OLD.document_number THEN
    RAISE EXCEPTION 'document_number_is_immutable'
      USING HINT = 'Use admin_override_document_number RPC';
  END IF;

  IF OLD.document_date IS NOT NULL
     AND NEW.document_date IS DISTINCT FROM OLD.document_date THEN
    RAISE EXCEPTION 'document_number_is_immutable'
      USING HINT = 'document_date is immutable once assigned';
  END IF;

  IF OLD.document_seq IS NOT NULL
     AND NEW.document_seq IS DISTINCT FROM OLD.document_seq THEN
    RAISE EXCEPTION 'document_number_is_immutable'
      USING HINT = 'document_seq is immutable once assigned';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_generated_documents_immutable_number
  ON public.ai_generated_documents;
CREATE TRIGGER trg_ai_generated_documents_immutable_number
  BEFORE UPDATE ON public.ai_generated_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.ai_generated_documents_immutable_number();

-- 4. RPC allocate_document_number --------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_document_number(
  p_document_id uuid,
  p_now timestamptz DEFAULT NULL
)
RETURNS TABLE (
  document_number text,
  document_date date,
  document_seq integer,
  document_timezone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc record;
  v_today date;
  v_tz text := 'Europe/Minsk';
  v_seq integer;
  v_number text;
  v_now timestamptz := coalesce(p_now, now());
BEGIN
  SELECT id, document_number, document_date, document_seq, document_timezone,
         context_type, context_id, template_id, template_version_id, profile_id
    INTO v_doc
  FROM public.ai_generated_documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_doc.document_number IS NOT NULL THEN
    document_number := v_doc.document_number;
    document_date := v_doc.document_date;
    document_seq := v_doc.document_seq;
    document_timezone := coalesce(v_doc.document_timezone, v_tz);
    RETURN NEXT;
    RETURN;
  END IF;

  v_today := (v_now AT TIME ZONE v_tz)::date;

  INSERT INTO public.document_number_counters (document_date, document_timezone, last_seq)
  VALUES (v_today, v_tz, 1)
  ON CONFLICT (document_date, document_timezone)
  DO UPDATE SET last_seq = public.document_number_counters.last_seq + 1,
                updated_at = now()
  RETURNING last_seq INTO v_seq;

  v_number := to_char(v_today, 'DDMM') || '/' || v_seq::text;

  UPDATE public.ai_generated_documents
     SET document_number = v_number,
         document_date = v_today,
         document_seq = v_seq,
         document_timezone = v_tz,
         document_number_assigned_at = now()
   WHERE id = p_document_id;

  INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, meta)
  VALUES (
    NULL, 'system', 'document_numbering_v2', 'document_number.assigned',
    jsonb_build_object(
      'document_id', v_doc.id,
      'context_type', v_doc.context_type,
      'context_id', v_doc.context_id,
      'template_id', v_doc.template_id,
      'template_version_id', v_doc.template_version_id,
      'profile_id', v_doc.profile_id,
      'document_number', v_number,
      'document_date', v_today,
      'document_seq', v_seq,
      'timezone', v_tz
    )
  );

  document_number := v_number;
  document_date := v_today;
  document_seq := v_seq;
  document_timezone := v_tz;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_document_number(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(uuid, timestamptz) TO service_role;

-- 5. RPC admin_override_document_number --------------------------------------
CREATE OR REPLACE FUNCTION public.admin_override_document_number(
  p_document_id uuid,
  p_new_number text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_old record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT has_role_v2(v_caller, 'super_admin') THEN
    RAISE EXCEPTION 'forbidden_super_admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_new_number IS NULL OR length(trim(p_new_number)) = 0 THEN
    RAISE EXCEPTION 'new_number_required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT id, document_number, document_date, document_seq
    INTO v_old
  FROM public.ai_generated_documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_found';
  END IF;

  PERFORM set_config('app.allow_document_number_override', '1', true);

  UPDATE public.ai_generated_documents
     SET document_number = p_new_number,
         document_number_assigned_at = now()
   WHERE id = p_document_id;

  PERFORM set_config('app.allow_document_number_override', '0', true);

  INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, meta)
  VALUES (
    v_caller, 'user', 'document_numbering_v2_override', 'document_number.override',
    jsonb_build_object(
      'document_id', p_document_id,
      'old_number', v_old.document_number,
      'new_number', p_new_number,
      'reason', p_reason
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_override_document_number(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_override_document_number(uuid, text, text) TO authenticated;

-- 6. Archive 5 legacy tokens (idempotent, whitelist) -------------------------
UPDATE public.document_token_registry
   SET archived_at = COALESCE(archived_at, now()),
       archive_reason = COALESCE(archive_reason, 'replaced_by_document_numbering_v2'),
       updated_at = now()
 WHERE token_key IN (
    'document.act_number',
    'document.act_date',
    'document.contract_number',
    'document.contract_date',
    'document.date_short'
 )
   AND archived_at IS NULL;

-- 7. Token-key aliases legacy → canonical (idempotent) -----------------------
INSERT INTO public.document_token_aliases (alias_token, canonical_token_key, notes, metadata)
SELECT v.alias_token, v.canonical_token_key,
       'C5-G: legacy → canonical document numbering v2',
       jsonb_build_object('migration', 'c5g_document_numbering')
  FROM (VALUES
    ('document.act_number',      'document.number'),
    ('document.contract_number', 'document.number'),
    ('document.act_date',        'document.date'),
    ('document.contract_date',   'document.date'),
    ('document.date_short',      'document.date')
  ) AS v(alias_token, canonical_token_key)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.document_token_aliases a
    WHERE a.alias_token = v.alias_token
      AND a.template_id IS NULL
      AND a.template_version_id IS NULL
 );

-- 8. Audit log: migration ----------------------------------------------------
INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, meta)
VALUES (
  NULL, 'system', 'c5g_document_numbering_migration',
  'document_numbering.migration_applied',
  jsonb_build_object(
    'sprint', 'sprint11_c5g',
    'archived_tokens', ARRAY['document.act_number','document.act_date','document.contract_number','document.contract_date','document.date_short'],
    'aliases_added', 5,
    'rpc', ARRAY['allocate_document_number','admin_override_document_number'],
    'counter_table', 'document_number_counters',
    'timezone', 'Europe/Minsk',
    'format', 'DDMM/N'
  )
);
