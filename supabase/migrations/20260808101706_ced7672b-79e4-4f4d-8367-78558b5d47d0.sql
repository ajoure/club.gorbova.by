-- Keep Telegram channel membership observable/revocable while allowing a club
-- to issue new access only to its chat.
ALTER TABLE public.telegram_clubs
  ADD COLUMN IF NOT EXISTS channel_grant_enabled boolean;

UPDATE public.telegram_clubs
SET channel_grant_enabled = true
WHERE channel_grant_enabled IS NULL;

ALTER TABLE public.telegram_clubs
  ALTER COLUMN channel_grant_enabled SET DEFAULT true,
  ALTER COLUMN channel_grant_enabled SET NOT NULL;

COMMENT ON COLUMN public.telegram_clubs.channel_grant_enabled IS
  'When false, new/reissued access omits the Telegram channel. The channel_id remains configured for sync, revoke, kick and audit.';

-- Owner-approved club policy: «Бухгалтерия как бизнес» grants chat only.
-- Fail closed if the canonical production club cannot be identified exactly.
DO $$
DECLARE
  v_affected integer;
BEGIN
  UPDATE public.telegram_clubs
  SET channel_grant_enabled = false,
      updated_at = now()
  WHERE id = '4f8f9d8f-07ce-4898-8012-39f1035c1456'::uuid
    AND club_name = 'Бухгалтерия как бизнес';

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one canonical Бухгалтерия как бизнес club, updated %',
      v_affected;
  END IF;
END
$$;