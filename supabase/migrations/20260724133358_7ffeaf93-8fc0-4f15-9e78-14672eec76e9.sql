DO $rb$
DECLARE
  page_id uuid := 'd5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656';
  h text;
  s_marker text := '<!-- lovable:mobile-clone-v4:start -->';
  e_marker text := '<!-- lovable:mobile-clone-v4:end -->';
  s_pos int;
  e_pos int;
  new_h text;
BEGIN
  SELECT blocks#>>'{0,content,code}' INTO h FROM public.site_pages WHERE id = page_id;
  IF h IS NULL THEN RAISE EXCEPTION 'page not found'; END IF;

  s_pos := position(s_marker in h);
  e_pos := position(e_marker in h);
  IF s_pos = 0 OR e_pos = 0 OR e_pos < s_pos THEN
    RAISE EXCEPTION 'mobile-clone-v4 markers not found or malformed (s=% e=%)', s_pos, e_pos;
  END IF;

  new_h := left(h, s_pos - 1) || substring(h from e_pos + length(e_marker));
  -- trim single leading newline left behind, if any, at the cut point
  IF substring(new_h from s_pos for 1) = E'\n' THEN
    new_h := left(new_h, s_pos - 1) || substring(new_h from s_pos + 1);
  END IF;

  -- safety asserts: none of the forbidden markers must survive
  IF position('mobile-clone-v3' in new_h) > 0
     OR position('mobile-clone-v4' in new_h) > 0
     OR position('lv-mobile-tariffs' in new_h) > 0
     OR position('syncRecVisibility' in new_h) > 0
     OR position('lovable-cb20-mobile-clone' in new_h) > 0
     OR position('lovable-cb20-mobile-fix' in new_h) > 0 THEN
    RAISE EXCEPTION 'rollback assertion failed: forbidden marker still present';
  END IF;

  UPDATE public.site_pages
     SET blocks = jsonb_set(blocks, '{0,content,code}', to_jsonb(new_h), false),
         updated_at = now()
   WHERE id = page_id;

  RAISE NOTICE 'rollback ok: old_len=% new_len=% removed=%', length(h), length(new_h), length(h) - length(new_h);
END $rb$;