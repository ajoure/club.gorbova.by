-- Phase 7-UI hotfix: drop acquiring_stripe_missing_price_id guard.
-- Reason: price_id stopped being part of offer SOT in Phase 6-G boundary
-- (lazy provisioning via admin-provision-stripe-price + admin-create-public-link).
-- The DB guard contradicts both UI (validateOfferAcquiring no longer requires it)
-- and backend canon. All other validations preserved verbatim.

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

  -- NOTE: acquiring_stripe_missing_price_id check intentionally removed (Phase 7-UI hotfix).
  -- price_id is now provisioned lazily at payment-link / checkout time.

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

-- ============================================================================
-- ROLLBACK (manual, run only if explicitly approved):
-- ============================================================================
-- CREATE OR REPLACE FUNCTION public.tariff_offers_acquiring_validate()
-- RETURNS TRIGGER
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- DECLARE
--   v_acq jsonb := NEW.meta->'acquiring';
--   v_providers jsonb;
--   v_has_stripe boolean;
--   v_has_bepaid boolean;
--   v_price_id text;
--   v_default text;
--   v_is_installment boolean;
-- BEGIN
--   IF v_acq IS NULL THEN RETURN NEW; END IF;
--   v_providers := v_acq->'allowed_payment_providers';
--   IF v_providers IS NULL OR jsonb_typeof(v_providers) <> 'array' OR jsonb_array_length(v_providers) = 0 THEN
--     RAISE EXCEPTION 'acquiring_no_providers: meta.acquiring.allowed_payment_providers must be non-empty array';
--   END IF;
--   IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_providers) p WHERE p NOT IN ('bepaid','stripe')) THEN
--     RAISE EXCEPTION 'acquiring_unknown_provider: allowed providers must be subset of {bepaid,stripe}';
--   END IF;
--   v_has_stripe := v_providers @> '["stripe"]'::jsonb;
--   v_has_bepaid := v_providers @> '["bepaid"]'::jsonb;
--   v_is_installment := COALESCE(NEW.payment_method = 'internal_installment', false);
--   IF v_is_installment AND v_has_stripe THEN
--     RAISE EXCEPTION 'stripe_installment_not_supported: Stripe пока не поддерживает рассрочку';
--   END IF;
--   IF v_has_stripe THEN
--     v_price_id := v_acq->'stripe'->>'price_id';
--     IF v_price_id IS NULL OR length(trim(v_price_id)) = 0 THEN
--       RAISE EXCEPTION 'acquiring_stripe_missing_price_id: Stripe enabled but stripe.price_id is empty';
--     END IF;
--   END IF;
--   v_default := v_acq->>'default_provider';
--   IF jsonb_array_length(v_providers) = 1 THEN
--     v_default := v_providers->>0;
--   ELSIF v_default IS NULL OR v_default NOT IN ('bepaid','stripe')
--         OR NOT (v_providers @> to_jsonb(ARRAY[v_default])) THEN
--     v_default := 'bepaid';
--   END IF;
--   NEW.meta := jsonb_set(NEW.meta, '{acquiring,default_provider}', to_jsonb(v_default), true);
--   IF (v_acq->'customer_choice_enabled') IS NULL THEN
--     NEW.meta := jsonb_set(NEW.meta, '{acquiring,customer_choice_enabled}', 'false'::jsonb, true);
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
-- ============================================================================