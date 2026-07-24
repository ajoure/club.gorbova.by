DO $$
DECLARE
  page_id uuid := 'd5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656';
  old_html text;
  clean_html text;
  v2_block text;
  new_html text;
BEGIN
  SELECT blocks#>>'{0,content,code}' INTO old_html FROM public.site_pages WHERE id = page_id;
  IF old_html IS NULL THEN RAISE EXCEPTION 'page not found'; END IF;

  -- strip v1 patch (from marker to end of html; v1 was appended at tail)
  clean_html := regexp_replace(old_html, '<!-- lovable-cb20-mobile-fix-v1 -->.*$', '', 'ns');

  v2_block := '<!-- lovable-cb20-mobile-fix-v2 --><style id="lovable-cb20-mobile-fix-v2">@media (max-width:767px){#rec1219722591 .tn-elem[data-elem-id="1677259383387"] .tn-atom, #rec1219722591 .tn-elem[data-elem-id="1749459978216"] .tn-atom, #rec1219722591 .tn-elem[data-elem-id="1723104345468"] .tn-atom, #rec1219722591 .tn-elem[data-elem-id="1749460467687"] .tn-atom, #rec1219722591 .tn-elem[data-elem-id="1723107938587"] .tn-atom, #rec1219722591 .tn-elem[data-elem-id="1749460678728"] .tn-atom, #rec1219722591 .tn-elem[data-elem-id="1723104345465"] .tn-atom, #rec1219722591 .tn-elem[data-elem-id="1723104345495"] .tn-atom{min-height:48px!important;display:flex!important;align-items:center!important;justify-content:center!important;white-space:normal!important;line-height:1.2!important;padding:8px 12px!important;}}</style><!-- /lovable-cb20-mobile-fix-v2 -->';

  new_html := clean_html || v2_block;

  UPDATE public.site_pages
     SET blocks = jsonb_set(blocks, '{0,content,code}', to_jsonb(new_html), false),
         updated_at = now()
   WHERE id = page_id;

  RAISE NOTICE 'old=% clean=% new=%', length(old_html), length(clean_html), length(new_html);
END $$;