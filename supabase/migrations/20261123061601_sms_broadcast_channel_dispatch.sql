CREATE OR REPLACE FUNCTION public.resolve_sms_broadcast_contacts(_filters jsonb)
RETURNS TABLE(profile_id uuid, email text, email_normalized text, user_id uuid, has_account boolean, is_archived boolean, has_telegram boolean, full_name text, telegram_username text, phone_e164 text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  _include jsonb := COALESCE(_filters->'include', '[]'::jsonb);
  _exclude jsonb := COALESCE(_filters->'exclude', '[]'::jsonb);
  _club_ids uuid[] := CASE
    WHEN jsonb_typeof(_filters->'club_ids') = 'array'
      THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'club_ids'))::uuid)
    ELSE ARRAY[]::uuid[]
  END;
  _club_membership text := COALESCE(_filters->>'club_membership', 'current');
  _include_archived boolean := COALESCE((_filters->>'include_archived')::boolean, false);
  _system_bypass boolean := COALESCE((_filters->>'__system_bypass')::boolean, false);
  _field text;
  _rule jsonb;
BEGIN
  IF _filters?'hasActiveSubscription' OR _filters?'productId' OR _filters?'productIds' OR _filters?'tariffId' OR _filters?'tariffIds' OR _filters?'clubId' THEN RAISE EXCEPTION 'sms_legacy_filter_unsupported';END IF;
  FOREACH _field IN ARRAY ARRAY['include','exclude'] LOOP
    IF _filters ? _field THEN
      IF jsonb_typeof(_filters->_field) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'sms_filter_invalid'; END IF;
      FOR _rule IN SELECT value FROM jsonb_array_elements(_filters->_field) LOOP
        IF jsonb_typeof(_rule)='string' THEN
          PERFORM (_rule #>> '{}')::uuid;
          IF (_rule #>> '{}') IS NULL THEN RAISE EXCEPTION 'sms_filter_invalid'; END IF;
          CONTINUE;
        END IF;
        IF jsonb_typeof(_rule) IS DISTINCT FROM 'object' OR NOT (_rule?'mode' OR _rule?'product_id')
          OR EXISTS(SELECT 1 FROM jsonb_object_keys(_rule) k WHERE k NOT IN ('mode','product_id','tariff_ids'))
          OR coalesce(_rule->>'mode','purchased') NOT IN ('purchased','active_access')
          OR (_rule?'tariff_ids' AND jsonb_typeof(_rule->'tariff_ids') IS DISTINCT FROM 'array') THEN RAISE EXCEPTION 'sms_filter_invalid'; END IF;
        PERFORM NULLIF(_rule->>'product_id','')::uuid;
        IF _rule?'tariff_ids' THEN
          IF EXISTS(SELECT 1 FROM jsonb_array_elements(_rule->'tariff_ids') v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'sms_filter_invalid'; END IF;
          PERFORM (jsonb_array_elements_text(_rule->'tariff_ids'))::uuid;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF (_filters?'club_ids' AND jsonb_typeof(_filters->'club_ids') IS DISTINCT FROM 'array')
    OR (_filters?'club_membership' AND _club_membership NOT IN ('current','ever','any')) THEN RAISE EXCEPTION 'sms_filter_invalid'; END IF;
  RETURN QUERY
  WITH
  inc_rules AS (
    SELECT
      COALESCE(elem->>'mode','purchased') AS mode,
      NULLIF(elem->>'product_id','')::uuid AS product_id,
      CASE WHEN jsonb_typeof(elem->'tariff_ids')='array' AND jsonb_array_length(elem->'tariff_ids') > 0
        THEN ARRAY(SELECT (jsonb_array_elements_text(elem->'tariff_ids'))::uuid)
        ELSE NULL::uuid[] END AS tariff_ids
    FROM jsonb_array_elements(_include) AS elem
    WHERE jsonb_typeof(elem) = 'object' AND (elem ? 'product_id' OR elem ? 'mode')
  ),
  exc_rules AS (
    SELECT
      COALESCE(elem->>'mode','purchased') AS mode,
      NULLIF(elem->>'product_id','')::uuid AS product_id,
      CASE WHEN jsonb_typeof(elem->'tariff_ids')='array' AND jsonb_array_length(elem->'tariff_ids') > 0
        THEN ARRAY(SELECT (jsonb_array_elements_text(elem->'tariff_ids'))::uuid)
        ELSE NULL::uuid[] END AS tariff_ids
    FROM jsonb_array_elements(_exclude) AS elem
    WHERE jsonb_typeof(elem) = 'object' AND (elem ? 'product_id' OR elem ? 'mode')
  ),
  base_contacts AS (
    SELECT
      p.id AS profile_id,
      p.email,
      lower(nullif(trim(p.email),'')) AS email_normalized,
      p.user_id,
      (p.user_id IS NOT NULL) AS has_account,
      (COALESCE(p.is_archived, false) OR p.status = 'archived') AS is_archived,
      (p.telegram_user_id IS NOT NULL) AS has_telegram,
      p.full_name,
      p.telegram_username, public.sms_normalize_phone(p.phone) AS phone_e164
    FROM public.profiles p
    WHERE public.sms_normalize_phone(p.phone) IS NOT NULL AND p.merged_to_profile_id IS NULL
      AND (jsonb_typeof(_filters->'direct_user_ids') IS DISTINCT FROM 'array' OR p.user_id::text IN(SELECT jsonb_array_elements_text(_filters->'direct_user_ids')))
      AND (jsonb_typeof(_filters->'direct_profile_ids') IS DISTINCT FROM 'array' OR p.id::text IN(SELECT jsonb_array_elements_text(_filters->'direct_profile_ids')))
  ),
  inc_purchased_contacts AS (
    SELECT DISTINCT bc.profile_id
    FROM base_contacts bc
    JOIN public.orders_v2 o
      ON (o.profile_id = bc.profile_id
          OR (bc.user_id IS NOT NULL AND o.user_id = bc.user_id))
    JOIN inc_rules r
      ON r.mode = 'purchased'
     AND (r.product_id IS NULL OR o.product_id = r.product_id)
     AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
    WHERE o.status = 'paid'
      AND COALESCE(o.reconcile_source,'') <> 'rule_engine'
  ),
  inc_active_access_contacts AS (
    SELECT DISTINCT bc.profile_id
    FROM base_contacts bc
    JOIN public.entitlements e ON e.user_id = bc.user_id
    JOIN inc_rules r
      ON r.mode = 'active_access'
     AND (r.product_id IS NULL OR e.product_id = r.product_id)
    WHERE e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
      AND bc.user_id IS NOT NULL
  ),
  inc_all AS (
    SELECT profile_id FROM inc_purchased_contacts
    UNION
    SELECT profile_id FROM inc_active_access_contacts
    UNION
    SELECT bc.profile_id FROM base_contacts bc JOIN jsonb_array_elements(_include) v ON jsonb_typeof(v)='string' AND bc.user_id::text=(v #>> '{}')
  ),
  exc_purchased_contacts AS (
    SELECT DISTINCT bc.profile_id
    FROM base_contacts bc
    JOIN public.orders_v2 o
      ON (o.profile_id = bc.profile_id
          OR (bc.user_id IS NOT NULL AND o.user_id = bc.user_id))
    JOIN exc_rules r
      ON r.mode = 'purchased'
     AND (r.product_id IS NULL OR o.product_id = r.product_id)
     AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
    WHERE o.status = 'paid'
      AND COALESCE(o.reconcile_source,'') <> 'rule_engine'
  ),
  exc_active_access_contacts AS (
    SELECT DISTINCT bc.profile_id
    FROM base_contacts bc
    JOIN public.entitlements e ON e.user_id = bc.user_id
    JOIN exc_rules r
      ON r.mode = 'active_access'
     AND (r.product_id IS NULL OR e.product_id = r.product_id)
    WHERE e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
      AND bc.user_id IS NOT NULL
  ),
  exc_all AS (
    SELECT profile_id FROM exc_purchased_contacts
    UNION
    SELECT profile_id FROM exc_active_access_contacts
    UNION
    SELECT bc.profile_id FROM base_contacts bc JOIN jsonb_array_elements(_exclude) v ON jsonb_typeof(v)='string' AND bc.user_id::text=(v #>> '{}')
  ),
  filtered AS (
    SELECT bc.*
    FROM base_contacts bc
    WHERE
      (jsonb_array_length(_include) = 0
       OR EXISTS (SELECT 1 FROM inc_all i WHERE i.profile_id = bc.profile_id))
    AND
      NOT EXISTS (SELECT 1 FROM exc_all e WHERE e.profile_id = bc.profile_id)
    AND
      (_include_archived OR NOT bc.is_archived)
    AND
      (
        array_length(_club_ids, 1) IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.telegram_club_members tcm
          WHERE tcm.profile_id = bc.profile_id
            AND tcm.club_id = ANY(_club_ids)
            AND (
              (_club_membership = 'current' AND tcm.in_chat = true)
              OR (_club_membership IN ('ever','any'))
            )
        )
      )
  ),
  dedup AS (
    SELECT f.*,
      row_number() OVER (
        PARTITION BY f.phone_e164
        ORDER BY f.has_account DESC, f.is_archived ASC, f.profile_id ASC
      ) AS rn
    FROM filtered f
    WHERE f.phone_e164 IS NOT NULL
  )
  SELECT
    d.profile_id,
    d.email,
    d.email_normalized,
    d.user_id,
    d.has_account,
    d.is_archived,
    d.has_telegram,
    d.full_name,
    d.telegram_username, d.phone_e164
  FROM dedup d
  WHERE d.rn = 1 OR _filters->>'__sms_keep_duplicates'='true';
END;
$function$;


REVOKE ALL ON FUNCTION public.resolve_sms_broadcast_contacts(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_sms_broadcast_contacts(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.sms_broadcast_enqueue(p_id uuid,p_key text,p_actor uuid,p_text text,p_filters jsonb,p_meta jsonb,p_self boolean DEFAULT false,p_eligible uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing public.sms_broadcast_dispatches; added integer;
BEGIN
 IF p_id IS NULL OR length(p_key) NOT BETWEEN 1 AND 300 OR length(btrim(p_text)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'sms_request_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sms_dispatch:'||p_key,0));
 SELECT * INTO existing FROM public.sms_broadcast_dispatches WHERE request_key=p_key;
 IF FOUND THEN
  IF existing.actor_id IS DISTINCT FROM p_actor OR existing.text<>p_text OR existing.filters<>p_filters OR existing.metadata<>p_meta THEN RAISE EXCEPTION 'sms_request_conflict';END IF;
  RETURN jsonb_build_object('dispatch_id',existing.id,'existing',true);
 END IF;
 INSERT INTO public.sms_broadcast_dispatches(id,request_key,actor_id,text,filters,metadata) VALUES(p_id,p_key,p_actor,p_text,p_filters,p_meta);
 IF p_self THEN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'sms_self_profile_required';END IF;
  INSERT INTO public.sms_messages(contact_id,phone_e164,text,provider,status,initiator_user_id,dispatch_id,dispatch_key,metadata)
  SELECT p.id,public.sms_normalize_phone(p.phone),p_text,'smsby','queued',p_actor,p_id,p_key||':'||public.sms_normalize_phone(p.phone),p_meta
  FROM public.profiles p WHERE p.user_id=p_actor AND public.sms_normalize_phone(p.phone) IS NOT NULL AND p.is_archived IS NOT TRUE AND p.status IS DISTINCT FROM 'archived' AND p.merged_to_profile_id IS NULL ORDER BY p.id LIMIT 1;
  GET DIAGNOSTICS added=ROW_COUNT;
  IF added<>1 THEN RAISE EXCEPTION 'sms_self_phone_required';END IF;
 ELSE
  IF (p_filters?'education' OR p_filters?'webinar_registration') AND p_eligible IS NULL THEN RAISE EXCEPTION 'sms_exact_eligibility_required';END IF;
  INSERT INTO public.sms_messages(contact_id,phone_e164,text,provider,status,initiator_user_id,dispatch_id,dispatch_key,metadata)
  SELECT DISTINCT ON(c.phone_e164) c.profile_id,c.phone_e164,p_text,'smsby','queued',p_actor,p_id,p_key||':'||c.phone_e164,p_meta FROM public.resolve_sms_broadcast_contacts(p_filters||jsonb_build_object('__sms_keep_duplicates',true))c WHERE p_eligible IS NULL OR c.profile_id=ANY(p_eligible) ORDER BY c.phone_e164,c.has_account DESC,c.is_archived,c.profile_id;
 END IF;
 RETURN jsonb_build_object('dispatch_id',p_id,'existing',false);
END $$;
CREATE OR REPLACE FUNCTION public.sms_broadcast_claim(p_dispatch uuid DEFAULT NULL,p_limit integer DEFAULT 10)
RETURNS SETOF public.sms_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.sms_messages SET status='unknown',error='interrupted_send',updated_at=now()
 WHERE dispatch_key IS NOT NULL AND status='sending' AND updated_at<now()-interval '2 minutes';
 RETURN QUERY WITH jobs AS(SELECT id FROM public.sms_messages WHERE dispatch_key IS NOT NULL AND status='queued' AND(p_dispatch IS NULL OR dispatch_id=p_dispatch) ORDER BY created_at,id LIMIT least(greatest(p_limit,1),20) FOR UPDATE SKIP LOCKED)
 UPDATE public.sms_messages m SET status='sending',updated_at=now() FROM jobs WHERE m.id=jobs.id RETURNING m.*;
END $$;
REVOKE ALL ON FUNCTION public.sms_broadcast_enqueue(uuid,text,uuid,text,jsonb,jsonb,boolean,uuid[]),public.sms_broadcast_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_broadcast_enqueue(uuid,text,uuid,text,jsonb,jsonb,boolean,uuid[]),public.sms_broadcast_claim(uuid,integer) TO service_role;

