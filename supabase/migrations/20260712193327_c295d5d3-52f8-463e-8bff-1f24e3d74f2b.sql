-- B2.1 SCHEMA CORRECTION FOR payments_legacy_archive
-- Enforce append-only immutability at the database level.

-- 1. row_checksum column (NOT NULL) — table is empty, safe to add
ALTER TABLE public.payments_legacy_archive
  ADD COLUMN IF NOT EXISTS row_checksum text NOT NULL;

-- 2. Unique constraint on original_payment_id — one archive row per legacy payment
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_legacy_archive_original_payment_id_unique'
  ) THEN
    ALTER TABLE public.payments_legacy_archive
      ADD CONSTRAINT payments_legacy_archive_original_payment_id_unique
      UNIQUE (original_payment_id);
  END IF;
END$$;

-- 3. Immutability trigger: block UPDATE/DELETE regardless of role
CREATE OR REPLACE FUNCTION public.payments_legacy_archive_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'payments_legacy_archive is append-only: % is blocked by immutability trigger', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION public.payments_legacy_archive_block_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_legacy_archive_immutable ON public.payments_legacy_archive;
CREATE TRIGGER payments_legacy_archive_immutable
  BEFORE UPDATE OR DELETE ON public.payments_legacy_archive
  FOR EACH ROW EXECUTE FUNCTION public.payments_legacy_archive_block_mutation();

COMMENT ON TABLE public.payments_legacy_archive IS
  'Append-only archive of legacy admin/manual payments. UPDATE and DELETE are blocked at the trigger level, regardless of role. INSERT allowed only to service_role.';