UPDATE public.tariff_offers
SET requires_card_tokenization = false
WHERE COALESCE(requires_card_tokenization, false) = true;

UPDATE public.tariff_offers
SET auto_charge_after_trial = false
WHERE COALESCE(auto_charge_after_trial, false) = true;

ALTER TABLE public.tariff_offers
  ALTER COLUMN requires_card_tokenization SET DEFAULT false,
  ALTER COLUMN auto_charge_after_trial    SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.tariff_offers_force_disable_mandatory_internal_mit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.requires_card_tokenization IS DISTINCT FROM false THEN
    NEW.requires_card_tokenization := false;
  END IF;
  IF NEW.auto_charge_after_trial IS DISTINCT FROM false THEN
    NEW.auto_charge_after_trial := false;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_tariff_offers_force_disable_mandatory_internal_mit ON public.tariff_offers;
CREATE TRIGGER trg_tariff_offers_force_disable_mandatory_internal_mit
BEFORE INSERT OR UPDATE OF requires_card_tokenization, auto_charge_after_trial
ON public.tariff_offers
FOR EACH ROW
EXECUTE FUNCTION public.tariff_offers_force_disable_mandatory_internal_mit();

INSERT INTO public.audit_logs (action, actor_type, actor_label, entity_type, meta)
VALUES (
  'patch_applied',
  'system',
  'PATCH-DISABLE-MANDATORY-INTERNAL-MIT-V1',
  'tariff_offers',
  jsonb_build_object(
    'patch', 'PATCH-DISABLE-MANDATORY-INTERNAL-MIT-V1',
    'scope', 'tariff_offers.requires_card_tokenization + auto_charge_after_trial → false; trigger guard installed',
    'note', 'Provider-side recurring (bePaid/Stripe) не затронут. Канон классификации подписки остался tariff_offers.meta.recurring.is_recurring.',
    'at', now()
  )
);