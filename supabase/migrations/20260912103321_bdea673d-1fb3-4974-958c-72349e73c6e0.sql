-- Lovable Cloud registered the exact reviewed migration under a managed ID.
-- The earlier GitHub migration has already installed the same objects on a fresh database.
-- Keep this managed history marker, without executing duplicate CREATE statements.
DO $managed_marker$ BEGIN
 IF to_regprocedure('public.sales_authorize_invoice_document(text,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'missing_original_sales_migration';
 END IF;
END $managed_marker$;
