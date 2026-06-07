CREATE OR REPLACE FUNCTION public.tariff_offers_acquiring_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb := COALESCE(OLD.meta->'acquiring', '{}'::jsonb);
  v_new jsonb := COALESCE(NEW.meta->'acquiring', '{}'::jsonb);
  v_actor uuid;
BEGIN
  IF v_old IS DISTINCT FROM v_new THEN
    BEGIN
      v_actor := auth.uid();
    EXCEPTION WHEN OTHERS THEN
      v_actor := NULL;
    END;

    INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_user_id, meta)
    VALUES (
      'offer.acquiring.updated',
      'tariff_offer',
      NEW.id::text,
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
  END IF;
  RETURN NEW;
END;
$$;