-- Sparse caption-gap evidence. Does not create or finalize full-course jobs.
CREATE TABLE public.course_caption_gap_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.course_transcription_sources(id),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  source_revision text NOT NULL CHECK(source_revision ~ '^[a-f0-9]{64}$'),
  caption_sha256 text NOT NULL CHECK(caption_sha256 ~ '^[a-f0-9]{64}$'),
  raw_vtt text NOT NULL CHECK(length(raw_vtt) BETWEEN 1 AND 10000000),
  manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
  expected_parts integer NOT NULL CHECK(expected_parts BETWEEN 1 AND 7),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','evidence','review_required')),
  classification text NOT NULL DEFAULT 'paid_private' CHECK(classification='paid_private'),
  quality_status text NOT NULL DEFAULT 'unreviewed' CHECK(quality_status='unreviewed'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id,caption_sha256),
  CHECK(caption_sha256=encode(sha256(convert_to(raw_vtt,'UTF8')),'hex'))
);
CREATE TABLE public.course_caption_gap_parts (
  audit_id uuid NOT NULL REFERENCES public.course_caption_gap_audits(id),
  part_index integer NOT NULL CHECK(part_index BETWEEN 0 AND 6),
  gap_index integer NOT NULL CHECK(gap_index BETWEEN 0 AND 6),
  start_ms bigint NOT NULL CHECK(start_ms>=0),
  end_ms bigint NOT NULL,
  audio_sha256 text NOT NULL CHECK(audio_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','claimed','evidence','uncertain')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),
  claim_token uuid,
  lease_until timestamptz,
  asr_text text CHECK(length(asr_text)<=100000),
  text_sha256 text,
  error_code text CHECK(length(error_code)<=80),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(audit_id,part_index),
  CHECK((asr_text IS NULL AND text_sha256 IS NULL) OR (asr_text IS NOT NULL AND text_sha256 IS NOT NULL AND text_sha256=encode(sha256(convert_to(asr_text,'UTF8')),'hex'))),
  CHECK(end_ms>start_ms AND end_ms<=start_ms+90000),
  CHECK(status<>'claimed' OR (attempts=1 AND claim_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK(status<>'evidence' OR (asr_text IS NOT NULL AND text_sha256 IS NOT NULL AND length(btrim(asr_text))>0 AND text_sha256=encode(sha256(convert_to(asr_text,'UTF8')),'hex')))
);
ALTER TABLE public.course_caption_gap_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_caption_gap_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_caption_gap_audits,public.course_caption_gap_parts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.course_caption_gap_audits,public.course_caption_gap_parts TO authenticated;
GRANT ALL ON public.course_caption_gap_audits,public.course_caption_gap_parts TO service_role;
CREATE POLICY owner_read ON public.course_caption_gap_audits FOR SELECT TO authenticated USING(public.has_role_v2((SELECT auth.uid()),'super_admin'));
CREATE POLICY owner_read ON public.course_caption_gap_parts FOR SELECT TO authenticated USING(public.has_role_v2((SELECT auth.uid()),'super_admin'));

CREATE FUNCTION public.course_gap_audit_create(_source_id uuid,_actor uuid,_source_revision text,_raw_vtt text,_caption_sha256 text,_manifest_sha256 text,_parts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.course_transcription_sources; a public.course_caption_gap_audits; n integer; p jsonb;
  idx integer:=0; previous_end bigint:=-1; total_ms bigint:=0;
BEGIN
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=_source_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled OR s.source_revision IS DISTINCT FROM _source_revision THEN RAISE EXCEPTION 'source_revision_changed'; END IF;
  IF NOT coalesce(public.has_role_v2(_actor,'super_admin'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
  IF _raw_vtt IS NULL OR _caption_sha256 IS DISTINCT FROM encode(sha256(convert_to(_raw_vtt,'UTF8')),'hex') THEN RAISE EXCEPTION 'caption_hash_mismatch'; END IF;
  IF jsonb_typeof(_parts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'parts_required'; END IF;
  n:=jsonb_array_length(_parts);
  IF n<1 OR n>7 THEN RAISE EXCEPTION 'gap_budget'; END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(_parts) LOOP
    IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>5
      OR NOT(p ?& ARRAY['part_index','gap_index','start_ms','end_ms','audio_sha256'])
      OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.value='null'::jsonb)
      OR (p->>'part_index')::integer IS DISTINCT FROM idx
      OR (p->>'gap_index')::integer NOT BETWEEN 0 AND 6
      OR (p->>'start_ms')::bigint<0 OR (p->>'start_ms')::bigint<previous_end
      OR (p->>'end_ms')::bigint<= (p->>'start_ms')::bigint
      OR (p->>'end_ms')::bigint> (p->>'start_ms')::bigint+90000
      OR (p->>'end_ms')::bigint>s.duration_ms+1000
      OR coalesce(p->>'audio_sha256','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'gap_part_invalid'; END IF;
    total_ms:=total_ms+(p->>'end_ms')::bigint-(p->>'start_ms')::bigint;
    previous_end:=(p->>'end_ms')::bigint;idx:=idx+1;
  END LOOP;
  IF total_ms>600000 THEN RAISE EXCEPTION 'gap_budget'; END IF;
  SELECT * INTO a FROM public.course_caption_gap_audits WHERE source_id=s.id AND caption_sha256=_caption_sha256;
  IF FOUND THEN
    IF a.manifest_sha256 IS DISTINCT FROM _manifest_sha256 OR a.source_revision IS DISTINCT FROM _source_revision
      OR a.raw_vtt IS DISTINCT FROM _raw_vtt OR a.expected_parts<>n
      OR (SELECT jsonb_agg(jsonb_build_object('part_index',part_index,'gap_index',gap_index,'start_ms',start_ms,'end_ms',end_ms,'audio_sha256',audio_sha256) ORDER BY part_index)
        FROM public.course_caption_gap_parts WHERE audit_id=a.id) IS DISTINCT FROM _parts
      THEN RAISE EXCEPTION 'gap_manifest_conflict'; END IF;
    RETURN jsonb_build_object('audit_id',a.id,'status',a.status,'reused',true);
  END IF;
  INSERT INTO public.course_caption_gap_audits(source_id,requested_by,source_revision,caption_sha256,raw_vtt,manifest_sha256,expected_parts)
    VALUES(s.id,_actor,_source_revision,_caption_sha256,_raw_vtt,_manifest_sha256,n) RETURNING * INTO a;
  INSERT INTO public.course_caption_gap_parts(audit_id,part_index,gap_index,start_ms,end_ms,audio_sha256)
    SELECT a.id,(x->>'part_index')::integer,(x->>'gap_index')::integer,(x->>'start_ms')::bigint,(x->>'end_ms')::bigint,x->>'audio_sha256'
      FROM jsonb_array_elements(_parts) x;
  RETURN jsonb_build_object('audit_id',a.id,'status',a.status,'reused',false);
END $$;

CREATE FUNCTION public.course_gap_claim(_audit_id uuid,_part_index integer,_audio_sha256 text,_manifest_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.course_caption_gap_audits; p public.course_caption_gap_parts; token uuid;
BEGIN
  SELECT * INTO a FROM public.course_caption_gap_audits WHERE id=_audit_id FOR UPDATE;
  IF NOT FOUND OR a.manifest_sha256 IS DISTINCT FROM _manifest_sha256 THEN RAISE EXCEPTION 'gap_manifest_conflict'; END IF;
  IF NOT coalesce(public.has_role_v2(a.requested_by,'super_admin'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.course_transcription_sources s WHERE s.id=a.source_id AND s.enabled AND s.source_revision=a.source_revision) THEN RAISE EXCEPTION 'source_revision_changed'; END IF;
  SELECT * INTO p FROM public.course_caption_gap_parts WHERE audit_id=a.id AND part_index=_part_index FOR UPDATE;
  IF NOT FOUND OR p.audio_sha256 IS DISTINCT FROM _audio_sha256 THEN RAISE EXCEPTION 'part_audio_changed'; END IF;
  IF p.status='evidence' THEN RETURN jsonb_build_object('action','cached'); END IF;
  IF p.status='claimed' AND p.lease_until<=now() THEN
    UPDATE public.course_caption_gap_parts SET status='uncertain',error_code='lease_expired',updated_at=now() WHERE audit_id=a.id AND part_index=_part_index;
    UPDATE public.course_caption_gap_audits SET status='review_required' WHERE id=a.id;
    RETURN jsonb_build_object('action','hold','status','uncertain');
  END IF;
  IF a.status='review_required' OR p.status<>'pending' THEN RETURN jsonb_build_object('action','hold','status',p.status); END IF;
  token:=gen_random_uuid();
  UPDATE public.course_caption_gap_parts SET status='claimed',attempts=1,claim_token=token,lease_until=now()+interval '10 minutes',updated_at=now() WHERE audit_id=a.id AND part_index=_part_index;
  RETURN jsonb_build_object('action','transcribe','claim_token',token,'start_ms',p.start_ms,'end_ms',p.end_ms);
END $$;

CREATE FUNCTION public.course_gap_finish(_audit_id uuid,_part_index integer,_claim_token uuid,_text text,_error_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.course_caption_gap_audits; p public.course_caption_gap_parts; failed boolean; clean text:=btrim(_text);
BEGIN
  SELECT * INTO a FROM public.course_caption_gap_audits WHERE id=_audit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'audit_missing'; END IF;
  IF NOT coalesce(public.has_role_v2(a.requested_by,'super_admin'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
  SELECT * INTO p FROM public.course_caption_gap_parts WHERE audit_id=a.id AND part_index=_part_index FOR UPDATE;
  IF NOT FOUND OR _claim_token IS NULL OR p.claim_token IS DISTINCT FROM _claim_token THEN RAISE EXCEPTION 'claim_mismatch'; END IF;
  IF p.status='evidence' THEN
    IF p.asr_text IS DISTINCT FROM clean OR _error_code IS NOT NULL THEN RAISE EXCEPTION 'evidence_conflict'; END IF;
    RETURN jsonb_build_object('status','evidence','reused',true);
  END IF;
  IF p.status<>'claimed' THEN RETURN jsonb_build_object('status',p.status,'held',true); END IF;
  failed:=_error_code IS NOT NULL OR clean IS NULL OR length(clean)=0 OR length(clean)>100000 OR p.lease_until<=now();
  UPDATE public.course_caption_gap_parts SET status=CASE WHEN failed THEN 'uncertain' ELSE 'evidence' END,
    asr_text=CASE WHEN length(clean)<=100000 THEN clean ELSE NULL END,
    text_sha256=CASE WHEN length(clean)<=100000 THEN encode(sha256(convert_to(clean,'UTF8')),'hex') ELSE NULL END,
    error_code=CASE WHEN failed THEN coalesce(left(_error_code,80),CASE WHEN p.lease_until<=now() THEN 'lease_expired' ELSE 'invalid_asr' END) ELSE NULL END,updated_at=now()
    WHERE audit_id=a.id AND part_index=_part_index;
  IF failed THEN UPDATE public.course_caption_gap_audits SET status='review_required' WHERE id=a.id;
  ELSIF a.status<>'review_required' AND (SELECT count(*) FROM public.course_caption_gap_parts WHERE audit_id=a.id AND status='evidence')=a.expected_parts
    THEN UPDATE public.course_caption_gap_audits SET status='evidence' WHERE id=a.id;
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN failed THEN 'uncertain' ELSE 'evidence' END,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.course_gap_audit_create(uuid,uuid,text,text,text,text,jsonb),public.course_gap_claim(uuid,integer,text,text),public.course_gap_finish(uuid,integer,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_gap_audit_create(uuid,uuid,text,text,text,text,jsonb),public.course_gap_claim(uuid,integer,text,text),public.course_gap_finish(uuid,integer,uuid,text,text) TO service_role;