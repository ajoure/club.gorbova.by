-- CRM bulk deal operations and shared feed context.
-- Additive: existing orders, contact notes/files and company feeds remain valid.

ALTER TABLE public.orders_v2
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsible_user_id uuid,
  ADD COLUMN IF NOT EXISTS source_deal_id uuid REFERENCES public.orders_v2(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creation_batch_id uuid,
  ADD COLUMN IF NOT EXISTS campaign_key text;

CREATE INDEX IF NOT EXISTS orders_v2_company_created_idx
  ON public.orders_v2(company_id, created_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_v2_responsible_stage_idx
  ON public.orders_v2(responsible_user_id, pipeline_stage_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS orders_v2_campaign_subject_idx
  ON public.orders_v2(campaign_key, profile_id, company_id) WHERE campaign_key IS NOT NULL AND is_deleted = false;

-- Preserve the current single-deal form: when it supplies a contact, resolve
-- that contact's canonical company without adding another required UI field.
CREATE OR REPLACE FUNCTION public.crm_order_resolve_company()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $function$
BEGIN
  IF NEW.company_id IS NULL AND NEW.profile_id IS NOT NULL THEN
    SELECT cc.company_id INTO NEW.company_id
      FROM public.company_contacts cc
     WHERE cc.profile_id=NEW.profile_id
     ORDER BY cc.is_primary DESC,cc.is_billing_contact DESC,cc.created_at
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_orders_v2_resolve_company ON public.orders_v2;
CREATE TRIGGER trg_orders_v2_resolve_company BEFORE INSERT OR UPDATE OF profile_id,company_id ON public.orders_v2
FOR EACH ROW EXECUTE FUNCTION public.crm_order_resolve_company();

UPDATE public.orders_v2 o
   SET company_id=(SELECT cc.company_id FROM public.company_contacts cc WHERE cc.profile_id=o.profile_id
     ORDER BY cc.is_primary DESC,cc.is_billing_contact DESC,cc.created_at LIMIT 1)
 WHERE o.company_id IS NULL AND o.profile_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.company_contacts cc WHERE cc.profile_id=o.profile_id);

ALTER TABLE public.contact_notes
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.orders_v2(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
ALTER TABLE public.contact_files
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.orders_v2(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contact_notes_deal_created_idx
  ON public.contact_notes(deal_id, created_at DESC) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contact_files_deal_created_idx
  ON public.contact_files(deal_id, created_at DESC) WHERE deal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crm_deal_action_batches (
  id uuid PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('bulk_move','bulk_create')),
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_count integer NOT NULL DEFAULT 0,
  affected_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_user_id, request_id)
);
ALTER TABLE public.crm_deal_action_batches ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.crm_deal_action_batches TO authenticated;
GRANT ALL ON public.crm_deal_action_batches TO service_role;
DROP POLICY IF EXISTS crm_deal_action_batches_staff_read ON public.crm_deal_action_batches;
CREATE POLICY crm_deal_action_batches_staff_read ON public.crm_deal_action_batches
  FOR SELECT TO authenticated
  USING (actor_user_id = auth.uid() OR has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public.crm_bulk_move_deals(
  _deal_ids uuid[],
  _pipeline_id uuid,
  _stage_id uuid,
  _request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_batch_id uuid := gen_random_uuid();
  v_requested integer := coalesce(cardinality(_deal_ids), 0);
  v_affected integer := 0;
  v_existing jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF v_requested = 0 THEN RAISE EXCEPTION 'empty_selection' USING ERRCODE='22023'; END IF;
  IF _request_id IS NULL THEN RAISE EXCEPTION 'request_id_required' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages
    WHERE id = _stage_id AND pipeline_id = _pipeline_id
  ) THEN RAISE EXCEPTION 'stage_pipeline_mismatch' USING ERRCODE='22023'; END IF;

  SELECT result INTO v_existing FROM public.crm_deal_action_batches
   WHERE actor_user_id = v_uid AND request_id = _request_id;
  IF FOUND THEN RETURN v_existing; END IF;

  INSERT INTO public.crm_deal_action_batches(id,action,actor_user_id,request_id,parameters,requested_count)
  VALUES (v_batch_id,'bulk_move',v_uid,_request_id,
    jsonb_build_object('pipeline_id',_pipeline_id,'stage_id',_stage_id),v_requested);

  WITH before_rows AS (
    SELECT id, pipeline_id AS old_pipeline_id, pipeline_stage_id AS old_stage_id
      FROM public.orders_v2
     WHERE id = ANY(_deal_ids) AND is_deleted = false
     FOR UPDATE
  ), moved AS (
    UPDATE public.orders_v2 o
       SET pipeline_id = _pipeline_id, pipeline_stage_id = _stage_id, updated_at = now()
      FROM before_rows b
     WHERE o.id = b.id
    RETURNING o.id, b.old_pipeline_id, b.old_stage_id
  ), events AS (
    INSERT INTO public.audit_logs(action,actor_type,actor_user_id,entity_type,entity_id,meta)
    SELECT 'deal.pipeline_changed','user',v_uid,'deal',m.id::text,
      jsonb_build_object('batch_id',v_batch_id,'old_pipeline_id',m.old_pipeline_id,
        'old_stage_id',m.old_stage_id,'new_pipeline_id',_pipeline_id,'new_stage_id',_stage_id)
      FROM moved m
    RETURNING 1
  ) SELECT count(*) INTO v_affected FROM events;

  v_existing := jsonb_build_object('batch_id',v_batch_id,'requested',v_requested,'affected',v_affected,
    'skipped',v_requested-v_affected,'pipeline_id',_pipeline_id,'stage_id',_stage_id);
  UPDATE public.crm_deal_action_batches
     SET affected_count=v_affected, skipped_count=v_requested-v_affected, result=v_existing
   WHERE id=v_batch_id;
  RETURN v_existing;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_bulk_move_deals(uuid[],uuid,uuid,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_bulk_move_deals(uuid[],uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_deal_note_create(_deal_id uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_note_id uuid;
  v_profile_id uuid;
  v_company_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (has_role_v2(v_uid,'employee') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin')
      OR has_role_v2(v_uid,'menedzher')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF nullif(btrim(_body),'') IS NULL THEN RAISE EXCEPTION 'empty_body' USING ERRCODE='22023'; END IF;
  SELECT profile_id, company_id INTO v_profile_id, v_company_id
    FROM public.orders_v2 WHERE id=_deal_id AND is_deleted=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'deal_not_found' USING ERRCODE='22023'; END IF;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'deal_contact_required_for_note' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contact_notes(contact_id,author_id,body,deal_id,company_id)
  VALUES(v_profile_id,v_uid,btrim(_body),_deal_id,v_company_id) RETURNING id INTO v_note_id;
  RETURN v_note_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_deal_note_create(uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_deal_note_create(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.deal_feed_list(
  _deal_id uuid,
  _types text[] DEFAULT NULL,
  _search text DEFAULT NULL,
  _limit int DEFAULT 200,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_like text := CASE WHEN nullif(btrim(coalesce(_search,'')),'') IS NULL THEN NULL ELSE '%'||lower(btrim(_search))||'%' END;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (has_role_v2(v_uid,'employee') OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin')
      OR has_role_v2(v_uid,'menedzher')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders_v2 WHERE id=_deal_id AND is_deleted=false) THEN
    RAISE EXCEPTION 'deal_not_found' USING ERRCODE='22023';
  END IF;

  WITH notes AS (
    SELECT n.id::text,'note'::text kind,n.created_at at,'Заметка по сделке'::text title,n.body,
      jsonb_build_object('deal_id',_deal_id,'author_id',n.author_id,'can_delete',n.author_id=v_uid OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin')) meta,
      (SELECT coalesce(p.full_name,p.email) FROM public.profiles p WHERE p.user_id=n.author_id LIMIT 1) author
    FROM public.contact_notes n WHERE n.deal_id=_deal_id AND (_types IS NULL OR 'note'=ANY(_types))
      AND (v_like IS NULL OR lower(n.body) LIKE v_like)
  ), files AS (
    SELECT f.id::text,CASE WHEN f.mime_type LIKE 'audio/%' THEN 'voice_note' ELSE 'file' END,f.created_at,f.name,NULL::text,
      jsonb_build_object('deal_id',_deal_id,'name',f.name,'storage_path',f.storage_path,'url',f.url,'mime_type',f.mime_type,
        'size_bytes',f.size_bytes,'uploader_id',f.uploader_id,'can_delete',f.uploader_id=v_uid OR has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin')),
      (SELECT coalesce(p.full_name,p.email) FROM public.profiles p WHERE p.user_id=f.uploader_id LIMIT 1)
    FROM public.contact_files f WHERE f.deal_id=_deal_id AND (_types IS NULL OR 'file'=ANY(_types) OR 'voice_note'=ANY(_types))
      AND (v_like IS NULL OR lower(f.name) LIKE v_like)
  ), tasks AS (
    SELECT t.id::text,'task'::text,coalesce(t.updated_at,t.created_at),t.title,coalesce(t.result_comment,t.description),
      jsonb_build_object('deal_id',_deal_id,'status',t.status,'due_at',t.due_at,'assignee_user_id',t.assignee_user_id),NULL::text
    FROM public.crm_tasks t WHERE (t.deal_id=_deal_id OR t.order_id=_deal_id) AND (_types IS NULL OR 'task'=ANY(_types))
      AND (v_like IS NULL OR lower(coalesce(t.title,'')) LIKE v_like OR lower(coalesce(t.result_comment,t.description,'')) LIKE v_like)
  ), calls AS (
    SELECT c.id::text,'call'::text,coalesce(c.started_at,c.created_at),'Звонок'::text,coalesce(c.summary,''),
      jsonb_build_object('deal_id',_deal_id,'status',c.status,'direction',c.direction,'duration',c.duration_seconds,
        'recording_url',c.recording_url,'transcript',c.transcript,'summary',c.summary),NULL::text
    FROM public.calls c WHERE c.deal_id=_deal_id AND (_types IS NULL OR 'call'=ANY(_types))
      AND (v_like IS NULL OR lower(coalesce(c.summary,'')) LIKE v_like OR lower(coalesce(c.transcript,'')) LIKE v_like)
  ), sms AS (
    SELECT s.id::text,'sms'::text,s.created_at,
      CASE WHEN s.status='sent' THEN 'SMS отправлено' ELSE 'SMS: '||s.status END,s.text,
      jsonb_build_object('deal_id',_deal_id,'phone',s.phone_e164,'status',s.status,'provider',s.provider),NULL::text
    FROM public.sms_messages s WHERE s.deal_id=_deal_id AND (_types IS NULL OR 'sms'=ANY(_types))
      AND (v_like IS NULL OR lower(coalesce(s.text,'')) LIKE v_like OR lower(coalesce(s.phone_e164,'')) LIKE v_like)
  ), emails AS (
    SELECT e.id::text,'email'::text,e.created_at,
      CASE WHEN e.direction='outgoing' THEN 'Письмо отправлено' WHEN e.direction='incoming' THEN 'Письмо получено' ELSE 'Письмо' END||coalesce(': '||nullif(e.subject,''),''),
      coalesce(e.body_text,regexp_replace(coalesce(e.body_html,''),'<[^>]+>',' ','g')),
      jsonb_build_object('deal_id',_deal_id,'status',e.status,'subject',e.subject,'direction',e.direction),NULL::text
    FROM public.email_logs e WHERE e.meta->>'deal_id'=_deal_id::text AND (_types IS NULL OR 'email'=ANY(_types))
      AND (v_like IS NULL OR lower(coalesce(e.subject,'')) LIKE v_like OR lower(coalesce(e.body_text,'')) LIKE v_like)
  ), events AS (
    SELECT a.id::text,'event'::text,a.created_at,
      CASE WHEN a.action='deal.pipeline_changed' THEN 'Сделка перемещена' ELSE coalesce(a.action,'Событие сделки') END,
      NULL::text,jsonb_build_object('deal_id',_deal_id,'action',a.action,'raw_meta',a.meta),coalesce(a.actor_label,'Система')
    FROM public.audit_logs a WHERE (a.entity_id=_deal_id::text OR a.meta->>'deal_id'=_deal_id::text)
      AND (_types IS NULL OR 'event'=ANY(_types))
      AND (v_like IS NULL OR lower(coalesce(a.action,'')) LIKE v_like OR lower(coalesce(a.meta::text,'')) LIKE v_like)
  ), all_items AS (
    SELECT * FROM notes UNION ALL SELECT * FROM files UNION ALL SELECT * FROM tasks UNION ALL SELECT * FROM calls
    UNION ALL SELECT * FROM sms UNION ALL SELECT * FROM emails UNION ALL SELECT * FROM events
  ) SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.at DESC NULLS LAST),'[]'::jsonb) INTO v_result
    FROM (SELECT * FROM all_items ORDER BY at DESC NULLS LAST LIMIT greatest(1,least(coalesce(_limit,200),500)) OFFSET greatest(coalesce(_offset,0),0)) x;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.deal_feed_list(uuid,text[],text,int,int) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.deal_feed_list(uuid,text[],text,int,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_bulk_create_deals(
  _source_type text,
  _source_ids uuid[],
  _pipeline_id uuid,
  _stage_id uuid,
  _responsible_user_id uuid DEFAULT NULL,
  _title_template text DEFAULT NULL,
  _campaign_key text DEFAULT NULL,
  _task_type_id uuid DEFAULT NULL,
  _task_title text DEFAULT NULL,
  _task_due_at timestamptz DEFAULT NULL,
  _request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_batch_id uuid := gen_random_uuid();
  v_source_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_original public.orders_v2%ROWTYPE;
  v_profile_id uuid;
  v_company_id uuid;
  v_user_id uuid;
  v_email text;
  v_phone text;
  v_subject_name text;
  v_product_id uuid;
  v_tariff_id uuid;
  v_amount numeric;
  v_currency text;
  v_new_id uuid;
  v_created_ids uuid[] := '{}'::uuid[];
  v_skipped jsonb := '[]'::jsonb;
  v_requested int := coalesce(cardinality(_source_ids),0);
  v_existing jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _source_type NOT IN ('contact','company','deal') THEN RAISE EXCEPTION 'invalid_source_type' USING ERRCODE='22023'; END IF;
  IF v_requested=0 THEN RAISE EXCEPTION 'empty_selection' USING ERRCODE='22023'; END IF;
  IF _request_id IS NULL THEN RAISE EXCEPTION 'request_id_required' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_pipeline_stages WHERE id=_stage_id AND pipeline_id=_pipeline_id) THEN
    RAISE EXCEPTION 'stage_pipeline_mismatch' USING ERRCODE='22023';
  END IF;
  SELECT result INTO v_existing FROM public.crm_deal_action_batches WHERE actor_user_id=v_uid AND request_id=_request_id;
  IF FOUND THEN RETURN v_existing; END IF;
  INSERT INTO public.crm_deal_action_batches(id,action,actor_user_id,request_id,parameters,requested_count)
  VALUES(v_batch_id,'bulk_create',v_uid,_request_id,jsonb_build_object('source_type',_source_type,'pipeline_id',_pipeline_id,'stage_id',_stage_id),v_requested);

  FOREACH v_source_id IN ARRAY _source_ids LOOP
    v_profile:=NULL; v_company:=NULL; v_original:=NULL;
    v_profile_id:=NULL; v_company_id:=NULL; v_user_id:=NULL; v_email:=NULL; v_phone:=NULL;
    v_subject_name:=NULL; v_product_id:=NULL; v_tariff_id:=NULL; v_amount:=0; v_currency:='BYN';
    IF _source_type='contact' THEN
      SELECT * INTO v_profile FROM public.profiles WHERE id=v_source_id;
      IF NOT FOUND THEN v_skipped:=v_skipped||jsonb_build_array(jsonb_build_object('id',v_source_id,'reason','contact_not_found')); CONTINUE; END IF;
      v_profile_id:=v_profile.id; v_user_id:=v_profile.user_id; v_email:=v_profile.email; v_phone:=v_profile.phone;
      v_subject_name:=coalesce(nullif(v_profile.full_name,''),v_profile.email,v_profile.phone,'Контакт');
      SELECT cc.company_id INTO v_company_id FROM public.company_contacts cc WHERE cc.profile_id=v_profile.id
        ORDER BY cc.is_primary DESC,cc.is_billing_contact DESC,cc.created_at LIMIT 1;
    ELSIF _source_type='company' THEN
      SELECT * INTO v_company FROM public.companies WHERE id=v_source_id AND status='active';
      IF NOT FOUND THEN v_skipped:=v_skipped||jsonb_build_array(jsonb_build_object('id',v_source_id,'reason','company_not_found')); CONTINUE; END IF;
      v_company_id:=v_company.id; v_subject_name:=v_company.full_name; v_email:=v_company.email; v_phone:=v_company.phone;
      SELECT p.* INTO v_profile FROM public.company_contacts cc JOIN public.profiles p ON p.id=cc.profile_id
       WHERE cc.company_id=v_company.id ORDER BY cc.is_primary DESC,cc.is_billing_contact DESC,cc.created_at LIMIT 1;
      IF FOUND THEN v_profile_id:=v_profile.id; v_user_id:=v_profile.user_id; v_email:=coalesce(v_profile.email,v_email); v_phone:=coalesce(v_profile.phone,v_phone); END IF;
      IF v_profile_id IS NULL THEN
        v_skipped:=v_skipped||jsonb_build_array(jsonb_build_object('id',v_source_id,'reason','company_has_no_contact_person')); CONTINUE;
      END IF;
    ELSE
      SELECT * INTO v_original FROM public.orders_v2 WHERE id=v_source_id AND is_deleted=false;
      IF NOT FOUND THEN v_skipped:=v_skipped||jsonb_build_array(jsonb_build_object('id',v_source_id,'reason','deal_not_found')); CONTINUE; END IF;
      v_profile_id:=v_original.profile_id; v_company_id:=v_original.company_id; v_user_id:=v_original.user_id;
      v_email:=v_original.customer_email; v_phone:=v_original.customer_phone; v_product_id:=v_original.product_id;
      v_tariff_id:=v_original.tariff_id; v_amount:=coalesce(v_original.final_price,0); v_currency:=coalesce(v_original.currency,'BYN');
      v_subject_name:=coalesce(v_original.meta->>'title',v_original.order_number,'Сделка');
    END IF;

    IF _campaign_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.orders_v2 o WHERE o.is_deleted=false AND o.campaign_key=_campaign_key
       AND ((_source_type='company' AND o.company_id=v_company_id) OR (_source_type<>'company' AND o.profile_id=v_profile_id))
    ) THEN
      v_skipped:=v_skipped||jsonb_build_array(jsonb_build_object('id',v_source_id,'reason','active_campaign_duplicate')); CONTINUE;
    END IF;

    v_new_id:=gen_random_uuid();
    INSERT INTO public.orders_v2(id,order_number,user_id,profile_id,company_id,product_id,tariff_id,
      base_price,final_price,currency,status,is_trial,customer_email,customer_phone,pipeline_id,pipeline_stage_id,
      responsible_user_id,source_deal_id,creation_batch_id,campaign_key,deal_date,meta)
    VALUES(v_new_id,'M-'||to_char(now(),'YYMMDD')||'-'||substr(replace(v_new_id::text,'-',''),1,6),v_user_id,v_profile_id,v_company_id,
      v_product_id,v_tariff_id,v_amount,v_amount,v_currency,'pending',false,v_email,v_phone,_pipeline_id,_stage_id,_responsible_user_id,
      CASE WHEN _source_type='deal' THEN v_source_id ELSE NULL END,v_batch_id,nullif(btrim(_campaign_key),''),now(),
      jsonb_build_object('source','admin_bulk','source_type',_source_type,'source_id',v_source_id,'created_by_admin',v_uid,
        'title',replace(coalesce(nullif(_title_template,''),'{{name}}'),'{{name}}',v_subject_name)));
    v_created_ids:=array_append(v_created_ids,v_new_id);
    INSERT INTO public.audit_logs(action,actor_type,actor_user_id,entity_type,entity_id,meta)
    VALUES('admin_bulk_create_deal','user',v_uid,'deal',v_new_id::text,jsonb_build_object('batch_id',v_batch_id,'source_type',_source_type,'source_id',v_source_id));
    IF _task_type_id IS NOT NULL THEN
      PERFORM public.crm_task_create(jsonb_strip_nulls(jsonb_build_object('task_type_id',_task_type_id,'title',coalesce(nullif(_task_title,''),'Первый контакт'),
        'due_at',_task_due_at,'assignee_user_id',_responsible_user_id,'contact_id',v_profile_id,'deal_id',v_new_id,
        'pipeline_id',_pipeline_id,'pipeline_stage_id',_stage_id,'source','manual','meta',jsonb_build_object('creation_batch_id',v_batch_id))));
    END IF;
  END LOOP;
  v_existing:=jsonb_build_object('batch_id',v_batch_id,'requested',v_requested,'created',cardinality(v_created_ids),
    'skipped',jsonb_array_length(v_skipped),'created_ids',to_jsonb(v_created_ids),'skipped_items',v_skipped);
  UPDATE public.crm_deal_action_batches SET affected_count=cardinality(v_created_ids),skipped_count=jsonb_array_length(v_skipped),result=v_existing WHERE id=v_batch_id;
  RETURN v_existing;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_bulk_create_deals(text,uuid[],uuid,uuid,uuid,text,text,uuid,text,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.crm_bulk_create_deals(text,uuid[],uuid,uuid,uuid,text,text,uuid,text,timestamptz,uuid) TO authenticated;
