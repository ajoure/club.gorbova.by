-- Preserve payment reconciliation history when an optional matched profile is
-- removed. This changes only the foreign-key action; queue rows are not
-- updated or deleted by this migration.
DO $$
DECLARE
  queue_table regclass := to_regclass('public.payment_reconcile_queue');
  profile_column_attnum smallint;
  profile_column_is_required boolean;
  existing_constraint record;
BEGIN
  IF queue_table IS NULL THEN
    RAISE EXCEPTION
      'payment_reconcile_queue is missing; refusing to change delete behavior';
  END IF;

  SELECT attnum, attnotnull
    INTO profile_column_attnum, profile_column_is_required
  FROM pg_attribute
  WHERE attrelid = queue_table
    AND attname = 'matched_profile_id'
    AND NOT attisdropped;

  IF profile_column_attnum IS NULL THEN
    RAISE EXCEPTION
      'payment_reconcile_queue.matched_profile_id is missing; refusing to change delete behavior';
  END IF;

  IF profile_column_is_required THEN
    RAISE EXCEPTION
      'payment_reconcile_queue.matched_profile_id is NOT NULL; refusing to change delete behavior';
  END IF;

  FOR existing_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = queue_table
      AND contype = 'f'
      AND confrelid = 'public.profiles'::regclass
      AND conkey = ARRAY[profile_column_attnum]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.payment_reconcile_queue DROP CONSTRAINT %I',
      existing_constraint.conname
    );
  END LOOP;
END
$$;

ALTER TABLE public.payment_reconcile_queue
  ADD CONSTRAINT payment_reconcile_queue_matched_profile_id_fkey
  FOREIGN KEY (matched_profile_id)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN public.payment_reconcile_queue.matched_profile_id IS
  'Optional profile match; cleared when the profile is deleted so reconciliation history is retained.';