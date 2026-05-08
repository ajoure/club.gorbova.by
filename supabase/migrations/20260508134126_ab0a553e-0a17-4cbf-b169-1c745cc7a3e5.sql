-- Sprint 11 — total wipe of legacy document layer.
-- All data is destroyed in dependency order. Schema/tables are preserved
-- for the new strict pipeline; only contents are removed.

-- 1. Generated/output records first (no inbound FKs from templates).
DELETE FROM public.ai_generated_documents;
DELETE FROM public.generated_documents;

-- 2. Corporate draft sessions (no FK to templates, but legacy entity).
DELETE FROM public.corporate_draft_sessions;

-- 3. Template-side dependents (in case CASCADE is partial / RESTRICT exists).
DELETE FROM public.document_generation_sessions;
DELETE FROM public.document_generation_rules;
DELETE FROM public.document_token_aliases;
DELETE FROM public.document_package_template_items;
DELETE FROM public.document_package_templates;

-- 4. Template versions before templates (FK current_version_id is SET NULL,
--    but explicit clear keeps things tidy and avoids any trigger surprises).
UPDATE public.document_templates SET current_version_id = NULL;
DELETE FROM public.document_template_versions;

-- 5. The templates themselves.
DELETE FROM public.document_templates;

-- 6. Verification.
DO $$
DECLARE
  v_templates int;
  v_versions int;
  v_ai int;
  v_legacy int;
  v_corp int;
BEGIN
  SELECT COUNT(*) INTO v_templates FROM public.document_templates;
  SELECT COUNT(*) INTO v_versions FROM public.document_template_versions;
  SELECT COUNT(*) INTO v_ai FROM public.ai_generated_documents;
  SELECT COUNT(*) INTO v_legacy FROM public.generated_documents;
  SELECT COUNT(*) INTO v_corp FROM public.corporate_draft_sessions;

  IF (v_templates + v_versions + v_ai + v_legacy + v_corp) <> 0 THEN
    RAISE EXCEPTION 'Sprint 11 wipe incomplete: templates=%, versions=%, ai=%, legacy=%, corp_sessions=%',
      v_templates, v_versions, v_ai, v_legacy, v_corp;
  END IF;
END $$;