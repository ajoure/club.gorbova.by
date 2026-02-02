-- PATCH-1: Add columns to card_profile_links for proper linking audit
ALTER TABLE public.card_profile_links 
ADD COLUMN IF NOT EXISTS linked_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Create RPC for backfilling payments by card fingerprint (last4 + brand)
CREATE OR REPLACE FUNCTION public.backfill_payments_by_card(
  p_profile_id UUID,
  p_card_last4 TEXT,
  p_card_brand TEXT,
  p_dry_run BOOLEAN DEFAULT true,
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_matched_count INTEGER := 0;
  v_updated_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_sample_uids TEXT[] := ARRAY[]::TEXT[];
  v_payment RECORD;
BEGIN
  -- Validate inputs
  IF p_profile_id IS NULL OR p_card_last4 IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'profile_id and card_last4 are required'
    );
  END IF;
  
  -- Normalize brand
  p_card_brand := COALESCE(LOWER(p_card_brand), 'unknown');
  
  -- Find matching payments without profile_id
  FOR v_payment IN
    SELECT id, provider_payment_id, profile_id, card_last4, card_brand
    FROM payments_v2
    WHERE card_last4 = p_card_last4
      AND LOWER(COALESCE(card_brand, 'unknown')) = p_card_brand
      AND provider = 'bepaid'
    ORDER BY paid_at DESC
    LIMIT p_limit
  LOOP
    v_matched_count := v_matched_count + 1;
    
    -- Skip if already linked to a different profile (guard)
    IF v_payment.profile_id IS NOT NULL AND v_payment.profile_id != p_profile_id THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;
    
    -- Skip if already linked to the same profile
    IF v_payment.profile_id = p_profile_id THEN
      CONTINUE;
    END IF;
    
    -- Collect sample UID (max 5)
    IF array_length(v_sample_uids, 1) IS NULL OR array_length(v_sample_uids, 1) < 5 THEN
      v_sample_uids := array_append(v_sample_uids, LEFT(v_payment.provider_payment_id, 12));
    END IF;
    
    -- Apply update if not dry_run
    IF NOT p_dry_run THEN
      UPDATE payments_v2
      SET 
        profile_id = p_profile_id,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'card_backfill', true,
          'backfill_at', now()::text,
          'backfill_card', p_card_last4
        )
      WHERE id = v_payment.id;
      
      v_updated_count := v_updated_count + 1;
    ELSE
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;
  
  -- Log to audit_logs if not dry_run
  IF NOT p_dry_run AND v_updated_count > 0 THEN
    INSERT INTO audit_logs (
      actor_type, actor_user_id, actor_label, action, meta
    ) VALUES (
      'system', NULL, 'backfill_payments_by_card',
      'payment.card_backfill',
      jsonb_build_object(
        'profile_id', p_profile_id,
        'card_last4', p_card_last4,
        'card_brand', p_card_brand,
        'matched', v_matched_count,
        'updated', v_updated_count,
        'skipped', v_skipped_count
      )
    );
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'dry_run', p_dry_run,
    'matched', v_matched_count,
    'updated', v_updated_count,
    'skipped', v_skipped_count,
    'sample_uids', v_sample_uids
  );
END;
$$;

-- Grant execute to authenticated users (RPC is SECURITY DEFINER)
GRANT EXECUTE ON FUNCTION public.backfill_payments_by_card TO authenticated;

COMMENT ON FUNCTION public.backfill_payments_by_card IS 
'PATCH-1: Backfill payments_v2.profile_id for all payments matching a card (last4 + brand). 
Skips payments already linked to a different profile. Use dry_run=true for preview.';