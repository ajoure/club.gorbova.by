-- Referral partner lifecycle sync with profile archival/deletion
-- Historical financial ledger (referral_balance_entries, referral_sale_attributions,
-- referral_balance_transactions, referral_payout_requests, referral_bonus_reservations)
-- is intentionally left untouched.

CREATE OR REPLACE FUNCTION public.referral_close_partner_for_profile(
  _profile_id uuid,
  _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _partner_id uuid;
BEGIN
  SELECT id INTO _partner_id
    FROM public.referral_partners
    WHERE profile_id = _profile_id;

  IF _partner_id IS NULL THEN RETURN; END IF;

  UPDATE public.referral_partners
    SET status = 'closed',
        status_reason = COALESCE(NULLIF(status_reason, ''), _reason),
        metadata = COALESCE(metadata, '{}'::jsonb)
                   || jsonb_build_object(
                        'closed_at', now(),
                        'closed_reason', _reason
                      ),
        updated_at = now()
    WHERE id = _partner_id
      AND status <> 'closed';

  UPDATE public.referral_program_links
    SET status = 'paused', updated_at = now()
    WHERE partner_id = _partner_id
      AND status = 'active';

  UPDATE public.referral_relationships
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb)
                   || jsonb_build_object('revoked_reason', _reason)
    WHERE partner_id = _partner_id
      AND status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.referral_close_partner_for_profile(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_close_partner_for_profile(uuid, text) TO service_role;

-- Trigger: profile archival (status='archived' or is_archived=true) closes partner
CREATE OR REPLACE FUNCTION public.referral_sync_partner_on_profile_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
       (NEW.status = 'archived' AND (OLD.status IS DISTINCT FROM NEW.status))
    OR (NEW.is_archived = true  AND (OLD.is_archived IS DISTINCT FROM NEW.is_archived))
  ) THEN
    PERFORM public.referral_close_partner_for_profile(NEW.id, 'profile_archived');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_referral_partner_close_trg ON public.profiles;
CREATE TRIGGER profiles_referral_partner_close_trg
  AFTER UPDATE OF status, is_archived ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.referral_sync_partner_on_profile_archive();

-- Trigger: hard delete of profile closes partner first (no FK CASCADE exists)
CREATE OR REPLACE FUNCTION public.referral_close_partner_on_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.referral_close_partner_for_profile(OLD.id, 'profile_deleted');
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS profiles_referral_partner_close_delete_trg ON public.profiles;
CREATE TRIGGER profiles_referral_partner_close_delete_trg
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.referral_close_partner_on_profile_delete();

-- Admin summary: exclude closed partners
CREATE OR REPLACE FUNCTION public.referral_admin_get_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  v_result jsonb;
begin
  if not public.referral_is_admin((select auth.uid())) then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'partners_count', (select count(*) from public.referral_partners where status <> 'closed'),
    'relationships_count', (select count(*) from public.referral_relationships where status = 'active'),
    'sales_count', (select count(*) from public.referral_sale_attributions),
    'pending_minor', coalesce((select sum(amount_minor) from public.referral_balance_entries where bucket in ('pending', 'internal_pending')), 0),
    'available_minor', coalesce((select sum(amount_minor) from public.referral_balance_entries where bucket = 'available'), 0),
    'internal_minor', coalesce((select sum(amount_minor) from public.referral_balance_entries where bucket = 'internal'), 0),
    'held_minor', coalesce((select sum(amount_minor) from public.referral_balance_entries where bucket = 'held'), 0),
    'paid_minor', coalesce((select sum(amount_minor) from public.referral_balance_entries where bucket = 'paid'), 0)
  ) into v_result;

  return v_result;
end;
$$;

-- Backfill: archived profiles that still have active partners
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.id
      FROM public.profiles p
      JOIN public.referral_partners rp ON rp.profile_id = p.id
      WHERE rp.status = 'active'
        AND (p.status = 'archived' OR p.is_archived = true)
  LOOP
    PERFORM public.referral_close_partner_for_profile(r.id, 'profile_archived_backfill');
  END LOOP;
END $$;
