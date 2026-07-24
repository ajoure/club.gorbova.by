UPDATE public.site_pages
SET blocks = jsonb_set(
  blocks,
  '{0,content,code}',
  to_jsonb(
    regexp_replace(
      blocks#>>'{0,content,code}',
      '<!--\s*lovable-cb20-mobile-fix-v2\s*-->.*?<!--\s*/lovable-cb20-mobile-fix-v2\s*-->',
      '',
      'gs'
    )
  )
)
WHERE id='d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656';

-- Fallback: also strip a v2 style block without closing marker
UPDATE public.site_pages
SET blocks = jsonb_set(
  blocks,
  '{0,content,code}',
  to_jsonb(
    regexp_replace(
      blocks#>>'{0,content,code}',
      '<style[^>]*id="lovable-cb20-mobile-fix-v2"[^>]*>.*?</style>',
      '',
      'gs'
    )
  )
)
WHERE id='d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656';

-- Final cleanup: any lingering v1 markers or comments
UPDATE public.site_pages
SET blocks = jsonb_set(
  blocks,
  '{0,content,code}',
  to_jsonb(
    regexp_replace(
      regexp_replace(
        blocks#>>'{0,content,code}',
        '<!--\s*lovable-cb20-mobile-fix[^>]*-->',
        '',
        'g'
      ),
      '<style[^>]*id="lovable-cb20-mobile-fix[^"]*"[^>]*>.*?</style>',
      '',
      'gs'
    )
  )
)
WHERE id='d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656';