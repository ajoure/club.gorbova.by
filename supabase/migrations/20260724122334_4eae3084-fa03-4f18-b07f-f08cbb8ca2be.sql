UPDATE public.site_pages
SET blocks = jsonb_set(
  blocks,
  '{0,content}',
  to_jsonb(replace(
    blocks->0->>'content',
    '<style id="lovable-cb20-mobile-clone-v4-css">',
    '<style id="lovable-cb20-mobile-clone-v4-css">' || E'\n/* lovable-cb20-mobile-clone-v4.1 hide original rec on mobile */\n@media (max-width: 767px){ #rec1219722591 { display: none !important; } }\n'
  ))
),
updated_at = now()
WHERE id = 'd5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656'
  AND position('lovable-cb20-mobile-clone-v4.1' in (blocks->0->>'content')) = 0;