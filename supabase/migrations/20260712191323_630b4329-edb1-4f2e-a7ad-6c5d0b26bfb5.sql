-- PATCH-PAYMENTS-MANAGEMENT-V2 / Phase B2 — schema only
-- Soft-delete columns on payments_v2 + immutable payments_legacy_archive
-- No DML, no changes to existing rows.

BEGIN;

-- 1. Soft-delete columns on payments_v2 (nullable, safe defaults)
ALTER TABLE public.payments_v2
  ADD COLUMN IF NOT EXISTS is_deleted        boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at        timestamptz   NULL,
  ADD COLUMN IF NOT EXISTS deleted_by        uuid          NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason    text          NULL,
  ADD COLUMN IF NOT EXISTS deletion_context  jsonb         NULL;

COMMENT ON COLUMN public.payments_v2.is_deleted       IS 'V2 soft-delete flag. Writers/readers must respect is_deleted=false unless explicitly showing tombstones.';
COMMENT ON COLUMN public.payments_v2.deleted_at       IS 'Timestamp of soft-delete.';
COMMENT ON COLUMN public.payments_v2.deleted_by       IS 'auth.users.id of actor who performed soft-delete. ON DELETE SET NULL.';
COMMENT ON COLUMN public.payments_v2.deleted_reason   IS 'Short human reason for soft-delete.';
COMMENT ON COLUMN public.payments_v2.deletion_context IS 'Structured context: source path, admin action, related archive row id, etc.';

-- 2. payments_legacy_archive — immutable archive for legacy admin/admin_test rows.
--    Populated later in Phase A2 via service_role only. No RLS policies => no anon/authenticated access.
CREATE TABLE IF NOT EXISTS public.payments_legacy_archive (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_payment_id     uuid        NOT NULL,
  original_row            jsonb       NOT NULL,
  legacy_category         text        NOT NULL,
  classification          text        NOT NULL,
  archive_reason          text        NOT NULL,
  archived_by             uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at             timestamptz NOT NULL DEFAULT now(),
  archive_batch_id        uuid        NULL,
  provider_at_archive     text        NULL,
  origin_at_archive       text        NULL,
  order_id_at_archive     uuid        NULL,
  amount_at_archive       numeric     NULL,
  currency_at_archive     text        NULL,
  notes                   text        NULL
);

COMMENT ON TABLE public.payments_legacy_archive IS
  'Immutable archive for legacy admin/admin_test payments_v2 rows (327 legacy tombstones per Phase A2). '
  'Access restricted to service_role. No RLS policies => anon/authenticated have no access.';

CREATE INDEX IF NOT EXISTS payments_legacy_archive_orig_idx     ON public.payments_legacy_archive(original_payment_id);
CREATE INDEX IF NOT EXISTS payments_legacy_archive_category_idx ON public.payments_legacy_archive(legacy_category);
CREATE INDEX IF NOT EXISTS payments_legacy_archive_batch_idx    ON public.payments_legacy_archive(archive_batch_id);

-- 3. GRANTS — payments_legacy_archive is service_role-only, immutable after insert.
REVOKE ALL ON TABLE public.payments_legacy_archive FROM PUBLIC;
REVOKE ALL ON TABLE public.payments_legacy_archive FROM anon;
REVOKE ALL ON TABLE public.payments_legacy_archive FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.payments_legacy_archive TO service_role;
-- UPDATE / DELETE / TRUNCATE / TRIGGER intentionally NOT granted, even to service_role.

-- 4. Enable RLS with NO policies => anon/authenticated locked out at policy layer as well.
ALTER TABLE public.payments_legacy_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments_legacy_archive FORCE ROW LEVEL SECURITY;

COMMIT;