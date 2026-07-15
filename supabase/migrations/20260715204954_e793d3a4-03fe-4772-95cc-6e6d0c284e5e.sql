-- Phase B, Step 2: server-side guard for dynamic-slot offers.
-- Enforces that any active tariff_offer belonging to a product whose tariffs
-- already opted into dynamic slots (i.e. at least one offer on that product
-- has meta.slot_role set) MUST carry both meta.slot_role and
-- meta.site_button_variant. Uniqueness of (tariff_id, slot_role) is already
-- guaranteed by the partial unique index installed in Step 1.
--
-- Fail-closed: bypass writers (raw SQL, admin RPC, bulk import) cannot create
-- an active offer for PRD-000039 without the required metadata.

CREATE OR REPLACE FUNCTION public.enforce_tariff_offer_slot_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_product_uses_slots boolean;
  v_role text;
  v_variant text;
BEGIN
  -- Only guard active rows. Inactive offers are exempt (soft-disable path).
  IF COALESCE(NEW.is_active, true) = false THEN
    RETURN NEW;
  END IF;

  SELECT t.product_id INTO v_product_id
  FROM public.tariffs t
  WHERE t.id = NEW.tariff_id;

  IF v_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Product is "opted in" to dynamic slots if at least one offer under any of
  -- its tariffs already carries meta.slot_role (excluding this row itself).
  SELECT EXISTS (
    SELECT 1
    FROM public.tariff_offers o
    JOIN public.tariffs t ON t.id = o.tariff_id
    WHERE t.product_id = v_product_id
      AND o.id <> NEW.id
      AND (o.meta ->> 'slot_role') IS NOT NULL
      AND (o.meta ->> 'slot_role') <> ''
  ) INTO v_product_uses_slots;

  IF NOT v_product_uses_slots THEN
    RETURN NEW;
  END IF;

  v_role := NEW.meta ->> 'slot_role';
  v_variant := NEW.meta ->> 'site_button_variant';

  IF v_role IS NULL OR v_role = '' THEN
    RAISE EXCEPTION 'tariff_offers.meta.slot_role is required for active offers on dynamic-slot products (product_id=%, offer_id=%)',
      v_product_id, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_variant IS NULL OR v_variant NOT IN ('primary','outline','installment','legal_entity','lead') THEN
    RAISE EXCEPTION 'tariff_offers.meta.site_button_variant must be one of primary|outline|installment|legal_entity|lead for active offers on dynamic-slot products (offer_id=%, got=%)',
      NEW.id, COALESCE(v_variant, '<null>')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tariff_offer_slot_role ON public.tariff_offers;
CREATE TRIGGER trg_enforce_tariff_offer_slot_role
BEFORE INSERT OR UPDATE ON public.tariff_offers
FOR EACH ROW EXECUTE FUNCTION public.enforce_tariff_offer_slot_role();