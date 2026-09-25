-- Evidence is editorial metadata, never a model-generated transcript of silence.
ALTER TABLE public.course_transcription_parts ADD COLUMN silence_evidence jsonb;
ALTER TABLE public.course_transcription_parts ADD CONSTRAINT course_parts_silence_evidence_check
CHECK (silence_evidence IS NULL OR coalesce(
  jsonb_typeof(silence_evidence)='object' AND status='ready' AND attempts=0
  AND claim_token IS NULL AND lease_until IS NULL AND error_code IS NULL
  AND silence_evidence->>'method'='pcm_s16le_16000_mono_all_zero_v1'
  AND silence_evidence->>'audio_sha256'=audio_sha256
  AND (silence_evidence->>'part_index')::integer=part_index
  AND (silence_evidence->>'start_ms')::bigint=start_ms
  AND (silence_evidence->>'end_ms')::bigint=end_ms
  AND (silence_evidence->>'stt_calls')::integer=0
  AND transcript_text='[Редакционная отметка: цифровая тишина; '||start_ms||'–'||end_ms||' мс; речь отсутствует.]'
,false));

CREATE FUNCTION public.course_transcription_mark_verified_silence(
  _job_id uuid,_part_index integer,_actor uuid,_source_revision text,
  _audio_sha256 text,_long_manifest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.course_transcription_jobs; s public.course_transcription_sources;
  p public.course_transcription_parts; m jsonb; expected jsonb; evidence jsonb;
  bytes integer; header bytea; zero_hash text; annotation text; i integer;
BEGIN
  SELECT * INTO j FROM public.course_transcription_jobs WHERE id=_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF NOT coalesce(public.has_role_v2(_actor,'super_admin'),false)
    OR j.requested_by IS DISTINCT FROM _actor THEN RAISE EXCEPTION 'owner_required'; END IF;
  IF j.status IN ('cancelled','review_required') THEN RAISE EXCEPTION 'job_held'; END IF;
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=j.source_id FOR SHARE;
  IF NOT FOUND OR NOT s.enabled OR s.revision_basis<>'provider_api' OR s.source_scope<>'course'
    OR s.source_revision IS DISTINCT FROM _source_revision OR s.duration_ms<>j.duration_ms
    THEN RAISE EXCEPTION 'source_revision_changed'; END IF;
  SELECT * INTO p FROM public.course_transcription_parts WHERE job_id=j.id AND part_index=_part_index FOR UPDATE;
  IF NOT FOUND OR p.part_index>=j.total_parts OR p.start_ms<>p.part_index::bigint*90000
    OR p.end_ms<>least((p.part_index::bigint+1)*90000,j.duration_ms)
    THEN RAISE EXCEPTION 'part_ledger_mismatch'; END IF;
  IF _long_manifest IS NULL OR octet_length(_long_manifest)>2000000
    THEN RAISE EXCEPTION 'silence_manifest_invalid'; END IF;
  m:=_long_manifest::jsonb; expected:=m->'parts'->_part_index;
  IF m->>'schema_version' IS DISTINCT FROM '1' OR m->>'mode' IS DISTINCT FROM 'long_course_stt_dry_run'
    OR m#>>'{source,video_id}' IS DISTINCT FROM s.video_id::text
    OR m#>>'{source,source_revision}' IS DISTINCT FROM s.source_revision
    OR (m#>>'{source,duration_ms}')::bigint IS DISTINCT FROM s.duration_ms
    OR jsonb_typeof(m->'parts') IS DISTINCT FROM 'array'
    OR jsonb_array_length(m->'parts') IS DISTINCT FROM j.total_parts
    OR expected->>'digital_silence' IS DISTINCT FROM 'true'
    OR (expected->>'part_index')::integer IS DISTINCT FROM p.part_index
    OR (expected->>'start_ms')::bigint IS DISTINCT FROM p.start_ms
    OR (expected->>'end_ms')::bigint IS DISTINCT FROM p.end_ms
    OR expected->>'audio_sha256' IS DISTINCT FROM _audio_sha256
    OR (expected->>'bytes')::bigint IS DISTINCT FROM 44+(p.end_ms-p.start_ms)*32
    THEN RAISE EXCEPTION 'silence_manifest_invalid'; END IF;
  IF (SELECT count(*) FROM public.course_transcription_parts WHERE job_id=j.id)<>j.total_parts
    OR EXISTS(SELECT 1 FROM public.course_transcription_parts q WHERE q.job_id=j.id AND (
      (m->'parts'->q.part_index->>'part_index')::integer IS DISTINCT FROM q.part_index
      OR (m->'parts'->q.part_index->>'start_ms')::bigint IS DISTINCT FROM q.start_ms
      OR (m->'parts'->q.part_index->>'end_ms')::bigint IS DISTINCT FROM q.end_ms
      OR (q.status='ready' AND m->'parts'->q.part_index->>'audio_sha256' IS DISTINCT FROM q.audio_sha256)))
    THEN RAISE EXCEPTION 'silence_manifest_changed'; END IF;
  -- Construct the exact canonical WAV instead of trusting a digital_silence flag.
  bytes:=((p.end_ms-p.start_ms)*32)::integer;
  header:=decode('524946460000000057415645666d74201000000001000100803e0000007d0000020010006461746100000000','hex');
  FOR i IN 0..3 LOOP
    header:=set_byte(header,4+i,((bytes+36)>>(8*i))&255);
    header:=set_byte(header,40+i,(bytes>>(8*i))&255);
  END LOOP;
  zero_hash:=encode(sha256(header||decode(repeat('00',bytes),'hex')),'hex');
  IF _audio_sha256 IS DISTINCT FROM zero_hash THEN RAISE EXCEPTION 'digital_zero_not_proven'; END IF;
  annotation:='[Редакционная отметка: цифровая тишина; '||p.start_ms||'–'||p.end_ms||' мс; речь отсутствует.]';
  evidence:=jsonb_build_object('schema_version',1,'method','pcm_s16le_16000_mono_all_zero_v1',
    'part_index',p.part_index,'start_ms',p.start_ms,'end_ms',p.end_ms,'audio_sha256',zero_hash,
    'pcm_bytes',bytes,'zero_samples',bytes/2,'stt_calls',0,'actor',_actor,
    'manifest_sha256',encode(sha256(convert_to(_long_manifest,'UTF8')),'hex'));
  IF p.status='ready' THEN
    IF p.silence_evidence IS DISTINCT FROM evidence OR p.transcript_text IS DISTINCT FROM annotation
      OR p.audio_sha256 IS DISTINCT FROM zero_hash OR p.attempts<>0
      THEN RAISE EXCEPTION 'silence_conflict'; END IF;
    RETURN jsonb_build_object('reused',true,'status','ready','evidence',evidence);
  END IF;
  IF j.status NOT IN ('pending','transcribing') OR p.status<>'pending' OR p.attempts<>0
    OR p.audio_sha256 IS NOT NULL OR p.claim_token IS NOT NULL OR p.lease_until IS NOT NULL
    OR p.transcript_text IS NOT NULL OR p.silence_evidence IS NOT NULL OR p.error_code IS NOT NULL
    THEN RAISE EXCEPTION 'silence_part_held'; END IF;
  UPDATE public.course_transcription_parts SET status='ready',audio_sha256=zero_hash,
    transcript_text=annotation,silence_evidence=evidence,updated_at=now()
    WHERE job_id=j.id AND part_index=p.part_index;
  RETURN jsonb_build_object('reused',false,'status','ready','evidence',evidence);
END $$;
REVOKE ALL ON FUNCTION public.course_transcription_mark_verified_silence(uuid,integer,uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_transcription_mark_verified_silence(uuid,integer,uuid,text,text,text)
  TO service_role;