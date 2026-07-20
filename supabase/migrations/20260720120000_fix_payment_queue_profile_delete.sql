-- Allow profile deletion without losing reconciliation history.
-- payment_reconcile_queue is an audit/reconciliation table, so historical rows
-- must survive while their optional profile match is cleared.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname
    INTO constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.payment_reconcile_queue'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'public.profiles'::regclass
    AND c.conkey = ARRAY[
      (SELECT attnum
       FROM pg_attribute
       WHERE attrelid = 'public.payment_reconcile_queue'::regclass
         AND attname = 'matched_profile_id'
         AND NOT attisdropped)
    ]::smallint[]
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.payment_reconcile_queue DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END
$$;

ALTER TABLE public.payment_reconcile_queue
  ADD CONSTRAINT payment_reconcile_queue_matched_profile_id_fkey
  FOREIGN KEY (matched_profile_id)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN public.payment_reconcile_queue.matched_profile_id IS
  'Optional profile match; cleared when the profile is deleted so reconciliation history is retained.';
