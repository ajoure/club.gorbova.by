-- Closed course corpus. No existing live-event tables, jobs, access or bots change.
-- Empty schema only: no sources or paid jobs are seeded by this migration.
CREATE TABLE public.course_transcription_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider = 'kinescope'),
  video_id uuid NOT NULL,
  source_revision text NOT NULL CHECK (source_revision ~ '^[a-f0-9]{64}$'),
  audio_track_id text CHECK (length(audio_track_id) BETWEEN 1 AND 200),
  duration_ms bigint NOT NULL CHECK (duration_ms BETWEEN 1000 AND 21600000),
  audio_bytes bigint CHECK (audio_bytes > 0),
  enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, video_id, source_revision)
);

CREATE TABLE public.course_transcription_bindings (
  source_id uuid NOT NULL REFERENCES public.course_transcription_sources(id),
  lesson_id uuid NOT NULL REFERENCES public.training_lessons(id),
  block_id uuid NOT NULL REFERENCES public.lesson_blocks(id),
  product_id uuid NOT NULL REFERENCES public.products_v2(id),
  block_updated_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id, block_id)
);
CREATE INDEX course_transcription_bindings_lesson_idx ON public.course_transcription_bindings(lesson_id);
CREATE INDEX course_transcription_bindings_product_idx ON public.course_transcription_bindings(product_id);

CREATE TABLE public.course_transcription_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL UNIQUE REFERENCES public.course_transcription_sources(id),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  duration_ms bigint NOT NULL CHECK (duration_ms BETWEEN 1000 AND 21600000),
  window_ms integer NOT NULL DEFAULT 90000 CHECK (window_ms = 90000),
  total_parts integer NOT NULL CHECK (total_parts BETWEEN 1 AND 240),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','transcribing','review_required','ready','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_parts = (duration_ms + window_ms - 1) / window_ms)
);

CREATE TABLE public.course_transcription_parts (
  job_id uuid NOT NULL REFERENCES public.course_transcription_jobs(id),
  part_index integer NOT NULL CHECK (part_index BETWEEN 0 AND 239),
  start_ms bigint NOT NULL,
  end_ms bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','uncertain')),
  claim_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1),
  audio_sha256 text CHECK (audio_sha256 ~ '^[a-f0-9]{64}$'),
  transcript_text text,
  error_code text CHECK (length(error_code) <= 80),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id, part_index),
  CHECK (start_ms = part_index::bigint * 90000 AND end_ms > start_ms AND end_ms <= start_ms + 90000),
  CHECK (status <> 'ready' OR coalesce(length(btrim(transcript_text)),0) > 0),
  CHECK (status <> 'processing' OR (claim_token IS NOT NULL AND lease_until IS NOT NULL AND audio_sha256 IS NOT NULL))
);

CREATE TABLE public.course_transcripts (
  source_id uuid PRIMARY KEY REFERENCES public.course_transcription_sources(id),
  job_id uuid UNIQUE REFERENCES public.course_transcription_jobs(id),
  origin text NOT NULL DEFAULT 'stt' CHECK (origin IN ('stt','provider_subtitles')),
  subtitle_metadata jsonb,
  source_revision text NOT NULL,
  transcript_text text NOT NULL CHECK (length(btrim(transcript_text)) > 0),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  char_count integer NOT NULL CHECK (char_count > 0),
  duration_ms bigint NOT NULL,
  classification text NOT NULL DEFAULT 'paid_private' CHECK (classification = 'paid_private'),
  quality_status text NOT NULL DEFAULT 'unreviewed' CHECK (quality_status IN ('unreviewed','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_count = length(transcript_text)),
  CHECK ((origin='stt' AND job_id IS NOT NULL) OR (origin='provider_subtitles' AND job_id IS NULL))
);

-- A browser may read only as the actual owner. All mutation is via the
-- authenticated owner-only Edge adapter using a server service client.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['course_transcription_sources','course_transcription_bindings',
    'course_transcription_jobs','course_transcription_parts','course_transcripts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY owner_read ON public.%I FOR SELECT TO authenticated USING (public.has_role_v2((SELECT auth.uid()), ''super_admin''))', t);
  END LOOP;
END $$;

-- Service-only invoker routines keep row locking and idempotency in one DB
-- transaction, without granting a browser a SECURITY DEFINER bypass.
CREATE FUNCTION public.course_transcription_create_job(_source_id uuid, _actor uuid, _duration_ms bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.course_transcription_sources; j public.course_transcription_jobs;
BEGIN
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=_source_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled THEN RAISE EXCEPTION 'source_not_enabled'; END IF;
  IF NOT coalesce(public.has_role_v2(_actor,'super_admin'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
  IF EXISTS (SELECT 1 FROM public.course_transcripts WHERE source_id=s.id) THEN RAISE EXCEPTION 'transcript_already_exists'; END IF;
  IF s.audio_track_id IS NULL OR s.audio_bytes IS NULL THEN RAISE EXCEPTION 'audio_metadata_required'; END IF;
  IF _duration_ms IS NULL OR abs(_duration_ms-s.duration_ms)>1000 THEN RAISE EXCEPTION 'duration_mismatch'; END IF;
  SELECT * INTO j FROM public.course_transcription_jobs WHERE source_id=s.id;
  IF FOUND THEN
    IF j.duration_ms<>_duration_ms THEN RAISE EXCEPTION 'job_duration_mismatch'; END IF;
    RETURN jsonb_build_object('job_id',j.id,'status',j.status,'reused',true);
  END IF;
  INSERT INTO public.course_transcription_jobs(source_id,requested_by,duration_ms,total_parts)
    VALUES(s.id,_actor,_duration_ms,(_duration_ms+89999)/90000) RETURNING * INTO j;
  INSERT INTO public.course_transcription_parts(job_id,part_index,start_ms,end_ms)
    SELECT j.id,i,i::bigint*90000,least((i::bigint+1)*90000,_duration_ms)
    FROM generate_series(0,j.total_parts-1) i;
  RETURN jsonb_build_object('job_id',j.id,'status',j.status,'reused',false);
END $$;

CREATE FUNCTION public.course_transcription_claim_part(_job_id uuid, _part_index integer, _audio_sha256 text, _source_revision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE j public.course_transcription_jobs; s public.course_transcription_sources;
  p public.course_transcription_parts; token uuid;
BEGIN
  SELECT * INTO j FROM public.course_transcription_jobs WHERE id=_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=j.source_id FOR SHARE;
  IF NOT s.enabled OR _source_revision IS DISTINCT FROM s.source_revision THEN RAISE EXCEPTION 'source_revision_changed'; END IF;
  IF j.status IN ('cancelled','review_required') THEN RETURN jsonb_build_object('action','hold','status',j.status); END IF;
  SELECT * INTO p FROM public.course_transcription_parts WHERE job_id=j.id AND part_index=_part_index FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'part_not_found'; END IF;
  IF _audio_sha256 IS NULL OR _audio_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_audio_hash'; END IF;
  IF p.audio_sha256 IS NOT NULL AND p.audio_sha256<>_audio_sha256 THEN RAISE EXCEPTION 'part_audio_changed'; END IF;
  IF p.status='ready' THEN RETURN jsonb_build_object('action','cached'); END IF;
  IF p.status='processing' AND p.lease_until <= now() THEN
    UPDATE public.course_transcription_parts SET status='uncertain',error_code='lease_expired',updated_at=now()
      WHERE job_id=j.id AND part_index=_part_index;
    UPDATE public.course_transcription_jobs SET status='review_required',updated_at=now() WHERE id=j.id;
    RETURN jsonb_build_object('action','hold','status','uncertain');
  END IF;
  IF p.status<>'pending' OR j.status='ready' THEN RETURN jsonb_build_object('action','hold','status',p.status); END IF;
  token:=gen_random_uuid();
  UPDATE public.course_transcription_parts SET status='processing',claim_token=token,
    lease_until=now()+interval '10 minutes',attempts=1,audio_sha256=_audio_sha256,updated_at=now()
    WHERE job_id=j.id AND part_index=_part_index;
  UPDATE public.course_transcription_jobs SET status='transcribing',updated_at=now() WHERE id=j.id;
  RETURN jsonb_build_object('action','transcribe','claim_token',token,'start_ms',p.start_ms,'end_ms',p.end_ms);
END $$;

CREATE FUNCTION public.course_transcription_finish_part(_job_id uuid, _part_index integer, _claim_token uuid, _text text, _error_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE j public.course_transcription_jobs; p public.course_transcription_parts; failed boolean;
BEGIN
  SELECT * INTO j FROM public.course_transcription_jobs WHERE id=_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;
  SELECT * INTO p FROM public.course_transcription_parts WHERE job_id=j.id AND part_index=_part_index FOR UPDATE;
  IF NOT FOUND OR p.claim_token IS DISTINCT FROM _claim_token OR _claim_token IS NULL THEN RAISE EXCEPTION 'claim_mismatch'; END IF;
  IF p.status='ready' THEN
    IF p.transcript_text IS DISTINCT FROM btrim(_text) THEN RAISE EXCEPTION 'result_conflict'; END IF;
    RETURN jsonb_build_object('status','ready','reused',true);
  END IF;
  -- Keep a late successful response as evidence but never restart a cancelled
  -- or uncertain job. No automatic retries for possibly billed calls.
  IF p.status<>'processing' THEN RETURN jsonb_build_object('status',p.status,'held',true); END IF;
  failed:=_error_code IS NOT NULL OR _text IS NULL OR length(btrim(_text))=0 OR length(_text)>100000;
  UPDATE public.course_transcription_parts SET status=CASE WHEN failed THEN 'uncertain' ELSE 'ready' END,
    transcript_text=CASE WHEN failed THEN NULL ELSE btrim(_text) END,
    error_code=CASE WHEN failed THEN coalesce(left(_error_code,80),'invalid_transcript') ELSE NULL END,
    updated_at=now() WHERE job_id=j.id AND part_index=_part_index;
  IF failed AND j.status<>'cancelled' THEN
    UPDATE public.course_transcription_jobs SET status='review_required',updated_at=now() WHERE id=j.id;
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN failed THEN 'uncertain' ELSE 'ready' END,'reused',false);
END $$;

CREATE FUNCTION public.course_transcription_finalize(_job_id uuid, _source_revision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE j public.course_transcription_jobs; s public.course_transcription_sources;
  result_text text; n integer; existing public.course_transcripts;
BEGIN
  SELECT * INTO j FROM public.course_transcription_jobs WHERE id=_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=j.source_id FOR SHARE;
  IF NOT s.enabled OR s.source_revision IS DISTINCT FROM _source_revision THEN RAISE EXCEPTION 'source_revision_changed'; END IF;
  IF j.status IN ('cancelled','review_required') THEN RAISE EXCEPTION 'job_held'; END IF;
  SELECT count(*),string_agg(transcript_text,E'\n\n' ORDER BY part_index) INTO n,result_text
    FROM public.course_transcription_parts WHERE job_id=j.id AND status='ready'
    AND part_index<j.total_parts AND start_ms=part_index::bigint*90000
    AND end_ms=least((part_index::bigint+1)*90000,j.duration_ms);
  IF n<>j.total_parts OR result_text IS NULL OR length(btrim(result_text))=0
    OR (SELECT count(*) FROM public.course_transcription_parts WHERE job_id=j.id)<>j.total_parts
    THEN RAISE EXCEPTION 'incomplete_transcript'; END IF;
  SELECT * INTO existing FROM public.course_transcripts WHERE source_id=s.id;
  IF FOUND THEN
    IF existing.transcript_text<>result_text OR existing.source_revision<>s.source_revision THEN RAISE EXCEPTION 'transcript_conflict'; END IF;
    RETURN jsonb_build_object('source_id',s.id,'chars',existing.char_count,'sha256',existing.content_sha256,'reused',true);
  END IF;
  INSERT INTO public.course_transcripts(source_id,job_id,source_revision,transcript_text,content_sha256,char_count,duration_ms)
    VALUES(s.id,j.id,s.source_revision,result_text,encode(sha256(convert_to(result_text,'UTF8')),'hex'),length(result_text),j.duration_ms);
  UPDATE public.course_transcription_jobs SET status='ready',updated_at=now() WHERE id=j.id;
  RETURN jsonb_build_object('source_id',s.id,'chars',length(result_text),'sha256',encode(sha256(convert_to(result_text,'UTF8')),'hex'),'reused',false);
END $$;

-- Import already-produced provider subtitles without buying another STT run.
-- A trusted adapter parses/validates VTT before this service-only operation.
-- Imported content remains unreviewed and is never a sales-facing attachment.
CREATE FUNCTION public.course_transcription_import_subtitles(_source_id uuid, _source_revision text, _text text, _metadata jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.course_transcription_sources; existing public.course_transcripts; txt text:=btrim(_text);
BEGIN
  SELECT * INTO s FROM public.course_transcription_sources WHERE id=_source_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled OR s.source_revision IS DISTINCT FROM _source_revision THEN RAISE EXCEPTION 'source_revision_changed'; END IF;
  IF txt IS NULL OR length(txt) NOT BETWEEN 1 AND 10000000 THEN RAISE EXCEPTION 'invalid_transcript'; END IF;
  IF _metadata IS NULL OR jsonb_typeof(_metadata)<>'object'
    OR _metadata->>'language' IS DISTINCT FROM 'ru'
    OR coalesce((_metadata->>'cue_count')::integer,0)<1
    OR coalesce(_metadata->>'subtitle_sha256','') !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'invalid_subtitle_metadata'; END IF;
  IF EXISTS (SELECT 1 FROM public.course_transcription_jobs WHERE source_id=s.id) THEN RAISE EXCEPTION 'stt_job_exists_reconcile_first'; END IF;
  SELECT * INTO existing FROM public.course_transcripts WHERE source_id=s.id;
  IF FOUND THEN
    IF existing.transcript_text<>txt OR existing.source_revision<>s.source_revision
      OR existing.subtitle_metadata->>'subtitle_sha256' IS DISTINCT FROM _metadata->>'subtitle_sha256'
      THEN RAISE EXCEPTION 'transcript_conflict'; END IF;
    RETURN jsonb_build_object('source_id',s.id,'chars',existing.char_count,'sha256',existing.content_sha256,'reused',true);
  END IF;
  INSERT INTO public.course_transcripts(source_id,origin,source_revision,transcript_text,content_sha256,char_count,duration_ms,subtitle_metadata)
    VALUES(s.id,'provider_subtitles',s.source_revision,txt,encode(sha256(convert_to(txt,'UTF8')),'hex'),length(txt),s.duration_ms,
      jsonb_build_object('language','ru','cue_count',(_metadata->>'cue_count')::integer,
        'subtitle_sha256',_metadata->>'subtitle_sha256','first_ms',(_metadata->>'first_ms')::bigint,
        'last_ms',(_metadata->>'last_ms')::bigint,'covered_ms',(_metadata->>'covered_ms')::bigint,
        'max_gap_ms',(_metadata->>'max_gap_ms')::bigint,'uncovered_ms',(_metadata->>'uncovered_ms')::bigint,
        'gap_count_gt60',(_metadata->>'gap_count_gt60')::integer,'quality_flags',_metadata->'quality_flags'));
  RETURN jsonb_build_object('source_id',s.id,'chars',length(txt),'sha256',encode(sha256(convert_to(txt,'UTF8')),'hex'),'reused',false);
END $$;

REVOKE ALL ON FUNCTION public.course_transcription_import_subtitles(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_transcription_import_subtitles(uuid,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.course_transcription_create_job(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.course_transcription_claim_part(uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.course_transcription_finish_part(uuid,integer,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.course_transcription_finalize(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_transcription_create_job(uuid,uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.course_transcription_claim_part(uuid,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.course_transcription_finish_part(uuid,integer,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.course_transcription_finalize(uuid,text) TO service_role;