DO $$
DECLARE
  constraint_name text;
  author_is_required boolean;
BEGIN
  SELECT a.attnotnull
    INTO author_is_required
    FROM pg_attribute AS a
   WHERE a.attrelid = 'public.referral_partners'::regclass
     AND a.attname = 'created_by'
     AND NOT a.attisdropped;

  IF author_is_required THEN
    RAISE EXCEPTION
      'referral_partners.created_by is unexpectedly NOT NULL; refusing to change delete behavior';
  END IF;

  SELECT c.conname
    INTO constraint_name
    FROM pg_constraint AS c
   WHERE c.conrelid = 'public.referral_partners'::regclass
     AND c.contype = 'f'
     AND c.confrelid = 'auth.users'::regclass
     AND c.conkey = ARRAY[
       (SELECT a.attnum
          FROM pg_attribute AS a
         WHERE a.attrelid = 'public.referral_partners'::regclass
           AND a.attname = 'created_by'
           AND NOT a.attisdropped)
     ]::smallint[]
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.referral_partners DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END
$$;

ALTER TABLE public.referral_partners
  ADD CONSTRAINT referral_partners_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN public.referral_partners.created_by IS
  'Optional audit author; cleared when the auth user is deleted while referral-partner history is retained.';