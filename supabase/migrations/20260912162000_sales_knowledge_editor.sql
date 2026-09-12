-- Editable sales summaries, separate from the private transcript quality review.
-- No facts, campaign activation, transcript approvals or access grants are seeded.
CREATE TABLE public.sales_knowledge_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.sales_campaigns(id),
  knowledge_version text NOT NULL,
  facts_sha256 text NOT NULL,
  facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='array'),
  facts_count integer NOT NULL,
  parent_id uuid REFERENCES public.sales_knowledge_versions(id),
  recorded_by uuid NOT NULL REFERENCES auth.users(id),
  approval_scope text NOT NULL CHECK(approval_scope IN ('legacy_snapshot','sales_summaries')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id,knowledge_version),
  CHECK(facts_sha256=encode(sha256(convert_to(facts::text,'UTF8')),'hex')),
  CHECK(facts_count=jsonb_array_length(facts))
);
ALTER TABLE public.sales_knowledge_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_knowledge_versions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.sales_knowledge_versions TO service_role;

-- Read-only validation shared by preview, apply and runtime. Never reads transcript_text.
CREATE FUNCTION public.sales_check_knowledge_facts(p_campaign uuid,p_facts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; f jsonb; output jsonb:='[]'; errors jsonb:='[]';
 seen text[]:='{}'; ident text; scope text; source_uuid uuid; target_id uuid;
 t record; b record; target record; reason text; normalized jsonb;
BEGIN
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign;
 IF NOT FOUND THEN RAISE EXCEPTION 'campaign_missing'; END IF;
 IF p_facts IS NULL OR jsonb_typeof(p_facts)<>'array' OR jsonb_array_length(p_facts)>100
   OR octet_length(p_facts::text)>250000 THEN RAISE EXCEPTION 'invalid_facts_array'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_facts) LOOP
  reason:=NULL; ident:=f->>'id'; scope:=coalesce(f->>'scope','curriculum');
  IF jsonb_typeof(f)<>'object' OR ident IS NULL OR ident !~ '^[A-Za-z0-9_-]{1,100}$'
    OR ident=ANY(seen) THEN reason:='invalid_or_duplicate_id';
  ELSIF scope NOT IN ('curriculum','background') THEN reason:='invalid_scope';
  ELSIF jsonb_typeof(f->'text') IS DISTINCT FROM 'string' OR length(btrim(f->>'text')) NOT BETWEEN 1 AND 600
    OR (f->>'text') ~* '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[<>]|[+][0-9][0-9 ()-]{8,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)'
    OR (f->>'text') ~ '[[:cntrl:]]' THEN reason:='invalid_summary_text';
  ELSIF coalesce(length(f->>'title'),0)>120 OR coalesce(f->>'title','') ~ '[<>[:cntrl:]]' THEN reason:='invalid_title';
  ELSIF coalesce(f->>'source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR coalesce(f->>'source_revision','') !~ '^[a-f0-9]{64}$'
    OR coalesce(f->>'source_sha256','') !~ '^[a-f0-9]{64}$' THEN reason:='invalid_source_reference'; END IF;
  IF reason IS NULL THEN
   source_uuid:=(f->>'source_id')::uuid;
   SELECT s.enabled,s.source_revision,s.provider,s.video_id,
     ct.content_sha256,ct.source_revision transcript_revision,ct.quality_status
    INTO t FROM public.course_transcription_sources s
    JOIN public.course_transcripts ct ON ct.source_id=s.id WHERE s.id=source_uuid;
   IF NOT FOUND OR NOT t.enabled OR t.provider<>'kinescope' OR t.quality_status='rejected'
     OR t.source_revision IS DISTINCT FROM f->>'source_revision'
     OR t.transcript_revision IS DISTINCT FROM t.source_revision
     OR t.content_sha256 IS DISTINCT FROM f->>'source_sha256' THEN reason:='source_unavailable_or_stale';
   ELSIF EXISTS(SELECT 1 FROM public.course_caption_gap_audits a WHERE a.source_id=source_uuid
     AND a.source_revision=t.source_revision AND a.status IN ('pending','review_required')) THEN reason:='source_gap_unresolved'; END IF;
  END IF;
  IF reason IS NULL THEN
   -- A source binding must still describe the same existing video block.
   SELECT cb.block_id,cb.lesson_id,lb.updated_at,lb.content,lb.block_type
    INTO b FROM public.course_transcription_bindings cb
    JOIN public.lesson_blocks lb ON lb.id=cb.block_id AND lb.lesson_id=cb.lesson_id
    JOIN public.training_lessons l ON l.id=cb.lesson_id
    JOIN public.training_modules m ON m.id=l.module_id AND m.product_id=cb.product_id
    WHERE cb.source_id=source_uuid AND cb.block_updated_at=lb.updated_at AND lb.block_type='video'
    ORDER BY cb.block_id LIMIT 1;
   IF NOT FOUND THEN reason:='source_binding_stale'; END IF;
  END IF;
  IF reason IS NULL AND scope='curriculum' THEN
   IF coalesce(f->>'binding_block_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR coalesce(f->>'module_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN reason:='target_reference_required';
   ELSE
    target_id:=(f->>'binding_block_id')::uuid;
    SELECT lb.id,lb.lesson_id,lb.updated_at,lb.content,m.id module_id,m.is_active
     INTO target FROM public.lesson_blocks lb
     JOIN public.training_lessons l ON l.id=lb.lesson_id
     JOIN public.training_modules m ON m.id=l.module_id
     WHERE lb.id=target_id AND lb.block_type='video' AND m.id=(f->>'module_id')::uuid
      AND m.product_id=p.product_id AND m.parent_module_id=(p.knowledge->>'root_module_id')::uuid;
    IF NOT FOUND THEN reason:='target_outside_curriculum';
    ELSIF coalesce(b.content->>'url','')='' OR (target.content->>'url') IS DISTINCT FROM (b.content->>'url')
      OR coalesce(target.content->>'provider','') IS DISTINCT FROM coalesce(b.content->>'provider','')
      THEN reason:='target_video_not_verified'; END IF;
   END IF;
  END IF;
  IF reason IS NOT NULL THEN
   errors:=errors||jsonb_build_array(jsonb_build_object('fact_id',CASE WHEN length(ident)<=100 THEN ident END,'reason',reason));
   CONTINUE;
  END IF;
  seen:=array_append(seen,ident);
  normalized:=jsonb_build_object('id',ident,'title',coalesce(nullif(btrim(f->>'title'),''),ident),
    'text',btrim(f->>'text'),'scope',scope,'classification','sales_safe',
    'source','course_transcripts:'||source_uuid::text,'source_id',source_uuid,
    'source_revision',t.source_revision,'source_sha256',t.content_sha256,
    'text_sha256',encode(sha256(convert_to(btrim(f->>'text'),'UTF8')),'hex'),
    'source_binding_block_id',b.block_id,'source_binding_updated_at',b.updated_at,
    'review_scope','editorial_sales_summary');
  IF scope='curriculum' THEN
   normalized:=normalized||jsonb_build_object('module_id',target.module_id,'binding_block_id',target.id,
     'binding_block_updated_at',target.updated_at,'lesson_id',target.lesson_id);
  END IF;
  output:=output||jsonb_build_array(normalized);
 END LOOP;
 SELECT coalesce(jsonb_agg(value ORDER BY value->>'id'),'[]') INTO output FROM jsonb_array_elements(output);
 RETURN jsonb_build_object('valid',jsonb_array_length(errors)=0,'facts',output,'errors',errors,
   'count',jsonb_array_length(output),'facts_sha256',encode(sha256(convert_to(output::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.sales_check_knowledge_facts(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_check_knowledge_facts(uuid,jsonb) TO service_role;

CREATE FUNCTION public.sales_replace_knowledge_facts(p_campaign uuid,p_actor uuid,p_facts jsonb,
 p_expected_knowledge_version text,p_expected_facts_sha text,p_apply boolean DEFAULT false,p_approved_facts_sha text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; c public.sales_conversations; checked jsonb; before_facts jsonb;
 old_sha text; next_sha text; next_version text; parent uuid; added integer; changed integer; removed integer; result jsonb;
BEGIN
 IF NOT coalesce(public.has_role_v2(p_actor,'super_admin'),false)
  OR NOT coalesce(public.has_admin_section_access(p_actor,'communication','manage'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign FOR UPDATE;
 SELECT * INTO c FROM public.sales_conversations WHERE campaign_id=p_campaign FOR UPDATE;
 IF p.id IS NULL OR c.id IS NULL THEN RAISE EXCEPTION 'campaign_missing'; END IF;
 IF p.mode<>'off' OR NOT c.human_hold OR c.state<>'HUMAN_HOLD' THEN RAISE EXCEPTION 'disable_and_pause_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('sending','unknown')) THEN RAISE EXCEPTION 'delivery_unresolved'; END IF;
 before_facts:=coalesce(p.knowledge->'facts','[]');
 old_sha:=encode(sha256(convert_to(before_facts::text,'UTF8')),'hex');
 IF p_expected_knowledge_version IS DISTINCT FROM p.knowledge_version OR p_expected_facts_sha IS DISTINCT FROM old_sha THEN RAISE EXCEPTION 'knowledge_changed'; END IF;
 checked:=public.sales_check_knowledge_facts(p.id,p_facts);
 IF NOT (checked->>'valid')::boolean THEN RETURN checked-'facts'; END IF;
 next_sha:=checked->>'facts_sha256';
 SELECT count(*) INTO added FROM jsonb_array_elements(checked->'facts') n
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(before_facts) o WHERE o->>'id'=n->>'id');
 SELECT count(*) INTO removed FROM jsonb_array_elements(before_facts) o
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(checked->'facts') n WHERE n->>'id'=o->>'id');
 SELECT count(*) INTO changed FROM jsonb_array_elements(checked->'facts') n
   JOIN jsonb_array_elements(before_facts) o ON o->>'id'=n->>'id' WHERE o IS DISTINCT FROM n;
 result:=(checked-'facts')||jsonb_build_object('added',added,'changed',changed,'removed',removed,
   'unchanged',jsonb_array_length(checked->'facts')-added-changed,'applied',false,'knowledge_version',p.knowledge_version);
 IF p_apply IS DISTINCT FROM true THEN RETURN result; END IF;
 IF p_approved_facts_sha IS DISTINCT FROM next_sha THEN RAISE EXCEPTION 'exact_editorial_approval_required'; END IF;
 IF checked->'facts'=before_facts THEN RETURN result||jsonb_build_object('noop',true); END IF;
 INSERT INTO public.sales_knowledge_versions(campaign_id,knowledge_version,facts_sha256,facts,facts_count,recorded_by,approval_scope)
  VALUES(p.id,p.knowledge_version,old_sha,before_facts,jsonb_array_length(before_facts),p_actor,'legacy_snapshot')
  ON CONFLICT(campaign_id,knowledge_version) DO NOTHING;
 SELECT id INTO parent FROM public.sales_knowledge_versions WHERE campaign_id=p.id AND knowledge_version=p.knowledge_version;
 next_version:='sales-kb:'||gen_random_uuid()::text;
 INSERT INTO public.sales_knowledge_versions(campaign_id,knowledge_version,facts_sha256,facts,facts_count,parent_id,recorded_by,approval_scope)
  VALUES(p.id,next_version,next_sha,checked->'facts',(checked->>'count')::integer,parent,p_actor,'sales_summaries');
 UPDATE public.sales_campaigns SET knowledge_version=next_version,
  knowledge=knowledge||jsonb_build_object('facts',checked->'facts','facts_sha256',next_sha,'editorial_schema',1,'client_release_approved',false)
  WHERE id=p.id;
 UPDATE public.sales_conversations SET revision=revision+1,updated_at=now() WHERE id=c.id;
 UPDATE public.sales_jobs SET status='cancelled',reason='knowledge_facts_replaced' WHERE conversation_id=c.id AND status IN ('queued','claimed');
 INSERT INTO public.sales_events(conversation_id,event,actor_id,details)
  VALUES(c.id,'knowledge_facts_replaced',p_actor,jsonb_build_object('previous_version',p.knowledge_version,
   'next_version',next_version,'before_sha256',old_sha,'after_sha256',next_sha,'before_count',jsonb_array_length(before_facts),'after_count',checked->'count'));
 RETURN result||jsonb_build_object('applied',true,'knowledge_version',next_version);
END $$;
REVOKE ALL ON FUNCTION public.sales_replace_knowledge_facts(uuid,uuid,jsonb,text,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_replace_knowledge_facts(uuid,uuid,jsonb,text,text,boolean,text) TO service_role;

CREATE FUNCTION public.sales_knowledge_snapshot(p_campaign uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; facts jsonb; versions jsonb;
BEGIN
 IF NOT coalesce(public.has_role_v2(p_actor,'super_admin'),false)
  OR NOT coalesce(public.has_admin_section_access(p_actor,'communication','manage'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign;
 IF NOT FOUND THEN RAISE EXCEPTION 'campaign_missing'; END IF;
 facts:=coalesce(p.knowledge->'facts','[]');
 SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') INTO versions FROM
  (SELECT id,created_at,facts_count,approval_scope FROM public.sales_knowledge_versions
   WHERE campaign_id=p.id ORDER BY created_at DESC,id DESC LIMIT 30) v;
 RETURN jsonb_build_object('facts',facts,'knowledge_version',p.knowledge_version,
  'facts_sha256',encode(sha256(convert_to(facts::text,'UTF8')),'hex'),'versions',versions,
  'root_module_id',p.knowledge->>'root_module_id','product_id',p.product_id);
END $$;
REVOKE ALL ON FUNCTION public.sales_knowledge_snapshot(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_knowledge_snapshot(uuid,uuid) TO service_role;
