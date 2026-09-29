-- CB21 release settings. No purchase, payment, subscription expiry or public landing edits.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.cb21_has_purchase(u uuid, at_time timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
 SELECT u IS NOT NULL AND (
   public.has_role_v2(u,'admin') OR public.has_role_v2(u,'super_admin') OR public.has_permission(u,'content.manage')
   OR EXISTS(SELECT 1 FROM public.entitlement_sources es WHERE es.user_id=u
     AND es.product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596' AND es.status='active'
     AND es.starts_at<=at_time AND (es.expires_at IS NULL OR es.expires_at>at_time))
   OR EXISTS(SELECT 1 FROM public.subscriptions_v2 s WHERE s.user_id=u
     AND s.product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596'
     AND s.status::text IN ('active','trial','past_due','canceled')
     AND s.access_start_at<=at_time AND (s.access_end_at IS NULL OR s.access_end_at>at_time))
   OR EXISTS(SELECT 1 FROM public.entitlements e WHERE e.user_id=u
     AND e.product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596' AND e.status='active'
     AND (e.expires_at IS NULL OR e.expires_at>at_time)
     AND NOT EXISTS(SELECT 1 FROM public.entitlement_sources es WHERE es.user_id=u AND es.product_id=e.product_id)
     AND NOT EXISTS(SELECT 1 FROM public.subscriptions_v2 s WHERE s.user_id=u AND s.product_id=e.product_id))
 );
$fn$;
REVOKE ALL ON FUNCTION private.cb21_has_purchase(uuid,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.training_module_release_guard(_module_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
 WITH RECURSIVE a AS (
   SELECT id,parent_module_id,product_id,ARRAY[id] seen FROM public.training_modules WHERE id=_module_id
   UNION ALL SELECT m.id,m.parent_module_id,m.product_id,a.seen||m.id
     FROM public.training_modules m JOIN a ON m.id=a.parent_module_id
     WHERE NOT m.id=ANY(a.seen) AND cardinality(a.seen)<50
 ) SELECT NOT EXISTS(SELECT 1 FROM a WHERE id='4365e913-36f1-432e-ab16-748c3ca6826a'
   OR product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596') OR private.cb21_has_purchase(auth.uid(),now());
$fn$;
REVOKE ALL ON FUNCTION public.training_module_release_guard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.training_module_release_guard(uuid) TO anon,authenticated,service_role;
DROP POLICY IF EXISTS cb21_separate_training ON public.training_modules;
CREATE POLICY cb21_separate_training ON public.training_modules AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING(public.training_module_release_guard(id));

-- Internal implementation accepts a clock for isolated boundary tests; not an API.
CREATE OR REPLACE FUNCTION private.cb21_lesson_lock_reason(u uuid, lesson uuid, at_time timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  l public.training_lessons%ROWTYPE;
  chain uuid[];
  chain_open boolean;
  in_scope boolean;
  f public.flows%ROWTYPE;
  starts timestamptz;
  previous_id uuid;
  entitled boolean;
BEGIN
  SELECT * INTO l FROM public.training_lessons WHERE id=lesson;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  WITH RECURSIVE ancestors AS (
    SELECT m.*, ARRAY[m.id] AS seen FROM public.training_modules m WHERE m.id=l.module_id
    UNION ALL
    SELECT m.*, a.seen||m.id FROM public.training_modules m JOIN ancestors a ON m.id=a.parent_module_id
      WHERE NOT m.id=ANY(a.seen) AND cardinality(a.seen)<50
  ) SELECT array_agg(id), bool_and(coalesce(is_active,false) AND (published_at IS NULL OR published_at<=at_time)),
      bool_or(id='4365e913-36f1-432e-ab16-748c3ca6826a'::uuid OR product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid)
    INTO chain,chain_open,in_scope FROM ancestors;
  IF NOT coalesce(in_scope,false) THEN RETURN NULL; END IF;
  IF u IS NULL THEN RETURN 'no_access'; END IF;
  IF public.has_role_v2(u,'admin') OR public.has_role_v2(u,'super_admin') OR public.has_permission(u,'content.manage') THEN RETURN NULL; END IF;
  IF NOT private.cb21_has_purchase(u,at_time) THEN RETURN 'no_access'; END IF;
  SELECT * INTO f FROM public.flows WHERE id='b10e15c5-51c3-5df5-ba83-a42416da5902'
    AND product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596';
  IF NOT FOUND OR NOT f.is_active OR f.start_date IS NULL THEN RETURN 'configuration'; END IF;
  starts := f.start_date::date::timestamp AT TIME ZONE 'Europe/Minsk';
  IF at_time<starts THEN RETURN 'before_start'; END IF;
  IF NOT coalesce(chain_open,false) OR NOT coalesce(l.is_active,false) THEN RETURN 'unpublished'; END IF;
  IF l.published_at>at_time THEN RETURN 'scheduled'; END IF;

  -- Authoritative, current product/tariff pairs; never use another tariff's rules.
  WITH grants AS (
    SELECT es.product_id, es.tariff_id::text tariff_id, es.tariff_id IS NULL manual
    FROM public.entitlement_sources es WHERE es.user_id=u AND es.status='active'
      AND es.starts_at<=at_time AND (es.expires_at IS NULL OR es.expires_at>at_time)
    UNION
    SELECT s.product_id, s.tariff_id::text, false FROM public.subscriptions_v2 s
    WHERE s.user_id=u AND s.status::text IN ('active','trial','past_due','canceled')
      AND s.access_start_at<=at_time AND (s.access_end_at IS NULL OR s.access_end_at>at_time)
    UNION
    SELECT e.product_id, e.meta->>'tariff_id', NOT (coalesce(e.meta,'{}') ? 'tariff_id')
    FROM public.entitlements e WHERE e.user_id=u AND e.status='active'
      AND (e.expires_at IS NULL OR e.expires_at>at_time)
      AND NOT EXISTS(SELECT 1 FROM public.entitlement_sources es WHERE es.user_id=u AND es.product_id=e.product_id)
      AND NOT EXISTS(SELECT 1 FROM public.subscriptions_v2 s WHERE s.user_id=u AND s.product_id=e.product_id)
      AND NOT (coalesce(e.meta,'{}') ? 'scope_resolution_mode')
  ) SELECT EXISTS(
    SELECT 1 FROM grants g WHERE
      (g.product_id=f.product_id AND g.manual)
      OR EXISTS(SELECT 1 FROM public.module_access ma WHERE ma.module_id=ANY(chain) AND ma.tariff_id::text=g.tariff_id)
      OR EXISTS(SELECT 1 FROM public.access_rules ar
        WHERE ar.is_active AND ar.product_id=g.product_id AND (ar.tariff_id IS NULL OR ar.tariff_id::text=g.tariff_id)
          AND ar.grant_target_type='training_content'
          AND (
            (coalesce(ar.conditions->>'access_mode','full')='full' AND
              (ar.target_ref=f.product_id::text OR ar.target_ref=ANY(ARRAY(SELECT x::text FROM unnest(chain) x))))
            OR (ar.conditions->'allowed_lesson_ids') ? l.id::text
            OR EXISTS(SELECT 1 FROM unnest(chain) c WHERE (ar.conditions->'allowed_module_ids') ? c::text)
          ))
  ) INTO entitled;
  IF NOT entitled THEN RETURN 'no_access'; END IF;
  IF l.require_previous THEN
    SELECT p.id INTO previous_id FROM public.training_lessons p
    WHERE p.module_id=l.module_id AND p.is_active
      AND (coalesce(p.sort_order,0),p.id)<(coalesce(l.sort_order,0),l.id)
    ORDER BY coalesce(p.sort_order,0) DESC,p.id DESC LIMIT 1;
    IF previous_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lesson_progress p WHERE p.user_id=u AND p.lesson_id=previous_id)
    THEN RETURN 'previous_lesson'; END IF;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION private.cb21_lesson_lock_reason(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.training_release_guard(_lesson_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT private.cb21_lesson_lock_reason(auth.uid(),_lesson_id,now()) IS NULL;
$fn$;
REVOKE ALL ON FUNCTION public.training_release_guard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.training_release_guard(uuid) TO anon,authenticated,service_role;

DO $wrap$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.user_has_training_lesson_access(uuid,uuid)'::regprocedure) INTO definition;
  definition := replace(definition,'public.user_has_training_lesson_access(', 'private.training_lesson_entitlement_legacy(');
  EXECUTE definition;
END;
$wrap$;
REVOKE ALL ON FUNCTION private.training_lesson_entitlement_legacy(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.user_has_training_lesson_access(_user_id uuid,_lesson_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM public.training_lessons l JOIN public.training_modules m ON m.id=l.module_id
   WHERE l.id=_lesson_id AND m.product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596') THEN
   IF _user_id IS DISTINCT FROM auth.uid() AND coalesce(auth.jwt()->>'role','')<>'service_role'
     AND NOT coalesce(public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'),false)
     THEN RETURN false; END IF;
   RETURN private.cb21_lesson_lock_reason(_user_id,_lesson_id,now()) IS NULL;
 END IF;
 RETURN private.training_lesson_entitlement_legacy(_user_id,_lesson_id)
   AND private.cb21_lesson_lock_reason(_user_id,_lesson_id,now()) IS NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.user_has_training_lesson_access(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_training_lesson_access(uuid,uuid) TO authenticated,service_role;

-- Restrictive policies intersect every permissive path, including KB references.
DROP POLICY IF EXISTS training_release_window ON public.training_lessons;
CREATE POLICY training_release_window ON public.training_lessons AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING(public.training_release_guard(id));
DROP POLICY IF EXISTS training_release_window ON public.lesson_blocks;
CREATE POLICY training_release_window ON public.lesson_blocks AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING(public.training_release_guard(lesson_id));
DROP POLICY IF EXISTS training_release_window ON public.lesson_attachments;
CREATE POLICY training_release_window ON public.lesson_attachments AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING(public.training_release_guard(lesson_id));
DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lesson_progress','lesson_progress_state','user_lesson_progress'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS training_release_insert ON public.%I',t);
    EXECUTE format('CREATE POLICY training_release_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.training_release_guard(lesson_id))',t);
    EXECUTE format('DROP POLICY IF EXISTS training_release_update ON public.%I',t);
    EXECUTE format('CREATE POLICY training_release_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.training_release_guard(lesson_id)) WITH CHECK(public.training_release_guard(lesson_id))',t);
  END LOOP;
END;
$policies$;

CREATE OR REPLACE FUNCTION public.get_training_release_schedule(_module_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH RECURSIVE a AS (
    SELECT id,parent_module_id,product_id,ARRAY[id] seen FROM public.training_modules WHERE id=_module_id
    UNION ALL SELECT m.id,m.parent_module_id,m.product_id,a.seen||m.id
      FROM public.training_modules m JOIN a ON m.id=a.parent_module_id
      WHERE NOT m.id=ANY(a.seen) AND cardinality(a.seen)<50
  ) SELECT jsonb_build_object('flow_id',f.id,'root_module_id','4365e913-36f1-432e-ab16-748c3ca6826a',
      'start_date',f.start_date::date,'starts_at',f.start_date::date::timestamp AT TIME ZONE 'Europe/Minsk',
      'timezone','Europe/Minsk','addon_delay_days',coalesce((f.meta#>>'{learning_gate,addon_delay_days}')::integer,45),
      'addon_mode',coalesce(f.meta#>>'{learning_gate,addon_mode}','scheduled'),
      'addons_open_at',(f.start_date::date + coalesce((f.meta#>>'{learning_gate,addon_delay_days}')::integer,45))::timestamp AT TIME ZONE 'Europe/Minsk',
      'before_start',f.start_date IS NULL OR now()<f.start_date::date::timestamp AT TIME ZONE 'Europe/Minsk',
      'is_active',f.is_active)
    FROM public.flows f WHERE f.id='b10e15c5-51c3-5df5-ba83-a42416da5902'
    AND EXISTS(SELECT 1 FROM a WHERE id='4365e913-36f1-432e-ab16-748c3ca6826a' OR product_id=f.product_id);
$fn$;
REVOKE ALL ON FUNCTION public.get_training_release_schedule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_training_release_schedule(uuid) TO authenticated,service_role;

-- A locked catalogue contains metadata only, never URLs, descriptions or lesson HTML.
CREATE OR REPLACE FUNCTION public.get_training_release_lessons(_module_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF public.get_training_release_schedule(_module_id) IS NULL THEN RETURN NULL; END IF;
  IF NOT private.cb21_has_purchase(auth.uid(),now()) THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(CASE WHEN x.reason IS NULL THEN to_jsonb(x.lesson_row)
    ELSE jsonb_build_object('id',(x.lesson_row).id,'module_id',(x.lesson_row).module_id,'title',(x.lesson_row).title,'slug',(x.lesson_row).slug,
      'sort_order',(x.lesson_row).sort_order,'is_active',(x.lesson_row).is_active,'content_type',(x.lesson_row).content_type,
      'published_at',(x.lesson_row).published_at,'require_previous',(x.lesson_row).require_previous)
    END || jsonb_build_object('release_lock_reason',x.reason) ORDER BY (x.lesson_row).sort_order,(x.lesson_row).id),'[]') INTO result
  FROM (SELECT l AS lesson_row,private.cb21_lesson_lock_reason(auth.uid(),l.id,now()) reason FROM public.training_lessons l
    WHERE l.module_id=_module_id AND l.is_active) x;
  RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_training_release_lessons(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_training_release_lessons(uuid) TO authenticated,service_role;

-- Canonical start is flows.start_date. Synchronize ONLY this flow's delivery configuration.
CREATE OR REPLACE FUNCTION private.sync_cb21_learning_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE delay_days integer; addon_mode text; opens timestamptz;
BEGIN
  IF NEW.id<>'b10e15c5-51c3-5df5-ba83-a42416da5902'::uuid THEN RETURN NEW; END IF;
  IF NEW.product_id<>'2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid OR NEW.start_date IS NULL THEN RAISE EXCEPTION 'invalid_cb21_release_configuration'; END IF;
  delay_days := (NEW.meta#>>'{learning_gate,addon_delay_days}')::integer;
  addon_mode := NEW.meta#>>'{learning_gate,addon_mode}';
  IF delay_days IS NULL OR delay_days<0 OR delay_days>730 OR addon_mode IS NULL OR addon_mode NOT IN ('scheduled','manual') THEN RAISE EXCEPTION 'invalid_cb21_addon_configuration'; END IF;
  opens := (NEW.start_date::date+delay_days)::timestamp AT TIME ZONE 'Europe/Minsk';
  UPDATE public.training_modules SET published_at=NEW.start_date::date::timestamp AT TIME ZONE 'Europe/Minsk'
    WHERE id='4365e913-36f1-432e-ab16-748c3ca6826a';
  UPDATE public.offer_addons a SET access_delivery_mode=CASE WHEN addon_mode='manual' THEN 'manual' ELSE 'fixed_date' END,
    access_opens_at=CASE WHEN addon_mode='manual' THEN NULL ELSE opens END
    FROM public.tariff_offers o JOIN public.tariffs t ON t.id=o.tariff_id
    WHERE a.parent_offer_id=o.id AND t.product_id=NEW.product_id AND a.is_active AND o.is_active
      AND NOT coalesce((o.meta->>'sales_legacy_only')::boolean,false);
  IF EXISTS(SELECT 1 FROM public.scheduled_product_access spa WHERE spa.status='activating'
    AND EXISTS(SELECT 1 FROM public.order_group_items primary_item WHERE primary_item.order_group_id=spa.order_group_id
      AND primary_item.role='primary' AND primary_item.product_id=NEW.product_id))
  THEN RAISE EXCEPTION 'cb21_addon_activation_in_progress'; END IF;
  -- Only pending purchase snapshots; paid history and independently purchased modules are immutable here.
  UPDATE public.order_group_items item SET item_snapshot=coalesce(item.item_snapshot,'{}')||jsonb_build_object(
    'access_delivery_mode',CASE WHEN addon_mode='manual' THEN 'manual' ELSE 'fixed_date' END,
    'access_opens_at',CASE WHEN addon_mode='manual' THEN NULL ELSE opens END)
    FROM public.orders_v2 o WHERE o.id=item.order_id AND o.status::text IN ('pending','draft') AND item.role='addon'
      AND EXISTS(SELECT 1 FROM public.order_group_items primary_item WHERE primary_item.order_group_id=item.order_group_id
        AND primary_item.role='primary' AND primary_item.product_id=NEW.product_id);
  UPDATE public.scheduled_product_access spa SET
    access_delivery_mode=CASE WHEN addon_mode='manual' THEN 'manual' ELSE 'fixed_date' END,
    opens_at=CASE WHEN addon_mode='manual' THEN NULL ELSE opens END,updated_at=now()
    WHERE spa.status IN ('scheduled','failed') AND EXISTS(
      SELECT 1 FROM public.order_group_items primary_item WHERE primary_item.order_group_id=spa.order_group_id
        AND primary_item.role='primary' AND primary_item.product_id=NEW.product_id);
  INSERT INTO public.audit_logs(action,actor_type,actor_user_id,entity_type,entity_id,meta)
    VALUES('cb21.learning_release_updated',CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'admin' END,
      auth.uid(),'flow',NEW.id::text,jsonb_build_object('old_start',OLD.start_date,'new_start',NEW.start_date,
        'old_learning_gate',OLD.meta->'learning_gate','new_learning_gate',NEW.meta->'learning_gate'));
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.sync_cb21_learning_release() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sync_cb21_learning_release ON public.flows;
CREATE TRIGGER sync_cb21_learning_release AFTER UPDATE OF start_date,meta ON public.flows
FOR EACH ROW EXECUTE FUNCTION private.sync_cb21_learning_release();

-- Reconcile delayed fulfillment with current course settings, even for an old pending snapshot.
CREATE OR REPLACE FUNCTION private.configure_cb21_scheduled_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE f public.flows%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.order_group_items i WHERE i.order_group_id=NEW.order_group_id
   AND i.role='primary' AND i.product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596') THEN RETURN NEW; END IF;
 SELECT * INTO f FROM public.flows WHERE id='b10e15c5-51c3-5df5-ba83-a42416da5902';
 IF f.start_date IS NULL OR f.meta#>>'{learning_gate,addon_mode}' IS NULL THEN RAISE EXCEPTION 'cb21_schedule_missing'; END IF;
 NEW.access_delivery_mode := CASE WHEN f.meta#>>'{learning_gate,addon_mode}'='manual' THEN 'manual' ELSE 'fixed_date' END;
 NEW.opens_at := CASE WHEN NEW.access_delivery_mode='manual' THEN NULL ELSE
   (f.start_date::date+(f.meta#>>'{learning_gate,addon_delay_days}')::integer)::timestamp AT TIME ZONE 'Europe/Minsk' END;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.configure_cb21_scheduled_access() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS configure_cb21_scheduled_access ON public.scheduled_product_access;
CREATE TRIGGER configure_cb21_scheduled_access BEFORE INSERT ON public.scheduled_product_access
FOR EACH ROW EXECUTE FUNCTION private.configure_cb21_scheduled_access();

CREATE OR REPLACE FUNCTION public.set_training_release_schedule(_flow_id uuid,_start_date date,_addon_delay_days integer,_addon_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT(public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin')) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _flow_id<>'b10e15c5-51c3-5df5-ba83-a42416da5902'::uuid OR _start_date IS NULL
    OR _addon_delay_days IS NULL OR _addon_delay_days NOT BETWEEN 0 AND 730
    OR _addon_mode IS NULL OR _addon_mode NOT IN ('scheduled','manual') THEN RAISE EXCEPTION 'invalid_release_configuration'; END IF;
  UPDATE public.flows SET start_date=_start_date,
    meta=jsonb_set(coalesce(meta,'{}'),'{learning_gate}',jsonb_build_object(
      'root_module_id','4365e913-36f1-432e-ab16-748c3ca6826a','timezone','Europe/Minsk',
      'addon_delay_days',_addon_delay_days,'addon_mode',_addon_mode)),updated_at=now()
    WHERE id=_flow_id;
  RETURN public.get_training_release_schedule('4365e913-36f1-432e-ab16-748c3ca6826a');
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_training_release_schedule(uuid,date,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_training_release_schedule(uuid,date,integer,text) TO authenticated;

DO $seed$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cb21-learning-release',0));
  IF NOT EXISTS(SELECT 1 FROM public.flows WHERE id='b10e15c5-51c3-5df5-ba83-a42416da5902'
    AND product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596' AND start_date::date='2026-10-23'
    AND end_date::date='2026-12-10') THEN RAISE EXCEPTION 'cb21_flow_preflight_drift'; END IF;
  IF (SELECT count(*) FROM public.offer_addons a JOIN public.tariff_offers o ON o.id=a.parent_offer_id
    JOIN public.tariffs t ON t.id=o.tariff_id WHERE t.product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596'
      AND a.is_active AND o.is_active AND NOT coalesce((o.meta->>'sales_legacy_only')::boolean,false))<>128
    THEN RAISE EXCEPTION 'cb21_addon_catalogue_count_drift'; END IF;
  IF EXISTS(SELECT 1 FROM public.scheduled_product_access spa JOIN public.order_group_items i ON i.order_group_id=spa.order_group_id
    WHERE i.role='primary' AND i.product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596')
    THEN RAISE EXCEPTION 'cb21_scheduled_access_preflight_drift'; END IF;
  UPDATE public.flows SET start_date='2026-09-30',
    meta=jsonb_set(coalesce(meta,'{}'),'{learning_gate}',jsonb_build_object(
      'root_module_id','4365e913-36f1-432e-ab16-748c3ca6826a','timezone','Europe/Minsk','addon_delay_days',45,'addon_mode','scheduled')),
    updated_at=now() WHERE id='b10e15c5-51c3-5df5-ba83-a42416da5902';
  IF (SELECT count(*) FROM public.offer_addons a JOIN public.tariff_offers o ON o.id=a.parent_offer_id
    JOIN public.tariffs t ON t.id=o.tariff_id WHERE t.product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596'
      AND a.is_active AND o.is_active AND NOT coalesce((o.meta->>'sales_legacy_only')::boolean,false)
      AND a.access_delivery_mode='fixed_date' AND a.access_opens_at='2026-11-13T21:00:00Z')<>128
    THEN RAISE EXCEPTION 'cb21_addon_readback_failed'; END IF;
END;
$seed$;
COMMIT;
