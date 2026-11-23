-- SMS is an existing broadcast/funnel transport. No recipients or campaigns are seeded.
CREATE OR REPLACE FUNCTION public.sms_normalize_phone(p_phone text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g') ~ '^\+?[0-9]{8,15}$'
 THEN '+'||ltrim(regexp_replace(p_phone,'[^0-9+]','','g'),'+') END;
$$;
REVOKE ALL ON FUNCTION public.sms_normalize_phone(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_normalize_phone(text) TO service_role;
-- Every existing browser write already goes through websms-send. Durable rows cannot
-- be requeued or stripped of their dispatch key by staff Data API writes.
REVOKE INSERT,UPDATE,DELETE ON public.sms_messages FROM authenticated,anon;
CREATE TABLE public.sms_broadcast_dispatches(
 id uuid PRIMARY KEY, actor_id uuid REFERENCES auth.users(id), request_key text NOT NULL UNIQUE,
 text text NOT NULL CHECK(length(btrim(text)) BETWEEN 1 AND 1000), filters jsonb NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_broadcast_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_broadcast_dispatches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sms_broadcast_dispatches TO authenticated;
GRANT ALL ON public.sms_broadcast_dispatches TO service_role;
CREATE POLICY sms_dispatch_staff_read ON public.sms_broadcast_dispatches FOR SELECT TO authenticated
 USING(public.telegram_funnel_can_manage());
ALTER TABLE public.sms_messages ADD COLUMN dispatch_id uuid REFERENCES public.sms_broadcast_dispatches(id);
ALTER TABLE public.sms_messages ADD COLUMN dispatch_key text;
CREATE UNIQUE INDEX sms_messages_dispatch_key ON public.sms_messages(dispatch_key) WHERE dispatch_key IS NOT NULL;
CREATE INDEX sms_messages_dispatch_queue ON public.sms_messages(created_at,id) WHERE status='queued' AND dispatch_key IS NOT NULL;
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

-- Expand only the existing communication channel checks.
ALTER TABLE public.broadcast_templates DROP CONSTRAINT IF EXISTS broadcast_templates_channel_check;
ALTER TABLE public.broadcast_templates ADD CONSTRAINT broadcast_templates_channel_check CHECK(channel IN('telegram','email','sms'));
ALTER TABLE public.broadcast_templates DROP CONSTRAINT IF EXISTS broadcast_templates_channels_check;
ALTER TABLE public.broadcast_templates ADD CONSTRAINT broadcast_templates_channels_check CHECK(cardinality(channels)>0 AND channels<@ARRAY['telegram','email','sms']::text[]);
ALTER TABLE public.broadcast_runs DROP CONSTRAINT IF EXISTS broadcast_runs_channel_check;
ALTER TABLE public.broadcast_runs ADD CONSTRAINT broadcast_runs_channel_check CHECK(channel IN('telegram','email','sms'));
ALTER TABLE public.broadcast_campaigns DROP CONSTRAINT IF EXISTS broadcast_campaigns_channels_check;
ALTER TABLE public.broadcast_campaigns ADD CONSTRAINT broadcast_campaigns_channels_check CHECK(cardinality(channels)>0 AND channels<@ARRAY['telegram','email','sms']::text[]);
ALTER TABLE public.broadcast_deliveries DROP CONSTRAINT IF EXISTS broadcast_deliveries_channel_check;
ALTER TABLE public.broadcast_deliveries ADD CONSTRAINT broadcast_deliveries_channel_check CHECK(channel IN('telegram','email','sms'));
ALTER TABLE public.telegram_funnel_launches ALTER COLUMN bot_id DROP NOT NULL;
ALTER TABLE public.telegram_funnel_enrollments ALTER COLUMN bot_id DROP NOT NULL;
ALTER TABLE public.telegram_funnel_enrollments ADD COLUMN phone_e164 text;
ALTER TABLE public.sms_messages ADD COLUMN funnel_delivery_id uuid REFERENCES public.telegram_funnel_deliveries(id);
CREATE UNIQUE INDEX sms_messages_one_funnel_delivery ON public.sms_messages(funnel_delivery_id) WHERE funnel_delivery_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.sms_funnel_needs_telegram(p_start uuid,p_blocks jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce((SELECT coalesce(b->>'channel','telegram')='telegram' FROM jsonb_array_elements(p_blocks)b WHERE b->>'id'=p_start::text),true);
$$;
REVOKE ALL ON FUNCTION public.sms_funnel_needs_telegram(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_funnel_needs_telegram(uuid,jsonb) TO service_role;
ALTER TABLE public.telegram_funnel_launches ADD CONSTRAINT telegram_funnel_bot_channel CHECK(bot_id IS NOT NULL OR NOT public.sms_funnel_needs_telegram((graph_snapshot->>'start_block_id')::uuid,graph_snapshot->'blocks'));
CREATE OR REPLACE FUNCTION public.telegram_funnel_validate_graph(p_start uuid,p_blocks jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE b jsonb; btn jsonb; n integer;
BEGIN
 IF jsonb_typeof(p_blocks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_blocks)=0 THEN RAISE EXCEPTION 'funnel_blocks_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_blocks) v WHERE v->>'id'=p_start::text) THEN RAISE EXCEPTION 'funnel_start_invalid'; END IF;
 SELECT count(DISTINCT (v->>'id')::uuid) INTO n FROM jsonb_array_elements(p_blocks) v;
 IF n<>jsonb_array_length(p_blocks) THEN RAISE EXCEPTION 'funnel_duplicate_block'; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
  IF coalesce(b->>'channel','telegram') NOT IN('telegram','sms') THEN RAISE EXCEPTION 'funnel_channel_invalid';END IF;
  IF b->>'channel'='sms' AND(length(coalesce(b->>'text',''))>1000 OR btrim(coalesce(b->>'text',''))='' OR coalesce(b->>'image_path','')<>'' OR jsonb_typeof(b->'buttons') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'buttons')<>0) THEN RAISE EXCEPTION 'funnel_sms_plain_text_required';END IF;
  IF jsonb_typeof(b) IS DISTINCT FROM 'object' OR b->>'id' IS NULL
    OR (b ? 'text' AND jsonb_typeof(b->'text') IS DISTINCT FROM 'string') OR (b ? 'image_path' AND jsonb_typeof(b->'image_path') NOT IN('string','null')) OR length(coalesce(b->>'text',''))>4096
    OR (coalesce(b->>'image_path','')='' AND btrim(coalesce(b->>'text',''))='') THEN RAISE EXCEPTION 'funnel_block_invalid'; END IF;
  IF coalesce(b->>'image_path','')<>'' AND (b->>'image_path' !~ '^[A-Za-z0-9_./-]+$' OR position('..' IN b->>'image_path')>0) THEN RAISE EXCEPTION 'funnel_image_invalid'; END IF;
  IF jsonb_typeof(b->'buttons') IS DISTINCT FROM 'array'  THEN RAISE EXCEPTION 'funnel_buttons_required'; END IF;
  SELECT count(DISTINCT (v->>'id')::uuid) INTO n FROM jsonb_array_elements(b->'buttons') v;
  IF n<>jsonb_array_length(b->'buttons') THEN RAISE EXCEPTION 'funnel_duplicate_button'; END IF;
  FOR btn IN SELECT value FROM jsonb_array_elements(b->'buttons') LOOP
   IF btrim(coalesce(btn->>'text',''))='' OR length(btn->>'text')>64 THEN RAISE EXCEPTION 'funnel_button_invalid'; END IF;
   IF btn->>'kind'='next' THEN
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_blocks) v WHERE v->>'id'=btn->>'target_block_id') THEN RAISE EXCEPTION 'funnel_target_invalid'; END IF;
   ELSIF btn->>'kind'='url' THEN
    IF coalesce(btn->>'url','') !~ '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' THEN RAISE EXCEPTION 'funnel_url_invalid'; END IF;
   ELSIF btn->>'kind'='finish' THEN
    IF btn ? 'tag' AND jsonb_typeof(btn->'tag') NOT IN('string','null') THEN RAISE EXCEPTION 'funnel_finish_tag_invalid'; END IF;
    IF coalesce(btn->>'tag','')<>'' AND(length(btrim(btn->>'tag')) NOT BETWEEN 1 AND 80 OR btn->>'tag' ~ '[[:cntrl:]]' OR btn->>'tag'<>btrim(btn->>'tag')) THEN RAISE EXCEPTION 'funnel_finish_tag_invalid'; END IF;
   ELSE RAISE EXCEPTION 'funnel_button_kind_invalid'; END IF;
  END LOOP;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.telegram_funnel_begin_launch(p_id uuid,p_funnel uuid,p_revision integer,p_bot uuid,p_filters jsonb,p_restart boolean DEFAULT false,p_scheduled_at timestamptz DEFAULT NULL)
RETURNS public.telegram_funnel_launches LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.telegram_funnels; l public.telegram_funnel_launches;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.telegram_funnels WHERE id=p_funnel FOR SHARE;
 IF NOT FOUND OR p_revision IS NULL OR f.status<>'active' OR f.revision<>p_revision THEN RAISE EXCEPTION 'funnel_not_launchable'; END IF;
 PERFORM public.telegram_funnel_validate_graph(f.start_block_id,f.blocks);
 IF public.sms_funnel_needs_telegram(f.start_block_id,f.blocks) AND NOT EXISTS(SELECT 1 FROM public.telegram_bots WHERE id=p_bot AND status='active') THEN RAISE EXCEPTION 'funnel_bot_unavailable'; END IF;
 PERFORM public.telegram_funnel_validate_segment(p_filters);
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_id;
 IF FOUND THEN
  IF l.funnel_id<>p_funnel OR l.bot_id IS DISTINCT FROM p_bot OR l.audience_filters<>p_filters OR l.restart_existing<>p_restart OR l.graph_snapshot->>'revision'<>p_revision::text THEN RAISE EXCEPTION 'funnel_launch_id_conflict'; END IF;
  RETURN l;
 END IF;
 INSERT INTO public.telegram_funnel_launches(id,funnel_id,bot_id,graph_snapshot,audience_filters,restart_existing,created_by,scheduled_for)
 VALUES(p_id,p_funnel,p_bot,jsonb_build_object('revision',f.revision,'start_block_id',f.start_block_id,'blocks',f.blocks),p_filters,p_restart,auth.uid(),coalesce(p_scheduled_at,now())) RETURNING * INTO l;
 -- Every launch freezes recipients atomically, before any transport or cron tick.
 PERFORM public.telegram_funnel_prepare_audience(l.id); SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=l.id;
 RETURN l;
END $$;
CREATE OR REPLACE FUNCTION public.telegram_funnel_begin_self_test(p_id uuid,p_funnel uuid,p_revision integer,p_bot uuid) RETURNS public.telegram_funnel_launches LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.telegram_funnels;l public.telegram_funnel_launches;p public.profiles;filters jsonb:='{"version":1,"root":{"id":"self","kind":"field","field":"status","operator":"eq","value":"active"}}';
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501';END IF;
 SELECT * INTO f FROM public.telegram_funnels WHERE id=p_funnel FOR SHARE;
 IF NOT FOUND OR p_revision IS NULL OR f.revision<>p_revision OR f.status NOT IN('draft','active') THEN RAISE EXCEPTION 'funnel_not_testable';END IF;
 PERFORM public.telegram_funnel_validate_graph(f.start_block_id,f.blocks);
 SELECT * INTO p FROM public.profiles WHERE user_id=auth.uid() AND is_archived IS NOT TRUE AND status IS DISTINCT FROM 'archived' AND merged_to_profile_id IS NULL;
 IF NOT FOUND OR (public.sms_funnel_needs_telegram(f.start_block_id,f.blocks) AND(p.telegram_user_id IS NULL OR NOT public.telegram_funnel_known_dialog(p.id,p_bot) OR NOT EXISTS(SELECT 1 FROM public.telegram_bots WHERE id=p_bot AND status='active'))) OR (NOT public.sms_funnel_needs_telegram(f.start_block_id,f.blocks) AND public.sms_normalize_phone(p.phone) IS NULL) THEN RAISE EXCEPTION 'funnel_self_dialog_required';END IF;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_id;
 IF FOUND THEN IF l.created_by IS DISTINCT FROM auth.uid() OR l.test_profile_id IS DISTINCT FROM p.id OR l.funnel_id<>f.id OR l.bot_id IS DISTINCT FROM p_bot OR l.graph_snapshot->>'revision'<>p_revision::text THEN RAISE EXCEPTION 'funnel_launch_id_conflict';END IF;RETURN l;END IF;
 INSERT INTO public.telegram_funnel_launches(id,funnel_id,bot_id,graph_snapshot,audience_filters,created_by,test_profile_id)
 VALUES(p_id,f.id,p_bot,jsonb_build_object('revision',f.revision,'start_block_id',f.start_block_id,'blocks',f.blocks),filters,auth.uid(),p.id) RETURNING * INTO l;RETURN l;
END $$;
CREATE OR REPLACE FUNCTION public.telegram_funnel_enroll(p_launch uuid,p_profiles uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.telegram_funnel_launches;ids uuid[];new_ids uuid[];immediate boolean;result jsonb;
BEGIN
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_launch FOR UPDATE;
 IF NOT FOUND OR l.status<>'active' THEN RAISE EXCEPTION 'funnel_launch_stopped';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram_funnel_lifecycle:'||l.funnel_id::text,0));
 SELECT coalesce(array_agg(pr.id ORDER BY pr.id),'{}')INTO ids FROM public.profiles pr WHERE pr.id=ANY(p_profiles) AND pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL;
 SELECT coalesce(array_agg(pid ORDER BY pid),'{}')INTO new_ids FROM unnest(ids)pid WHERE NOT EXISTS(SELECT 1 FROM public.telegram_funnel_enrollments en WHERE en.launch_id=l.id AND en.profile_id=pid);
 immediate:=l.scheduled_for<=now();
 IF immediate THEN
  PERFORM 1 FROM public.telegram_funnel_enrollments en WHERE en.funnel_id=l.funnel_id AND en.profile_id=ANY(new_ids) ORDER BY en.profile_id,en.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.telegram_funnel_deliveries d JOIN public.telegram_funnel_enrollments en ON en.id=d.enrollment_id WHERE en.funnel_id=l.funnel_id AND en.profile_id=ANY(new_ids) AND d.status IN('sending','unknown'))THEN RAISE EXCEPTION 'funnel_unresolved_delivery';END IF;
 END IF;
 WITH existing AS MATERIALIZED(SELECT en.id,en.profile_id,d.id delivery_id FROM public.telegram_funnel_enrollments en LEFT JOIN public.telegram_funnel_deliveries d ON d.enrollment_id=en.id AND d.transition_key='start' WHERE en.launch_id=l.id AND en.profile_id=ANY(ids)),
 old_active AS MATERIALIZED(SELECT en.id,en.profile_id FROM public.telegram_funnel_enrollments en WHERE immediate AND en.funnel_id=l.funnel_id AND en.profile_id=ANY(new_ids) AND en.status='active'),
 stopped AS(UPDATE public.telegram_funnel_enrollments en SET status='stopped',reason='explicit_restart',stopped_at=now() FROM old_active o WHERE en.id=o.id AND l.restart_existing RETURNING en.id),
 revoke_old AS(UPDATE public.telegram_funnel_callback_tokens t SET revoked_at=now() WHERE t.enrollment_id IN(SELECT id FROM stopped)),
 skip_old AS(UPDATE public.telegram_funnel_deliveries d SET status='skipped',error_code='explicit_restart' WHERE d.enrollment_id IN(SELECT id FROM stopped) AND d.status='queued'),
 restart_events AS(INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind)SELECT id,'restart:'||l.id::text||':'||id::text,'restarted' FROM stopped ON CONFLICT(event_key)DO NOTHING),
 dialog_tg AS MATERIALIZED(SELECT DISTINCT tm.telegram_user_id FROM public.telegram_messages tm WHERE tm.bot_id=l.bot_id AND tm.transport='bot' AND(tm.direction='incoming' OR tm.status IN('sent','delivered'))),
 admission AS MATERIALIZED(SELECT pr.*,gen_random_uuid()eid,gen_random_uuid()did,o.id old_id,
 CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(l.graph_snapshot->'blocks')b WHERE b->>'id'=l.graph_snapshot->>'start_block_id' AND b->>'channel'='sms') THEN public.sms_normalize_phone(pr.phone) IS NOT NULL AND row_number()OVER(PARTITION BY public.sms_normalize_phone(pr.phone) ORDER BY(pr.user_id IS NOT NULL)DESC,pr.id)=1 ELSE (pr.telegram_user_id>0 AND((pr.telegram_link_bot_id=l.bot_id AND pr.telegram_link_status='active') OR dt.telegram_user_id IS NOT NULL))IS TRUE END has_dialog
 FROM public.profiles pr LEFT JOIN old_active o ON o.profile_id=pr.id LEFT JOIN dialog_tg dt ON dt.telegram_user_id=pr.telegram_user_id CROSS JOIN(SELECT count(*)FROM stopped)stopped_barrier WHERE pr.id=ANY(new_ids)),
 planned AS MATERIALIZED(SELECT a.*,CASE WHEN a.old_id IS NOT NULL AND NOT l.restart_existing THEN 'skipped' WHEN NOT has_dialog THEN 'skipped' WHEN NOT immediate THEN 'scheduled' ELSE 'active' END state,
 CASE WHEN a.old_id IS NOT NULL AND NOT l.restart_existing THEN 'already_active' WHEN NOT has_dialog THEN 'no_available_telegram_dialog' WHEN NOT immediate THEN 'waiting_until_due' ELSE NULL END why FROM admission a),
 inserted AS(INSERT INTO public.telegram_funnel_enrollments(id,launch_id,funnel_id,profile_id,user_id,bot_id,telegram_user_id,chat_id,phone_e164,status,reason)
 SELECT eid,l.id,l.funnel_id,id,user_id,l.bot_id,telegram_user_id,telegram_user_id,public.sms_normalize_phone(phone),state,why FROM planned RETURNING id,profile_id),
 starts AS(INSERT INTO public.telegram_funnel_deliveries(id,enrollment_id,transition_key,block_id)SELECT p.did,i.id,'start',(l.graph_snapshot->>'start_block_id')::uuid FROM planned p JOIN inserted i ON i.id=p.eid WHERE p.state IN('active','scheduled') RETURNING id),
 enroll_events AS(INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind,detail)SELECT i.id,CASE WHEN p.why='already_active' THEN 'skip:' ELSE 'enroll:' END||i.id::text,CASE WHEN p.why='already_active' THEN 'skipped' ELSE 'enrolled' END,CASE WHEN p.why='already_active' THEN jsonb_build_object('reason','already_active')ELSE jsonb_build_object('no_dialog',NOT p.has_dialog)END FROM inserted i JOIN planned p ON p.eid=i.id),
 results AS(SELECT e.profile_id,jsonb_build_object('enrollment_id',e.id,'delivery_id',e.delivery_id,'duplicate',true)v FROM existing e
 UNION ALL SELECT p.id,CASE WHEN p.why='already_active' THEN jsonb_build_object('enrollment_id',i.id,'profile_id',p.id,'skipped','already_active')ELSE jsonb_build_object('enrollment_id',i.id,'delivery_id',CASE WHEN p.state IN('active','scheduled')THEN p.did END,'skipped',NOT p.has_dialog)END FROM inserted i JOIN planned p ON p.eid=i.id CROSS JOIN(SELECT count(*)FROM starts)start_barrier)
 SELECT coalesce(jsonb_agg(v ORDER BY profile_id),'[]')INTO result FROM results;RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.telegram_funnel_activate_due(p_launch uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.telegram_funnel_launches;e public.telegram_funnel_enrollments;old public.telegram_funnel_enrollments;activated integer:=0;batch_ids uuid[];fence_id uuid;
BEGIN
 -- Select a bounded batch, then acquire every launch lock before any lifecycle fence.
 SELECT array_agg(id)INTO batch_ids FROM(SELECT ln.id FROM public.telegram_funnel_launches ln WHERE ln.status='active' AND ln.scheduled_for<=now() AND(p_launch IS NULL OR ln.id=p_launch) AND EXISTS(SELECT 1 FROM public.telegram_funnel_enrollments en WHERE en.launch_id=ln.id AND en.status='scheduled') ORDER BY ln.scheduled_for,ln.id LIMIT 10)due;
 PERFORM 1 FROM public.telegram_funnel_launches WHERE id=ANY(batch_ids)ORDER BY id FOR UPDATE;
 FOR fence_id IN SELECT DISTINCT funnel_id FROM public.telegram_funnel_launches WHERE id=ANY(batch_ids)ORDER BY funnel_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('telegram_funnel_lifecycle:'||fence_id::text,0));
 END LOOP;
 FOR l IN SELECT ln.* FROM public.telegram_funnel_launches ln WHERE ln.id=ANY(batch_ids)AND ln.status='active'AND ln.scheduled_for<=now()ORDER BY ln.scheduled_for,ln.id LOOP
 FOR e IN SELECT en.* FROM public.telegram_funnel_enrollments en WHERE en.launch_id=l.id AND en.status='scheduled' ORDER BY en.profile_id LIMIT 200 LOOP
  SELECT * INTO e FROM public.telegram_funnel_enrollments WHERE id=e.id FOR UPDATE;
  IF e.status<>'scheduled' THEN CONTINUE;END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=e.profile_id AND pr.user_id IS NOT DISTINCT FROM e.user_id AND pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL AND CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(l.graph_snapshot->'blocks')b WHERE b->>'id'=l.graph_snapshot->>'start_block_id' AND b->>'channel'='sms') THEN public.sms_normalize_phone(pr.phone)=e.phone_e164 ELSE pr.telegram_user_id=e.telegram_user_id AND public.telegram_funnel_known_dialog(e.profile_id,l.bot_id) END) THEN
   UPDATE public.telegram_funnel_enrollments SET status='skipped',reason='recipient_binding_changed' WHERE id=e.id;
   UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='recipient_binding_changed' WHERE enrollment_id=e.id AND status='queued';CONTINUE;
  END IF;
  SELECT * INTO old FROM public.telegram_funnel_enrollments WHERE funnel_id=l.funnel_id AND profile_id=e.profile_id AND status='active' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.telegram_funnel_deliveries d JOIN public.telegram_funnel_enrollments en ON en.id=d.enrollment_id WHERE en.funnel_id=l.funnel_id AND en.profile_id=e.profile_id AND d.status IN('sending','unknown')) THEN
   UPDATE public.telegram_funnel_enrollments SET reason='prior_delivery_unresolved' WHERE id=e.id;CONTINUE;
  END IF;
  IF old.id IS NOT NULL AND NOT l.restart_existing THEN
   UPDATE public.telegram_funnel_enrollments SET status='skipped',reason='already_active' WHERE id=e.id;
   UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='already_active' WHERE enrollment_id=e.id AND status='queued';CONTINUE;
  END IF;
  IF old.id IS NOT NULL THEN
   UPDATE public.telegram_funnel_enrollments SET status='stopped',reason='explicit_restart',stopped_at=now() WHERE id=old.id;
   UPDATE public.telegram_funnel_callback_tokens SET revoked_at=now() WHERE enrollment_id=old.id;
   UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='explicit_restart' WHERE enrollment_id=old.id AND status='queued';
   INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind)VALUES(old.id,'restart:'||l.id::text||':'||old.id::text,'restarted')ON CONFLICT(event_key)DO NOTHING;
  END IF;
  UPDATE public.telegram_funnel_enrollments SET status='active',reason=NULL WHERE id=e.id;
  INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind)VALUES(e.id,'activate:'||e.id::text,'activated')ON CONFLICT(event_key)DO NOTHING;
  activated:=activated+1;
 END LOOP;END LOOP;RETURN activated;
END $$;

CREATE OR REPLACE FUNCTION public.sms_funnel_audience(p_segment jsonb,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501';END IF;
 PERFORM public.telegram_funnel_validate_segment(p_segment);
 IF p_offset IS NULL OR p_limit IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'funnel_page_invalid';END IF;
 WITH candidates AS MATERIALIZED(SELECT p.id profile_id,p.user_id,p.full_name,public.sms_normalize_phone(p.phone) phone FROM private.telegram_funnel_matching_profiles(p_segment)m JOIN public.profiles p ON p.id=m), matched AS MATERIALIZED(SELECT c.profile_id,c.user_id,c.full_name,(c.phone IS NOT NULL AND row_number()OVER(PARTITION BY c.phone ORDER BY(c.user_id IS NOT NULL)DESC,c.profile_id)=1) has_dialog FROM candidates c),
 paged AS(SELECT * FROM matched ORDER BY profile_id LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),'available_count',(SELECT count(*) FROM matched WHERE has_dialog),'recipients',coalesce((SELECT jsonb_agg(to_jsonb(pg) ORDER BY profile_id) FROM paged pg),'[]')) INTO result;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sms_funnel_audience(jsonb,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sms_funnel_audience(jsonb,integer,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.sms_funnel_claim_send(p_delivery uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments;d public.telegram_funnel_deliveries;l public.telegram_funnel_launches;b jsonb;lease uuid;sms uuid;
BEGIN
 -- Preserve the Telegram transport lock order: enrollment -> delivery.
 SELECT en.* INTO e FROM public.telegram_funnel_enrollments en JOIN public.telegram_funnel_deliveries ds ON ds.enrollment_id=en.id WHERE ds.id=p_delivery FOR UPDATE OF en;
 SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=p_delivery FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found');END IF;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=e.launch_id;
 IF e.status='scheduled' OR l.scheduled_for>now() THEN RETURN jsonb_build_object('state','scheduled');END IF;
 IF e.status<>'active' OR l.status<>'active' THEN RETURN jsonb_build_object('state','stopped');END IF;
 IF d.status<>'queued' THEN
  IF d.status='sending' AND d.started_at<now()-interval '2 minutes' THEN UPDATE public.telegram_funnel_deliveries SET status='unknown',error_code='interrupted_send' WHERE id=d.id;RETURN jsonb_build_object('state','unknown');END IF;
  RETURN jsonb_build_object('state',d.status);
 END IF;
 SELECT value INTO b FROM jsonb_array_elements(l.graph_snapshot->'blocks') WHERE value->>'id'=d.block_id::text;
 IF b->>'channel' IS DISTINCT FROM 'sms' OR length(coalesce(b->>'text','')) NOT BETWEEN 1 AND 1000 OR jsonb_array_length(b->'buttons')<>0 OR coalesce(b->>'image_path','')<>'' THEN RAISE EXCEPTION 'funnel_sms_plain_text_required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=e.profile_id AND p.user_id IS NOT DISTINCT FROM e.user_id AND p.is_archived IS NOT TRUE AND p.status IS DISTINCT FROM 'archived' AND p.merged_to_profile_id IS NULL AND public.sms_normalize_phone(p.phone)=e.phone_e164) THEN
  UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='recipient_binding_changed' WHERE id=d.id;
  UPDATE public.telegram_funnel_enrollments SET status='error',reason='recipient_binding_changed' WHERE id=e.id;
  RETURN jsonb_build_object('state','recipient_binding_changed');
 END IF;
 lease:=gen_random_uuid();
 INSERT INTO public.sms_messages(contact_id,phone_e164,text,provider,status,initiator_user_id,dispatch_key,funnel_delivery_id)
 VALUES(e.profile_id,e.phone_e164,b->>'text','smsby','sending',l.created_by,'funnel:'||l.id::text||':'||d.block_id::text||':'||e.phone_e164,d.id) ON CONFLICT(dispatch_key)WHERE dispatch_key IS NOT NULL DO NOTHING RETURNING id INTO sms;
 IF sms IS NULL THEN
  UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='duplicate_sms_phone',finished_at=now() WHERE id=d.id;
  UPDATE public.telegram_funnel_enrollments SET status='completed',reason='duplicate_sms_phone' WHERE id=e.id AND status='active';
  INSERT INTO public.telegram_funnel_events(enrollment_id,delivery_id,event_key,kind,detail) VALUES(e.id,d.id,'sms_duplicate:'||d.id::text,'skipped',jsonb_build_object('channel','sms','reason','duplicate_sms_phone'))ON CONFLICT(event_key)DO NOTHING;
  RETURN jsonb_build_object('state','duplicate_sms_phone');
 END IF;
 UPDATE public.telegram_funnel_deliveries SET status='sending',lease_id=lease,started_at=now() WHERE id=d.id;
 RETURN jsonb_build_object('state','claimed','lease_id',lease,'sms_id',sms,'phone',e.phone_e164,'text',b->>'text');
END $$;
CREATE OR REPLACE FUNCTION public.sms_funnel_finish_send(p_delivery uuid,p_lease uuid,p_outcome text,p_external text DEFAULT NULL,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments;d public.telegram_funnel_deliveries;
BEGIN
 SELECT en.* INTO e FROM public.telegram_funnel_enrollments en JOIN public.telegram_funnel_deliveries ds ON ds.enrollment_id=en.id WHERE ds.id=p_delivery FOR UPDATE OF en;
 SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=p_delivery FOR UPDATE;
 IF NOT FOUND OR d.lease_id IS DISTINCT FROM p_lease THEN RAISE EXCEPTION 'funnel_lease_mismatch';END IF;
 IF d.status='sent' THEN RETURN jsonb_build_object('state','sent');END IF;
 IF d.status NOT IN('sending','unknown') OR p_outcome NOT IN('sent','failed','unknown') OR(p_outcome='sent' AND coalesce(p_external,'')='') THEN RAISE EXCEPTION 'funnel_finish_invalid';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sms_messages WHERE funnel_delivery_id=d.id) THEN RAISE EXCEPTION 'funnel_sms_receipt_missing';END IF;
 UPDATE public.sms_messages SET status=p_outcome,external_id=p_external,error=left(p_error,100),updated_at=now() WHERE funnel_delivery_id=d.id;
 UPDATE public.telegram_funnel_deliveries SET status=p_outcome,error_code=left(p_error,100),finished_at=now() WHERE id=d.id;
 IF p_outcome='failed' THEN UPDATE public.telegram_funnel_enrollments SET status='error',reason='delivery_failed' WHERE id=e.id AND status='active';END IF;
 IF p_outcome='sent' THEN
  UPDATE public.telegram_funnel_enrollments SET current_delivery_id=d.id WHERE id=e.id;
  IF e.status='active' AND NOT EXISTS(SELECT 1 FROM public.telegram_funnel_callback_tokens WHERE enrollment_id=e.id AND dispatch_id IS NULL AND revoked_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM public.telegram_funnel_deliveries WHERE enrollment_id=e.id AND status IN('queued','sending','unknown')) THEN UPDATE public.telegram_funnel_enrollments SET status='completed' WHERE id=e.id;END IF;
 END IF;
 INSERT INTO public.telegram_funnel_events(enrollment_id,delivery_id,event_key,kind,detail) VALUES(e.id,d.id,'finish:'||d.id::text||':'||p_outcome,p_outcome,jsonb_build_object('channel','sms','provider_id',p_external,'error_code',left(p_error,100))) ON CONFLICT(event_key)DO NOTHING;
 RETURN jsonb_build_object('state',p_outcome);
END $$;
REVOKE ALL ON FUNCTION public.sms_funnel_claim_send(uuid),public.sms_funnel_finish_send(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_funnel_claim_send(uuid),public.sms_funnel_finish_send(uuid,uuid,text,text,text) TO service_role;

ALTER TABLE public.broadcast_automation_deliveries DROP CONSTRAINT IF EXISTS broadcast_automation_deliveries_channel_check;
ALTER TABLE public.broadcast_automation_deliveries ADD CONSTRAINT broadcast_automation_deliveries_channel_check CHECK(channel IN('email','telegram','sms'));
CREATE OR REPLACE FUNCTION public.queue_site_questionnaire_broadcasts(_submission_id uuid, _channel text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_submission public.site_form_submissions%ROWTYPE; v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_submission FROM public.site_form_submissions WHERE id = _submission_id;
  IF NOT FOUND OR v_submission.status <> 'processed' OR v_submission.metadata->>'questionnaire_first' IS DISTINCT FROM 'true' THEN RETURN; END IF;
  SELECT p.* INTO v_profile FROM public.profiles p JOIN auth.users u ON u.id = p.user_id
  WHERE p.id = v_submission.profile_id AND p.status = 'active' AND NOT coalesce(p.is_archived,false)
    AND p.merged_to_profile_id IS NULL AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until <= now());
  IF NOT FOUND OR v_profile.user_id::text IS DISTINCT FROM v_submission.metadata->>'user_id' THEN RETURN; END IF;
  INSERT INTO public.broadcast_automation_deliveries(template_id,user_id,event_key,channel,available_at)
  SELECT bt.id,v_profile.user_id,
    'site_form:' || v_submission.page_id::text || ':' || (v_submission.metadata->>'block_id') || ':submitted:' || ch.value,
    ch.value, now()+make_interval(mins=>coalesce((bt.metadata->'site_form_condition'->>'delay_minutes')::int,0))
  FROM public.broadcast_templates bt
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN coalesce(array_length(bt.channels,1),0) > 0 THEN to_jsonb(bt.channels) ELSE jsonb_build_array(bt.channel) END
  ) ch(value)
  WHERE bt.trigger_kind = 'site_form_event' AND bt.status = 'recurring' AND bt.approval_status = 'approved'
    AND bt.metadata->'site_form_condition'->>'event' = 'submitted'
    AND public.site_questionnaire_after_cutoff(v_submission.created_at,bt.metadata->'site_form_condition')
    AND bt.metadata->'site_form_condition'->>'page_id' = v_submission.page_id::text
    AND bt.metadata->'site_form_condition'->>'block_id' = v_submission.metadata->>'block_id'
    AND (bt.metadata->'site_form_condition'->>'delay_minutes' IS NULL OR
      CASE WHEN bt.metadata->'site_form_condition'->>'delay_minutes' ~ '^[0-9]{1,5}$' THEN
        (bt.metadata->'site_form_condition'->>'delay_minutes')::int BETWEEN 0 AND 10080 ELSE false END)
    AND ch.value IN ('email','telegram','sms') AND (_channel IS NULL OR ch.value = _channel)
    AND (ch.value = 'email' OR(ch.value='telegram' AND v_profile.telegram_user_id IS NOT NULL) OR(ch.value='sms' AND public.sms_normalize_phone(v_profile.phone) IS NOT NULL))
  ON CONFLICT (template_id,user_id,event_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_site_questionnaire_broadcasts(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_site_questionnaire_broadcasts(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.sms_broadcast_summary(p_dispatch uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('dispatch_id',p_dispatch,'queued',count(*) FILTER(WHERE status='queued'),'sent',count(*) FILTER(WHERE status IN('sent','delivered')),'failed',count(*) FILTER(WHERE status='failed'),'unknown',count(*) FILTER(WHERE status IN('sending','unknown')),'skipped',count(*) FILTER(WHERE status='skipped'),'total',count(*),'sms_ids',coalesce((SELECT jsonb_agg(id) FROM(SELECT id FROM public.sms_messages WHERE dispatch_id=p_dispatch ORDER BY id LIMIT 20)s),'[]'::jsonb),'delivery_status','not_confirmed') FROM public.sms_messages WHERE dispatch_id=p_dispatch;
$$;
REVOKE ALL ON FUNCTION public.sms_broadcast_summary(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_broadcast_summary(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sms_broadcast_audience_count(p_filters jsonb) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(*) FROM public.resolve_sms_broadcast_contacts(p_filters);
$$;
REVOKE ALL ON FUNCTION public.sms_broadcast_audience_count(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_broadcast_audience_count(jsonb) TO service_role;
