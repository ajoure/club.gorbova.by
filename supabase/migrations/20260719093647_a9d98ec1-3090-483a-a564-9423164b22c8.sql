DO $$
DECLARE
  target_page uuid := 'd5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656';
  replacements jsonb := '[
    {"elem_id":"1677259383387","position":"1"},
    {"elem_id":"1689144681258","position":"2"},
    {"elem_id":"1677259383382","position":"3"},
    {"elem_id":"1749459978216","position":"4"},
    {"elem_id":"1723104345468","position":"1"},
    {"elem_id":"1723104345495","position":"2"},
    {"elem_id":"1723104345465","position":"3"},
    {"elem_id":"1749460467687","position":"4"},
    {"elem_id":"1723107938587","position":"1"},
    {"elem_id":"1723107938619","position":"2"},
    {"elem_id":"1723107938584","position":"3"},
    {"elem_id":"1749460678728","position":"4"}
  ]'::jsonb;
  blocks_new jsonb := '[]'::jsonb;
  block_item jsonb;
  code text;
  repl jsonb;
  marker text;
  marker_pos integer;
  tag_end_pos integer;
  rel_tag_end integer;
  segment text;
  updated_segment text;
BEGIN
  FOR block_item IN
    SELECT value
    FROM public.site_pages sp,
         jsonb_array_elements(sp.blocks) WITH ORDINALITY AS arr(value, ord)
    WHERE sp.id = target_page
    ORDER BY arr.ord
  LOOP
    IF block_item->>'type' = 'html' THEN
      code := block_item #>> '{content,code}';

      FOR repl IN SELECT value FROM jsonb_array_elements(replacements)
      LOOP
        marker := 'data-elem-id="' || (repl->>'elem_id') || '"';
        marker_pos := strpos(code, marker);

        IF marker_pos > 0 THEN
          rel_tag_end := strpos(substr(code, marker_pos), '>');

          IF rel_tag_end > 0 THEN
            tag_end_pos := marker_pos + rel_tag_end - 1;
            segment := substr(code, marker_pos, tag_end_pos - marker_pos + 1);
            updated_segment := regexp_replace(
              segment,
              'data-lovable-slot-position="[0-9]+"',
              'data-lovable-slot-position="' || (repl->>'position') || '"',
              'g'
            );
            code := substr(code, 1, marker_pos - 1) || updated_segment || substr(code, tag_end_pos + 1);
          END IF;
        END IF;
      END LOOP;

      block_item := jsonb_set(block_item, '{content,code}', to_jsonb(code), false);
    END IF;

    blocks_new := blocks_new || jsonb_build_array(block_item);
  END LOOP;

  UPDATE public.site_pages
  SET blocks = blocks_new,
      updated_at = now()
  WHERE id = target_page;
END $$;