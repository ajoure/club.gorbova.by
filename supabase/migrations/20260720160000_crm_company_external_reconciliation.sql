-- Companies Phase 9C: read-only import preview and deterministic reconciliation.
-- This RPC intentionally performs no writes. Import execution remains a
-- separate approval-gated operation behind the Companies service layer.

CREATE OR REPLACE FUNCTION public.crm_company_external_reconcile_preview(
  _provider text,
  _rows jsonb,
  _limit integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider text := lower(btrim(_provider));
  v_item jsonb;
  v_index bigint;
  v_external_id text;
  v_country text;
  v_unp text;
  v_email text;
  v_phone text;
  v_company_id uuid;
  v_candidates jsonb;
  v_candidate_count integer;
  v_action text;
  v_reason text;
  v_results jsonb := '[]'::jsonb;
  v_counts jsonb := jsonb_build_object('total', 0, 'create', 0, 'link_candidate', 0, 'existing', 0, 'conflict', 0, 'skip', 0);
  v_limit integer := least(greatest(coalesce(_limit, 1000), 1), 5000);
BEGIN
  IF NOT (
    has_role_v2(v_uid, 'super_admin') OR has_role_v2(v_uid, 'admin')
    OR has_role_v2(v_uid, 'menedzher') OR has_role_v2(v_uid, 'support')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_provider !~ '^[a-z][a-z0-9_.-]{1,63}$' THEN
    RAISE EXCEPTION 'invalid provider' USING ERRCODE = '22023';
  END IF;
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  FOR v_item, v_index IN
    SELECT value, ordinality
      FROM jsonb_array_elements(_rows) WITH ORDINALITY
     LIMIT v_limit
  LOOP
    v_external_id := btrim(coalesce(v_item->>'externalId', v_item->>'external_id', ''));
    v_country := upper(btrim(coalesce(v_item->>'country', 'BY')));
    v_unp := regexp_replace(btrim(coalesce(v_item->>'unp', '')), '\s+', '', 'g');
    v_email := lower(btrim(coalesce(v_item->>'email', '')));
    v_phone := regexp_replace(btrim(coalesce(v_item->>'phone', '')), '[^0-9+]', '', 'g');
    v_company_id := NULL;
    v_candidates := '[]'::jsonb;
    v_candidate_count := 0;
    v_action := 'create';
    v_reason := 'Нет точного совпадения: требуется создание или ручная привязка.';

    IF v_external_id = '' OR length(v_external_id) > 256 THEN
      v_action := 'skip';
      v_reason := 'Отсутствует или слишком длинный внешний ID.';
    ELSE
      SELECT e.company_id INTO v_company_id
        FROM public.company_external_ids e
       WHERE e.provider = v_provider
         AND e.external_id = v_external_id
       LIMIT 1;

      IF v_company_id IS NOT NULL THEN
        v_action := 'existing';
        v_reason := 'Внешний ID уже привязан к canonical company.';
        v_candidates := jsonb_build_array(jsonb_build_object('company_id', v_company_id));
        v_candidate_count := 1;
      ELSE
        SELECT coalesce(jsonb_agg(jsonb_build_object('company_id', c.id, 'public_id', c.public_id, 'full_name', c.full_name) ORDER BY c.public_id), '[]'::jsonb)
          INTO v_candidates
          FROM public.companies c
         WHERE c.status = 'active'
           AND ((length(v_unp) = 9 AND c.country = v_country AND c.unp_normalized = v_unp)
             OR (v_unp = '' AND v_email <> '' AND lower(coalesce(c.email, '')) = v_email)
             OR (v_unp = '' AND v_phone <> '' AND regexp_replace(coalesce(c.phone, ''), '[^0-9+]', '', 'g') = v_phone));

        SELECT jsonb_array_length(v_candidates) INTO v_candidate_count;
        IF v_candidate_count = 1 THEN
          v_action := 'link_candidate';
          v_reason := 'Найдено ровно одно детерминированное совпадение; привязка требует подтверждения импорта.';
        ELSIF v_candidate_count > 1 THEN
          v_action := 'conflict';
          v_reason := 'Найдено несколько canonical companies; автоматическая привязка запрещена.';
        END IF;
      END IF;
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'source_row', v_index,
      'external_id', NULLIF(v_external_id, ''),
      'action', v_action,
      'reason', v_reason,
      'candidates', v_candidates
    ));
    v_counts := jsonb_set(v_counts, ARRAY['total'], to_jsonb((v_counts->>'total')::integer + 1));
    v_counts := jsonb_set(v_counts, ARRAY[v_action], to_jsonb(coalesce((v_counts->>v_action)::integer, 0) + 1));
  END LOOP;

  RETURN jsonb_build_object('provider', v_provider, 'limited', jsonb_array_length(_rows) > v_limit, 'counts', v_counts, 'rows', v_results);
END $$;

REVOKE ALL ON FUNCTION public.crm_company_external_reconcile_preview(text, jsonb, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_external_reconcile_preview(text, jsonb, integer) TO authenticated;
