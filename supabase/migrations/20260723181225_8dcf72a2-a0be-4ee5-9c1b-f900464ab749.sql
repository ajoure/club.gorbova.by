DO $$
DECLARE
  v_id uuid;
  v_code text;
  v_new text;
  v_marker text := '/* CB_MOBILE_CTA_FIX_V1 */';
  v_style text := '<style>' ||
    '/* CB_MOBILE_CTA_FIX_V1 */' ||
    '@media (max-width: 640px){' ||
    '.t396__elem.tn-elem__12197225911723104345465,' ||
    '.t396__elem.tn-elem__12197225911749460467687{' ||
      'position: relative !important;' ||
      'left: 0 !important; right: 0 !important; top: auto !important;' ||
      'margin: 12px auto !important;' ||
      'width: calc(100% - 32px) !important;' ||
      'max-width: 480px !important;' ||
      'display: block !important;' ||
      'transform: none !important;' ||
    '}' ||
    '.t396__elem.tn-elem__12197225911723104345465 .tn-atom,' ||
    '.t396__elem.tn-elem__12197225911749460467687 .tn-atom{' ||
      'width: 100% !important;' ||
      'min-width: 0 !important;' ||
      'box-sizing: border-box !important;' ||
    '}' ||
    '.t396__elem.tn-elem__12197225911749460467687{ order: 1; }' ||
    '.t396__elem.tn-elem__12197225911723104345465{ order: 2; }' ||
    '}' ||
    '</style>';
BEGIN
  SELECT id, blocks->0->'content'->>'code'
    INTO v_id, v_code
  FROM public.site_pages WHERE slug='cb' LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'cb page not found'; END IF;
  IF position(v_marker IN v_code) > 0 THEN
    RAISE NOTICE 'CB mobile fix already present, skipping';
    RETURN;
  END IF;
  IF position('</body>' IN v_code) = 0 THEN
    v_new := v_code || v_style;
  ELSE
    v_new := replace(v_code, '</body>', v_style || '</body>');
  END IF;
  UPDATE public.site_pages
  SET blocks = jsonb_set(
        blocks,
        '{0,content,code}',
        to_jsonb(v_new),
        false
      ),
      updated_at = now()
  WHERE id = v_id;
END $$;