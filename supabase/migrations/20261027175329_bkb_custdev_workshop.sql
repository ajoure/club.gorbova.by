-- New private lesson workspace. No changes to purchases, access rules or prior answers.
BEGIN;
DO $migration$
DECLARE definition text; expression text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
  WHERE conrelid='public.lesson_blocks'::regclass AND conname='lesson_blocks_block_type_check' AND convalidated;
  IF definition IS NULL OR left(definition,7)<>'CHECK (' OR right(definition,1)<>')' THEN
    RAISE EXCEPTION 'Unknown lesson block constraint; read-only inspection required';
  END IF;
  IF position('custdev_workshop' IN definition)=0 THEN
    expression := substring(definition FROM 8 FOR length(definition)-8);
    ALTER TABLE public.lesson_blocks DROP CONSTRAINT lesson_blocks_block_type_check;
    EXECUTE 'ALTER TABLE public.lesson_blocks ADD CONSTRAINT lesson_blocks_block_type_check CHECK ((' || expression || ') OR block_type = ''custdev_workshop'')';
  END IF;
END;
$migration$;

CREATE TABLE public.training_custdev_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.lesson_blocks(id) ON DELETE CASCADE,
  state jsonb NOT NULL CHECK(jsonb_typeof(state) IS NOT DISTINCT FROM 'object' AND state->>'version' IS NOT DISTINCT FROM '1'),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','changes_requested')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,block_id)
);
CREATE INDEX training_custdev_lesson_status ON public.training_custdev_workspaces(lesson_id,status);

CREATE TABLE public.training_custdev_ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.training_custdev_workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('quotes','needs','company','positioning','usp')),
  segment_id text,
  target_id text,
  source_hash text NOT NULL,
  workspace_revision integer NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed')),
  model_name text NOT NULL,
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  UNIQUE(workspace_id,request_id)
);
CREATE INDEX training_custdev_ai_budget ON public.training_custdev_ai_runs(user_id,created_at DESC);
CREATE INDEX training_custdev_ai_history ON public.training_custdev_ai_runs(workspace_id,created_at DESC);

CREATE FUNCTION public.custdev_finish_ai_once() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF OLD.status<>'running' OR NEW.status NOT IN ('succeeded','failed') OR NEW.finished_at IS NULL
    OR (NEW.id,NEW.workspace_id,NEW.user_id,NEW.request_id,NEW.action,NEW.segment_id,NEW.target_id,NEW.source_hash,NEW.workspace_revision,NEW.model_name,NEW.created_at)
       IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.user_id,OLD.request_id,OLD.action,OLD.segment_id,OLD.target_id,OLD.source_hash,OLD.workspace_revision,OLD.model_name,OLD.created_at)
    OR (NEW.status='succeeded' AND NEW.result IS NULL) THEN
    RAISE EXCEPTION 'ai_history_immutable';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.custdev_finish_ai_once() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER custdev_finish_ai_once BEFORE UPDATE ON public.training_custdev_ai_runs
FOR EACH ROW EXECUTE FUNCTION public.custdev_finish_ai_once();

CREATE TABLE public.training_custdev_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.training_custdev_workspaces(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  state jsonb NOT NULL,
  status text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,revision)
);

ALTER TABLE public.training_custdev_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_custdev_ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_custdev_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_custdev_workspaces,public.training_custdev_ai_runs,public.training_custdev_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.training_custdev_workspaces,public.training_custdev_ai_runs,public.training_custdev_versions TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.training_custdev_workspaces TO service_role;
GRANT SELECT,INSERT ON public.training_custdev_ai_runs TO service_role;
GRANT UPDATE(status,result,error_code,finished_at) ON public.training_custdev_ai_runs TO service_role;
GRANT SELECT,INSERT ON public.training_custdev_versions TO service_role;

CREATE POLICY custdev_workspace_read ON public.training_custdev_workspaces FOR SELECT TO authenticated USING (
  (user_id=(SELECT auth.uid()) AND public.user_has_training_lesson_access((SELECT auth.uid()),lesson_id))
  OR coalesce(public.has_role_v2((SELECT auth.uid()),'admin'),false)
  OR coalesce(public.has_role_v2((SELECT auth.uid()),'super_admin'),false)
);
CREATE POLICY custdev_ai_read ON public.training_custdev_ai_runs FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.training_custdev_workspaces w WHERE w.id=workspace_id)
);
CREATE POLICY custdev_versions_read ON public.training_custdev_versions FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.training_custdev_workspaces w WHERE w.id=workspace_id)
);
-- Service-only immutable-history/CAS functions. No new SECURITY DEFINER.
CREATE FUNCTION public.custdev_validate_state(p_state jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE s jsonb; q jsonb; g integer; a jsonb; n jsonb; score_group jsonb; score_value jsonb;
BEGIN
  IF jsonb_typeof(p_state) IS DISTINCT FROM 'object' OR p_state->>'version' IS DISTINCT FROM '1'
    OR jsonb_typeof(p_state->'segments') IS DISTINCT FROM 'array' OR jsonb_typeof(p_state->'interviews') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_state->'analyses') IS DISTINCT FROM 'object' OR jsonb_typeof(p_state->'company') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_state->'positioning') IS DISTINCT FROM 'object' OR jsonb_typeof(p_state->'usps') IS DISTINCT FROM 'array'
    OR octet_length(p_state::text)>2500000 THEN RETURN false; END IF;
  FOR s IN SELECT value FROM jsonb_array_elements(p_state->'segments') LOOP
    IF jsonb_typeof(s->'questions') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    FOR g IN 1..7 LOOP
      IF (SELECT count(*) FROM jsonb_array_elements(s->'questions') x WHERE coalesce((x->>'archived')::boolean,false)=false AND (x->>'group')::integer=g)>10 THEN RETURN false; END IF;
    END LOOP;
    FOR q IN SELECT value FROM jsonb_array_elements(s->'questions') LOOP
      IF coalesce((q->>'group')::integer,0) NOT BETWEEN 1 AND 7 OR jsonb_typeof(q->'types') IS DISTINCT FROM 'array' OR jsonb_array_length(q->'types') NOT BETWEEN 1 AND 3
        OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(q->'types') t WHERE t NOT IN ('active','former','prospect')) THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  FOR a IN SELECT value FROM jsonb_each(p_state->'analyses') LOOP
    IF jsonb_typeof(a->'needs') IS DISTINCT FROM 'array' OR jsonb_typeof(a->'quotes') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    FOR n IN SELECT value FROM jsonb_array_elements(a->'needs') LOOP
      IF jsonb_typeof(n->'overrides') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
      FOR score_group IN SELECT value FROM jsonb_each(n) WHERE key IN ('aiOriginal','overrides','approvedValue') AND value<>'null'::jsonb LOOP
        IF jsonb_typeof(score_group) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
        FOR score_value IN SELECT value FROM jsonb_each(score_group) WHERE key IN ('frequency','significance','purchaseImpact','productFit') LOOP
          IF score_value<>'null'::jsonb AND (jsonb_typeof(score_value) IS DISTINCT FROM 'number' OR (score_value::text)::numeric NOT BETWEEN 1 AND 5 OR trunc((score_value::text)::numeric)<>(score_value::text)::numeric) THEN RETURN false; END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION public.custdev_validate_state(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.custdev_validate_state(jsonb) TO service_role;

CREATE FUNCTION public.custdev_save_workspace(
  p_actor uuid,p_owner uuid,p_lesson uuid,p_block uuid,p_expected integer,p_state jsonb,
  p_submit boolean DEFAULT false,p_review text DEFAULT NULL,p_notes text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE w public.training_custdev_workspaces; is_admin boolean; next_status text; result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501'; END IF;
  is_admin:=coalesce(public.has_role_v2(p_actor,'admin'),false) OR coalesce(public.has_role_v2(p_actor,'super_admin'),false);
  IF p_actor IS NULL OR p_owner IS NULL OR p_expected IS NULL OR p_expected<0 OR p_submit IS NULL OR
    (p_review IS NULL AND p_actor IS DISTINCT FROM p_owner) OR
    (p_review IS NOT NULL AND (NOT is_admin OR p_review NOT IN ('approved','changes_requested'))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.lesson_blocks b WHERE b.id=p_block AND b.lesson_id=p_lesson AND b.block_type='custdev_workshop') THEN RAISE EXCEPTION 'block_mismatch'; END IF;
  IF p_review IS NULL AND NOT is_admin AND NOT coalesce(public.user_has_training_lesson_access(p_owner,p_lesson),false) THEN RAISE EXCEPTION 'lesson_access_required' USING ERRCODE='42501'; END IF;
  IF NOT public.custdev_validate_state(p_state) THEN RAISE EXCEPTION 'invalid_state'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_block::text,0));
  SELECT * INTO w FROM public.training_custdev_workspaces WHERE user_id=p_owner AND block_id=p_block FOR UPDATE;
  IF NOT FOUND THEN
    IF p_expected<>0 OR p_review IS NOT NULL THEN RAISE EXCEPTION 'revision_conflict' USING ERRCODE='40001'; END IF;
    INSERT INTO public.training_custdev_workspaces(user_id,lesson_id,block_id,state) VALUES(p_owner,p_lesson,p_block,p_state) RETURNING * INTO w;
  END IF;
  IF w.lesson_id<>p_lesson OR w.revision<>p_expected THEN RAISE EXCEPTION 'revision_conflict' USING ERRCODE='40001'; END IF;
  IF p_review IS NOT NULL THEN
    IF w.status<>'submitted' THEN RAISE EXCEPTION 'submit_before_review'; END IF;
    -- Administrator reviews the persisted submission, never overwrites its answers.
    IF p_state<>w.state THEN RAISE EXCEPTION 'review_cannot_edit_answers'; END IF;
    next_status:=p_review;
  ELSE next_status:=CASE WHEN p_submit THEN 'submitted' ELSE 'draft' END;
  END IF;
  UPDATE public.training_custdev_workspaces SET state=p_state,revision=w.revision+1,status=next_status,
    submitted_at=CASE WHEN p_submit THEN now() WHEN p_review IS NOT NULL THEN w.submitted_at ELSE NULL END,
    reviewed_at=CASE WHEN p_review IS NOT NULL THEN now() ELSE NULL END,
    reviewed_by=CASE WHEN p_review IS NOT NULL THEN p_actor ELSE NULL END,
    review_notes=CASE WHEN p_review IS NOT NULL THEN left(p_notes,10000) ELSE w.review_notes END,updated_at=now()
    WHERE id=w.id RETURNING * INTO w;
  IF p_submit OR p_review IS NOT NULL THEN
    INSERT INTO public.training_custdev_versions(workspace_id,revision,state,status,actor_id,review_notes)
    VALUES(w.id,w.revision,w.state,w.status,p_actor,w.review_notes);
  END IF;
  INSERT INTO public.user_lesson_progress(user_id,lesson_id,block_id,response,is_correct,score,max_score,completed_at,updated_at)
  VALUES(p_owner,p_lesson,p_block,jsonb_build_object('type','custdev_workshop','workspace_id',w.id,'revision',w.revision,'status',w.status,'segments',jsonb_array_length(p_state->'segments'),'interviews',jsonb_array_length(p_state->'interviews')),NULL,0,1,w.submitted_at,now())
  ON CONFLICT(user_id,lesson_id,block_id) DO UPDATE SET response=excluded.response,is_correct=NULL,score=0,max_score=1,completed_at=excluded.completed_at,updated_at=excluded.updated_at;
  INSERT INTO public.lesson_progress_state(user_id,lesson_id,state_json)
  VALUES(p_owner,p_lesson,jsonb_build_object('custdev_workspace_id',w.id))
  ON CONFLICT(user_id,lesson_id) DO UPDATE SET state_json=coalesce(lesson_progress_state.state_json,'{}'::jsonb)||excluded.state_json,updated_at=now();
  result:=to_jsonb(w); RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.custdev_save_workspace(uuid,uuid,uuid,uuid,integer,jsonb,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.custdev_save_workspace(uuid,uuid,uuid,uuid,integer,jsonb,boolean,text,text) TO service_role;

CREATE FUNCTION public.custdev_reserve_ai_run(p_actor uuid,p_workspace uuid,p_request uuid,p_action text,p_segment text,p_target text,p_hash text,p_revision integer,p_model text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE w public.training_custdev_workspaces; r public.training_custdev_ai_runs;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('custdev-ai:'||p_actor::text,0));
  SELECT * INTO w FROM public.training_custdev_workspaces WHERE id=p_workspace;
  IF NOT FOUND OR w.user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.training_custdev_ai_runs WHERE workspace_id=p_workspace AND request_id=p_request;
  IF FOUND THEN
    IF r.action<>p_action OR r.source_hash<>p_hash OR r.segment_id IS DISTINCT FROM p_segment OR r.target_id IS DISTINCT FROM p_target THEN RAISE EXCEPTION 'request_conflict'; END IF;
    RETURN jsonb_build_object('replayed',true,'run',to_jsonb(r));
  END IF;
  IF w.revision<>p_revision THEN RAISE EXCEPTION 'revision_conflict' USING ERRCODE='40001'; END IF;
  IF (SELECT count(*) FROM public.training_custdev_ai_runs WHERE user_id=p_actor AND created_at>now()-interval '1 minute')>=5
    OR (SELECT count(*) FROM public.training_custdev_ai_runs WHERE user_id=p_actor AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=100 THEN
    RAISE EXCEPTION 'ai_rate_limit' USING ERRCODE='54000';
  END IF;
  INSERT INTO public.training_custdev_ai_runs(workspace_id,user_id,request_id,action,segment_id,target_id,source_hash,workspace_revision,model_name)
  VALUES(p_workspace,p_actor,p_request,p_action,p_segment,p_target,p_hash,p_revision,p_model) RETURNING * INTO r;
  RETURN jsonb_build_object('replayed',false,'run',to_jsonb(r));
END;
$fn$;
REVOKE ALL ON FUNCTION public.custdev_reserve_ai_run(uuid,uuid,uuid,text,text,text,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.custdev_reserve_ai_run(uuid,uuid,uuid,text,text,text,text,integer,text) TO service_role;
COMMIT;
