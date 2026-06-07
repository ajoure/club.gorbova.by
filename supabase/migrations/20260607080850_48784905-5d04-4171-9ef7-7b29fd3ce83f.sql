-- Phase 5-B: Server-side validation + per-offer audit for tariff_offers.meta.acquiring

CREATE OR REPLACE FUNCTION public.tariff_offers_acquiring_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acq jsonb := NEW.meta->'acquiring';
  v_providers jsonb;
  v_has_stripe boolean;
  v_has_bepaid boolean;
  v_price_id text;
  v_default text;
  v_is_installment boolean;
BEGIN
  IF v_acq IS NULL THEN
    RETURN NEW;
  END IF;

  v_providers := v_acq->'allowed_payment_providers';
  IF v_providers IS NULL OR jsonb_typeof(v_providers) <> 'array' OR jsonb_array_length(v_providers) = 0 THEN
    RAISE EXCEPTION 'acquiring_no_providers: meta.acquiring.allowed_payment_providers must be non-empty array';
  END IF;

  -- Validate provider values
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_providers) p
    WHERE p NOT IN ('bepaid','stripe')
  ) THEN
    RAISE EXCEPTION 'acquiring_unknown_provider: allowed providers must be subset of {bepaid,stripe}';
  END IF;

  v_has_stripe := v_providers @> '["stripe"]'::jsonb;
  v_has_bepaid := v_providers @> '["bepaid"]'::jsonb;

  -- Installment guard
  v_is_installment := COALESCE(NEW.payment_method = 'internal_installment', false);
  IF v_is_installment AND v_has_stripe THEN
    RAISE EXCEPTION 'stripe_installment_not_supported: Stripe пока не поддерживает рассрочку';
  END IF;

  -- Stripe requires price_id
  IF v_has_stripe THEN
    v_price_id := v_acq->'stripe'->>'price_id';
    IF v_price_id IS NULL OR length(trim(v_price_id)) = 0 THEN
      RAISE EXCEPTION 'acquiring_stripe_missing_price_id: Stripe enabled but stripe.price_id is empty';
    END IF;
  END IF;

  -- Auto-derive default_provider
  v_default := v_acq->>'default_provider';
  IF jsonb_array_length(v_providers) = 1 THEN
    v_default := v_providers->>0;
  ELSIF v_default IS NULL OR v_default NOT IN ('bepaid','stripe')
        OR NOT (v_providers @> to_jsonb(ARRAY[v_default])) THEN
    v_default := 'bepaid';
  END IF;
  NEW.meta := jsonb_set(NEW.meta, '{acquiring,default_provider}', to_jsonb(v_default), true);

  -- Ensure customer_choice_enabled is bool
  IF (v_acq->'customer_choice_enabled') IS NULL THEN
    NEW.meta := jsonb_set(NEW.meta, '{acquiring,customer_choice_enabled}', 'false'::jsonb, true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tariff_offers_acquiring_validate ON public.tariff_offers;
CREATE TRIGGER trg_tariff_offers_acquiring_validate
  BEFORE INSERT OR UPDATE OF meta, payment_method ON public.tariff_offers
  FOR EACH ROW
  EXECUTE FUNCTION public.tariff_offers_acquiring_validate();

-- Per-offer audit on acquiring changes
CREATE OR REPLACE FUNCTION public.tariff_offers_acquiring_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb := OLD.meta->'acquiring';
  v_new jsonb := NEW.meta->'acquiring';
  v_actor uuid;
BEGIN
  IF v_old IS NOT DISTINCT FROM v_new THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_id, meta)
  VALUES (
    'offer.acquiring.updated',
    'tariff_offer',
    NEW.id,
    v_actor,
    jsonb_build_object(
      'offer_id', NEW.id,
      'tariff_id', NEW.tariff_id,
      'old_acquiring', v_old,
      'new_acquiring', v_new,
      'old_providers', v_old->'allowed_payment_providers',
      'new_providers', v_new->'allowed_payment_providers',
      'old_price_id', v_old->'stripe'->>'price_id',
      'new_price_id', v_new->'stripe'->>'price_id'
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tariff_offers_acquiring_audit ON public.tariff_offers;
CREATE TRIGGER trg_tariff_offers_acquiring_audit
  AFTER UPDATE OF meta ON public.tariff_offers
  FOR EACH ROW
  EXECUTE FUNCTION public.tariff_offers_acquiring_audit();