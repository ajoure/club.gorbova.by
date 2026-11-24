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
