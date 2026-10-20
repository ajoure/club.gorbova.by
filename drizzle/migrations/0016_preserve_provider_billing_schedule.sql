-- Keep provider billing separate from learning access. No data backfill.
-- CREATE OR REPLACE preserves the existing trigger binding and function ACL.
CREATE OR REPLACE FUNCTION public.ensure_billing_alignment()
RETURNS TRIGGER AS $$
DECLARE
  is_club BOOLEAN;
BEGIN
  -- Check if this is a club product
  is_club := (NEW.product_id = '11c9f1b8-0355-4753-bd74-40b42aa53616');
  
  -- Only apply rules to club products
  IF NOT is_club THEN
    RETURN NEW;
  END IF;

  -- A provider-managed stream owns its billing schedule. Its verified next
  -- charge may precede the independent calendar-month learning window.
  -- Never derive a provider schedule (including NULL) from access_end_at.
  IF NEW.billing_type = 'provider_managed' THEN
    RETURN NEW;
  END IF;

  -- Rule 1: If auto_renew=true and next_charge_at IS NULL, set it to access_end_at
  IF NEW.auto_renew = true 
     AND NEW.status IN ('active', 'trial', 'past_due')
     AND NEW.access_end_at IS NOT NULL 
     AND NEW.next_charge_at IS NULL THEN
    
    NEW.next_charge_at := NEW.access_end_at;
    
    -- Log the auto-fix
    INSERT INTO public.audit_logs (action, actor_type, actor_label, meta)
    VALUES (
      'billing.null_charge_date_auto_set',
      'system',
      'ensure_billing_alignment_trigger',
      jsonb_build_object(
        'subscription_id', NEW.id,
        'set_to', NEW.access_end_at::text,
        'trigger_reason', 'next_charge_at_was_null'
      )
    );
  END IF;

  -- Rule 2: If next_charge_at < access_end_at (misaligned), correct it
  IF NEW.next_charge_at IS NOT NULL 
     AND NEW.access_end_at IS NOT NULL 
     AND NEW.next_charge_at < NEW.access_end_at THEN
    
    -- Log the auto-correction
    INSERT INTO public.audit_logs (action, actor_type, actor_label, meta)
    VALUES (
      'billing.charge_date_auto_corrected',
      'system',
      'ensure_billing_alignment_trigger',
      jsonb_build_object(
        'subscription_id', NEW.id,
        'original_next_charge_at', NEW.next_charge_at::text,
        'corrected_to', NEW.access_end_at::text
      )
    );
    
    NEW.next_charge_at := NEW.access_end_at;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


