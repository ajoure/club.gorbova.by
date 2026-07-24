DO $rb$
DECLARE
  target_id uuid := 'd5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656';
  source_id uuid := 'e3c79f1c-947a-49ec-88be-6cebdfe19f35';
  src_html text;
  old_len int;
  new_len int;
BEGIN
  SELECT blocks#>>'{0,content,code}' INTO src_html FROM public.site_pages WHERE id = source_id;
  IF src_html IS NULL THEN RAISE EXCEPTION 'source /cb clean copy not found'; END IF;

  -- Safety: source must be pre-mobile-patch clean
  IF position('mobile-clone-v3' in src_html) > 0
     OR position('mobile-clone-v4' in src_html) > 0
     OR position('lv-mobile-tariffs' in src_html) > 0
     OR position('syncRecVisibility' in src_html) > 0
     OR position('lovable-cb20' in src_html) > 0
     OR position(E'\\n' in src_html) > 0 THEN
    RAISE EXCEPTION 'source blob contains forbidden marker or literal backslash-n';
  END IF;

  SELECT length(blocks#>>'{0,content,code}') INTO old_len FROM public.site_pages WHERE id = target_id;

  UPDATE public.site_pages
     SET blocks     = jsonb_set(blocks, '{0,content,code}', to_jsonb(src_html), false),
         updated_at = now()
   WHERE id = target_id;

  SELECT length(blocks#>>'{0,content,code}') INTO new_len FROM public.site_pages WHERE id = target_id;
  RAISE NOTICE 'rollback ok target=% old_len=% new_len=% src_len=%', target_id, old_len, new_len, length(src_html);
END $rb$;