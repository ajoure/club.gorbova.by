-- Add the same useful relationship filters expected by the Companies roadmap:
-- companies with/without linked contacts and with/without linked deals.

CREATE OR REPLACE FUNCTION public.search_companies(_filters jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed_keys text[] := ARRAY['q','status','company_kind','country','profile_id',
                                 'include_merged','limit','offset','sort_by','sort_dir',
                                 'created_from','created_to','has_contacts','has_deals'];
  v_key text;
  v_q text; v_country text; v_profile uuid; v_incl_merged boolean;
  v_created_from date; v_created_to date;
  v_has_contacts boolean; v_has_deals boolean;
  v_limit int; v_offset int; v_sort_by text; v_sort_dir text;
  v_status text[]; v_kind text[];
  v_items jsonb; v_sql text;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin')
       OR has_role_v2(v_uid,'menedzher') OR has_role_v2(v_uid,'support')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _filters IS NULL THEN _filters := '{}'::jsonb; END IF;
  FOR v_key IN SELECT jsonb_object_keys(_filters) LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN RAISE EXCEPTION 'unknown filter key: %', v_key USING ERRCODE='22023'; END IF;
  END LOOP;

  v_q := NULLIF(btrim(_filters->>'q'),'');
  v_country := NULLIF(upper(btrim(coalesce(_filters->>'country',''))),'');
  v_profile := NULLIF(_filters->>'profile_id','')::uuid;
  v_incl_merged := COALESCE((_filters->>'include_merged')::boolean, false);
  v_created_from := NULLIF(_filters->>'created_from','')::date;
  v_created_to := NULLIF(_filters->>'created_to','')::date;
  v_has_contacts := NULLIF(_filters->>'has_contacts','')::boolean;
  v_has_deals := NULLIF(_filters->>'has_deals','')::boolean;
  IF v_created_from IS NOT NULL AND v_created_to IS NOT NULL AND v_created_from > v_created_to THEN
    RAISE EXCEPTION 'created_from_after_created_to' USING ERRCODE='22023';
  END IF;
  v_limit := LEAST(GREATEST(COALESCE((_filters->>'limit')::int,20),1),100);
  v_offset := GREATEST(COALESCE((_filters->>'offset')::int,0),0);
  v_sort_by := COALESCE(_filters->>'sort_by','created_at');
  v_sort_dir := lower(COALESCE(_filters->>'sort_dir','desc'));
  IF v_sort_by NOT IN ('created_at','full_name','public_id') THEN RAISE EXCEPTION 'invalid sort_by' USING ERRCODE='22023'; END IF;
  IF v_sort_dir NOT IN ('asc','desc') THEN RAISE EXCEPTION 'invalid sort_dir' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(_filters->'status') = 'array' THEN
    SELECT array_agg(x) INTO v_status FROM jsonb_array_elements_text(_filters->'status') AS x;
    IF NOT (v_status <@ ARRAY['active','archived','merged']) THEN RAISE EXCEPTION 'invalid status[]' USING ERRCODE='22023'; END IF;
  END IF;
  IF jsonb_typeof(_filters->'company_kind') = 'array' THEN
    SELECT array_agg(x) INTO v_kind FROM jsonb_array_elements_text(_filters->'company_kind') AS x;
    IF NOT (v_kind <@ ARRAY['legal_entity','entrepreneur','foreign','unknown']) THEN RAISE EXCEPTION 'invalid company_kind[]' USING ERRCODE='22023'; END IF;
  END IF;

  v_sql := format($f$
    WITH base AS (
      SELECT c.id, c.public_id, c.full_name, c.short_name, c.legal_form, c.unp_normalized,
             c.country, c.company_kind, c.status, c.email, c.phone, c.created_at
        FROM public.companies c
       WHERE ($1 OR c.status <> 'merged')
         AND ($2::text IS NULL OR c.country = $2)
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM public.company_contacts cc WHERE cc.company_id=c.id AND cc.profile_id=$3))
         AND ($4::text[] IS NULL OR c.status = ANY($4))
         AND ($5::text[] IS NULL OR c.company_kind = ANY($5))
         AND ($6::date IS NULL OR c.created_at >= $6::timestamptz)
         AND ($7::date IS NULL OR c.created_at < ($7::date + interval '1 day'))
         AND ($8::boolean IS NULL OR EXISTS (SELECT 1 FROM public.company_contacts cc WHERE cc.company_id=c.id) = $8)
         AND ($9::boolean IS NULL OR EXISTS (SELECT 1 FROM public.company_order_links col WHERE col.company_id=c.id AND col.unlinked_at IS NULL) = $9)
         AND ($10::text IS NULL OR c.public_id ILIKE '%%'||$10||'%%' OR c.full_name ILIKE '%%'||$10||'%%'
              OR c.short_name ILIKE '%%'||$10||'%%' OR c.unp_normalized ILIKE '%%'||$10||'%%'
              OR c.email ILIKE '%%'||$10||'%%' OR c.phone ILIKE '%%'||$10||'%%')
    )
    SELECT jsonb_build_object('items', COALESCE(jsonb_agg(row_to_json(b) ORDER BY %I %s), '[]'::jsonb),
                              'total', (SELECT count(*) FROM base), 'limit', %s, 'offset', %s)
    FROM (SELECT * FROM base ORDER BY %I %s LIMIT %s OFFSET %s) b
  $f$, v_sort_by, v_sort_dir, v_limit, v_offset, v_sort_by, v_sort_dir, v_limit, v_offset);
  EXECUTE v_sql INTO v_items USING v_incl_merged, v_country, v_profile, v_status, v_kind,
                                   v_created_from, v_created_to, v_has_contacts, v_has_deals, v_q;
  RETURN v_items;
END $$;

REVOKE ALL ON FUNCTION public.search_companies(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.search_companies(jsonb) TO authenticated;
