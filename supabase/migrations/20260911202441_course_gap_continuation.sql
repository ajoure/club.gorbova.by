-- Collect the six still-unattempted windows; preserve the held first result.
CREATE TABLE public.course_gap_continuations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL UNIQUE REFERENCES public.course_caption_gap_audits(id),
  reviewed_by uuid NOT NULL REFERENCES auth.users(id),
  approval_sha256 text NOT NULL CHECK(approval_sha256 ~ '^[a-f0-9]{64}$'),
  held_part_snapshot jsonb NOT NULL CHECK(jsonb_typeof(held_part_snapshot)='object'),
  audit_context jsonb NOT NULL CHECK(jsonb_typeof(audit_context)='object'),
  reason text NOT NULL DEFAULT 'bounded_non_cyrillic_response_received' CHECK(reason='bounded_non_cyrillic_response_received'),
  selected_parts integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6] CHECK(selected_parts=ARRAY[1,2,3,4,5,6]),
  status text NOT NULL DEFAULT 'authorized' CHECK(status IN('authorized','held','collected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.course_gap_evidence_annotations (
  audit_id uuid NOT NULL,
  part_index integer NOT NULL CHECK(part_index BETWEEN 1 AND 6),
  continuation_id uuid NOT NULL REFERENCES public.course_gap_continuations(id),
  text_sha256 text NOT NULL CHECK(text_sha256 ~ '^[a-f0-9]{64}$'),
  alphabet_flag text NOT NULL CHECK(alphabet_flag IN('cyrillic_present','no_cyrillic')),
  evidence_kind text NOT NULL DEFAULT 'unreviewed_asr_evidence' CHECK(evidence_kind='unreviewed_asr_evidence'),
  PRIMARY KEY(audit_id,part_index),
  FOREIGN KEY(audit_id,part_index) REFERENCES public.course_caption_gap_parts(audit_id,part_index)
);
ALTER TABLE public.course_gap_continuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_gap_evidence_annotations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_gap_continuations,public.course_gap_evidence_annotations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.course_gap_continuations,public.course_gap_evidence_annotations TO authenticated;
GRANT ALL ON public.course_gap_continuations,public.course_gap_evidence_annotations TO service_role;
CREATE POLICY owner_read ON public.course_gap_continuations FOR SELECT TO authenticated USING(public.has_role_v2((SELECT auth.uid()),'super_admin'));
CREATE POLICY owner_read ON public.course_gap_evidence_annotations FOR SELECT TO authenticated USING(public.has_role_v2((SELECT auth.uid()),'super_admin'));

CREATE FUNCTION public.course_gap_continue_authorize(_audit_id uuid,_actor uuid,_approval_sha256 text,_source_revision text,_caption_sha256 text,_manifest_sha256 text,_held_text_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.course_caption_gap_audits; p public.course_caption_gap_parts; c public.course_gap_continuations;
BEGIN
  SELECT * INTO a FROM public.course_caption_gap_audits WHERE id=_audit_id FOR UPDATE;
  IF NOT FOUND OR a.status<>'review_required' OR a.expected_parts<>7 OR a.source_revision IS DISTINCT FROM _source_revision
    OR a.caption_sha256 IS DISTINCT FROM _caption_sha256 OR a.manifest_sha256 IS DISTINCT FROM _manifest_sha256 THEN RAISE EXCEPTION 'continuation_context_changed'; END IF;
  IF a.requested_by IS DISTINCT FROM _actor OR NOT coalesce(public.has_role_v2(_actor,'super_admin'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.course_transcription_sources s WHERE s.id=a.source_id AND s.enabled AND s.source_revision=a.source_revision) THEN RAISE EXCEPTION 'source_revision_changed'; END IF;
  SELECT * INTO p FROM public.course_caption_gap_parts WHERE audit_id=a.id AND part_index=0 FOR UPDATE;
  IF NOT FOUND OR p.status<>'uncertain' OR p.attempts<>1 OR p.error_code IS DISTINCT FROM 'asr_outcome_uncertain'
    OR p.asr_text IS NULL OR length(btrim(p.asr_text)) NOT BETWEEN 1 AND 100000 OR p.asr_text ~ '[А-Яа-яЁё]'
    OR p.text_sha256 IS DISTINCT FROM _held_text_sha256 THEN RAISE EXCEPTION 'held_evidence_changed'; END IF;
  SELECT * INTO c FROM public.course_gap_continuations WHERE audit_id=a.id;
  IF FOUND THEN
    IF c.reviewed_by IS DISTINCT FROM _actor OR c.approval_sha256 IS DISTINCT FROM _approval_sha256 OR c.held_part_snapshot IS DISTINCT FROM to_jsonb(p)
      OR c.audit_context IS DISTINCT FROM (to_jsonb(a)-'raw_vtt'-'created_at') THEN RAISE EXCEPTION 'continuation_approval_changed'; END IF;
    RETURN jsonb_build_object('continuation_id',c.id,'status',c.status,'reused',true);
  END IF;
  IF (SELECT count(*) FROM public.course_caption_gap_parts WHERE audit_id=a.id AND part_index BETWEEN 1 AND 6 AND status='pending' AND attempts=0)<>6 THEN RAISE EXCEPTION 'unattempted_selection_required'; END IF;
  INSERT INTO public.course_gap_continuations(audit_id,reviewed_by,approval_sha256,held_part_snapshot,audit_context)
    VALUES(a.id,_actor,_approval_sha256,to_jsonb(p),to_jsonb(a)-'raw_vtt'-'created_at') RETURNING * INTO c;
  RETURN jsonb_build_object('continuation_id',c.id,'status',c.status,'reused',false);
END $$;

CREATE FUNCTION public.course_gap_continue_claim(_continuation_id uuid,_approval_sha256 text,_part_index integer,_audio_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.course_gap_continuations; a public.course_caption_gap_audits; p public.course_caption_gap_parts; token uuid;
BEGIN
  SELECT * INTO c FROM public.course_gap_continuations WHERE id=_continuation_id FOR UPDATE;
  IF NOT FOUND OR c.approval_sha256 IS DISTINCT FROM _approval_sha256 OR _part_index IS NULL OR NOT(_part_index=ANY(c.selected_parts)) THEN RAISE EXCEPTION 'continuation_selection_rejected'; END IF;
  IF NOT coalesce(public.has_role_v2(c.reviewed_by,'super_admin'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
  SELECT * INTO a FROM public.course_caption_gap_audits WHERE id=c.audit_id FOR UPDATE;
  IF c.audit_context IS DISTINCT FROM (to_jsonb(a)-'raw_vtt'-'created_at') THEN RAISE EXCEPTION 'continuation_context_changed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.course_transcription_sources s WHERE s.id=a.source_id AND s.enabled AND s.source_revision=a.source_revision) THEN RAISE EXCEPTION 'source_revision_changed'; END IF;
  IF c.held_part_snapshot IS DISTINCT FROM (SELECT to_jsonb(x) FROM public.course_caption_gap_parts x WHERE audit_id=a.id AND part_index=0) THEN RAISE EXCEPTION 'held_evidence_changed'; END IF;
  SELECT * INTO p FROM public.course_caption_gap_parts WHERE audit_id=a.id AND part_index=_part_index FOR UPDATE;
  IF NOT FOUND OR p.audio_sha256 IS DISTINCT FROM _audio_sha256 THEN RAISE EXCEPTION 'part_audio_changed'; END IF;
  IF p.status='evidence' AND EXISTS(SELECT 1 FROM public.course_gap_evidence_annotations e WHERE e.audit_id=a.id AND e.part_index=p.part_index AND e.continuation_id=c.id AND e.text_sha256=p.text_sha256) THEN RETURN jsonb_build_object('action','cached'); END IF;
  IF EXISTS(SELECT 1 FROM public.course_caption_gap_parts WHERE audit_id=a.id AND part_index=ANY(c.selected_parts) AND status='claimed' AND lease_until<=now()) THEN
    UPDATE public.course_caption_gap_parts SET status='uncertain',error_code='lease_expired',updated_at=now() WHERE audit_id=a.id AND part_index=ANY(c.selected_parts) AND status='claimed' AND lease_until<=now();
    UPDATE public.course_gap_continuations SET status='held' WHERE id=c.id;
    RETURN jsonb_build_object('action','hold');
  END IF;
  IF c.status<>'authorized' OR p.status<>'pending' OR p.attempts<>0 OR EXISTS(SELECT 1 FROM public.course_caption_gap_parts WHERE audit_id=a.id AND part_index=ANY(c.selected_parts) AND status IN('claimed','uncertain')) THEN RETURN jsonb_build_object('action','hold'); END IF;
  token:=gen_random_uuid();
  UPDATE public.course_caption_gap_parts SET status='claimed',attempts=1,claim_token=token,lease_until=now()+interval '10 minutes',updated_at=now() WHERE audit_id=a.id AND part_index=p.part_index;
  RETURN jsonb_build_object('action','transcribe','claim_token',token,'start_ms',p.start_ms,'end_ms',p.end_ms);
END $$;

CREATE FUNCTION public.course_gap_continue_finish(_continuation_id uuid,_part_index integer,_claim_token uuid,_text text,_error_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.course_gap_continuations; a public.course_caption_gap_audits; p public.course_caption_gap_parts; result jsonb; flag text;
BEGIN
  SELECT * INTO c FROM public.course_gap_continuations WHERE id=_continuation_id FOR UPDATE;
  IF NOT FOUND OR _part_index IS NULL OR NOT(_part_index=ANY(c.selected_parts)) THEN RAISE EXCEPTION 'continuation_selection_rejected'; END IF;
  IF NOT coalesce(public.has_role_v2(c.reviewed_by,'super_admin'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
  SELECT * INTO a FROM public.course_caption_gap_audits WHERE id=c.audit_id FOR UPDATE;
  IF c.audit_context IS DISTINCT FROM (to_jsonb(a)-'raw_vtt'-'created_at') THEN RAISE EXCEPTION 'continuation_context_changed'; END IF;
  IF c.held_part_snapshot IS DISTINCT FROM (SELECT to_jsonb(x) FROM public.course_caption_gap_parts x WHERE audit_id=a.id AND part_index=0) THEN RAISE EXCEPTION 'held_evidence_changed'; END IF;
  result:=public.course_gap_finish(c.audit_id,_part_index,_claim_token,_text,_error_code);
  SELECT * INTO p FROM public.course_caption_gap_parts WHERE audit_id=c.audit_id AND part_index=_part_index;
  IF result->>'status'='evidence' THEN
    flag:=CASE WHEN p.asr_text ~ '[А-Яа-яЁё]' THEN 'cyrillic_present' ELSE 'no_cyrillic' END;
    INSERT INTO public.course_gap_evidence_annotations(audit_id,part_index,continuation_id,text_sha256,alphabet_flag)
      VALUES(c.audit_id,p.part_index,c.id,p.text_sha256,flag) ON CONFLICT(audit_id,part_index) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM public.course_gap_evidence_annotations e WHERE e.audit_id=c.audit_id AND e.part_index=p.part_index AND e.continuation_id=c.id AND e.text_sha256=p.text_sha256 AND e.alphabet_flag=flag) THEN RAISE EXCEPTION 'annotation_conflict'; END IF;
    IF c.status='authorized' AND (SELECT count(*) FROM public.course_gap_evidence_annotations WHERE continuation_id=c.id)=6 THEN UPDATE public.course_gap_continuations SET status='collected' WHERE id=c.id; END IF;
  ELSE
    UPDATE public.course_gap_continuations SET status='held' WHERE id=c.id AND status<>'held';
  END IF;
  RETURN result||jsonb_build_object('alphabet_flag',flag,'quality_status','unreviewed');
END $$;
REVOKE ALL ON FUNCTION public.course_gap_continue_authorize(uuid,uuid,text,text,text,text,text),public.course_gap_continue_claim(uuid,text,integer,text),public.course_gap_continue_finish(uuid,integer,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_gap_continue_authorize(uuid,uuid,text,text,text,text,text),public.course_gap_continue_claim(uuid,text,integer,text),public.course_gap_continue_finish(uuid,integer,uuid,text,text) TO service_role;
