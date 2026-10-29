-- Explicit recovery only; restores the original INV-SITE-1 violation. Execute only via Lovable Cloud after reviewed SHA.
-- Default is a no-write dry-run. No page publishing, form submission or notification.
DO $rollback$
DECLARE
  v_page public.site_pages%ROWTYPE;
  v_after public.site_pages%ROWTYPE;
  v_old jsonb;
  v_new jsonb;
  v_rows integer;
  v_dry_run boolean := true;
  v_expected_md5 text := 'f7a3306e2720898eb2894bd4935bd40c';
BEGIN
  SELECT * INTO STRICT v_page FROM public.site_pages
    WHERE id = '859c9cf0-657f-4585-a645-e93e66d940ca' FOR UPDATE;
  IF v_page.status IS DISTINCT FROM 'published'
     OR v_page.slug IS DISTINCT FROM 'web-2410'
     OR v_page.product_id IS DISTINCT FROM 'c0dbe1aa-8d8b-4f9b-83ee-0d57d1a3f740'::uuid
     OR jsonb_typeof(v_page.blocks) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_page.blocks) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'site_version_routing_or_shape_drift';
  END IF;
  IF v_page.blocks#>>'{0,id}' IS DISTINCT FROM 'b02410a0-2430-4f24-8a24-202610240001'
     OR v_page.blocks#>>'{0,type}' IS DISTINCT FROM 'html'
     OR v_page.blocks#>>'{1,id}' IS DISTINCT FROM 'f04721a0-2430-4f24-8a24-202610240001'
     OR v_page.blocks#>>'{1,type}' IS DISTINCT FROM 'form' THEN
    RAISE EXCEPTION 'site_version_block_identity_drift';
  END IF;
  v_old := jsonb_build_array((v_page.blocks->0)-'version', (v_page.blocks->1)-'version');
  IF md5(v_old::text) IS DISTINCT FROM v_expected_md5 THEN
    RAISE EXCEPTION 'site_version_content_drift';
  END IF;
  v_new := jsonb_set(jsonb_set(v_old,'{0,version}','1'::jsonb),'{1,version}','1'::jsonb);
  IF md5(v_new::text) IS DISTINCT FROM '99de30ea0a03f7aa7b6649e55372a8a2' THEN
    RAISE EXCEPTION 'site_version_target_drift';
  END IF;
  IF v_page.blocks = v_old THEN
    RAISE NOTICE 'site_version_rollback already_restored rows=0'; RETURN;
  END IF;
  IF v_page.blocks IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'site_version_rollback_version_drift';
  END IF;
  v_new := v_old;
  IF v_dry_run THEN
    RAISE NOTICE 'site_version_rollback dry_run expected_rows=1 expected_blocks=2 old_md5=% new_md5=%',md5(v_old::text),md5(v_new::text);
    RETURN;
  END IF;
  UPDATE public.site_pages SET blocks=v_new WHERE id=v_page.id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  SELECT * INTO STRICT v_after FROM public.site_pages WHERE id=v_page.id;
  IF v_rows IS DISTINCT FROM 1 OR v_after.blocks IS DISTINCT FROM v_new
     OR (to_jsonb(v_after)-'blocks'-'updated_at') IS DISTINCT FROM (to_jsonb(v_page)-'blocks'-'updated_at') THEN
    RAISE EXCEPTION 'site_version_readback_failed';
  END IF;
  RAISE NOTICE 'site_version_rollback applied rows=1 blocks=2 old_md5=% new_md5=%',md5(v_old::text),md5(v_new::text);
END;
$rollback$;
