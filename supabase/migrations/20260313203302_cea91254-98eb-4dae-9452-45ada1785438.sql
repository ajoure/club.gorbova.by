
-- ============================================================
-- PATCH TG-SUBSCRIPTION-SAVE-FALSE-GRANT + TG-CLUB-LINKAGE-INTEGRITY
-- Phase 1: Hardened trigger with business-sense guard (Guard 4)
-- Phase 2.6: Club-product linkage validation function
-- ============================================================

-- 1. Hardened trigger function with Guard 4 (business-sense)
CREATE OR REPLACE FUNCTION trg_subscription_grant_telegram()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  club_mapping RECORD;
  profile_telegram RECORD;
BEGIN
  -- Only for active or trial subscriptions
  IF NEW.status NOT IN ('active', 'trial') THEN
    RETURN NEW;
  END IF;

  -- GUARD 1 (whitelist): Only react to access-relevant field changes on UPDATE
  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      OLD.status IS DISTINCT FROM NEW.status OR
      OLD.access_end_at IS DISTINCT FROM NEW.access_end_at OR
      OLD.tariff_id IS DISTINCT FROM NEW.tariff_id OR
      OLD.product_id IS DISTINCT FROM NEW.product_id
    ) THEN
      -- Technical UPDATE (notes, meta, payment_method_id, etc.) — skip
      RETURN NEW;
    END IF;
  END IF;

  -- GUARD 2: Don't queue if access_end_at already expired
  IF NEW.access_end_at IS NOT NULL AND NEW.access_end_at < NOW() THEN
    RETURN NEW;
  END IF;

  -- GUARD 4 (NEW - business-sense): On UPDATE, skip if no real activation change
  -- This prevents false grants from Save that re-sends same values (toISOString mismatch)
  IF TG_OP = 'UPDATE' THEN
    -- If status didn't change AND access_end_at was not extended forward — skip
    IF OLD.status IS NOT DISTINCT FROM NEW.status
       AND OLD.tariff_id IS NOT DISTINCT FROM NEW.tariff_id
       AND OLD.product_id IS NOT DISTINCT FROM NEW.product_id
       AND (
         OLD.access_end_at IS NOT DISTINCT FROM NEW.access_end_at
         OR (NEW.access_end_at IS NOT NULL AND OLD.access_end_at IS NOT NULL AND NEW.access_end_at <= OLD.access_end_at)
       )
    THEN
      -- No real business change — just a re-save or minor date adjustment backward
      RETURN NEW;
    END IF;
  END IF;

  -- Find active product-club mappings for this product
  FOR club_mapping IN 
    SELECT pcm.club_id 
    FROM product_club_mappings pcm
    WHERE pcm.product_id = NEW.product_id AND pcm.is_active = true
  LOOP
    -- GUARD 3: Don't queue if recent revoke exists for this user+club (race protection)
    IF EXISTS (
      SELECT 1 FROM telegram_access
      WHERE user_id = NEW.user_id
        AND club_id = club_mapping.club_id
        AND state_chat = 'revoked'
        AND updated_at > NOW() - INTERVAL '5 minutes'
    ) THEN
      CONTINUE; -- Skip this club, recent revoke
    END IF;

    -- Check if user has Telegram linked
    SELECT telegram_user_id, telegram_link_status 
    INTO profile_telegram
    FROM profiles 
    WHERE user_id = NEW.user_id;
    
    IF profile_telegram.telegram_user_id IS NOT NULL 
       AND profile_telegram.telegram_link_status = 'active' THEN
      -- Add to queue (upsert: if already pending for same user/club/sub, skip)
      INSERT INTO telegram_access_queue (user_id, club_id, subscription_id, action, status)
      VALUES (NEW.user_id, club_mapping.club_id, NEW.id, 'grant', 'pending')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- 2. Club-product linkage validation function
CREATE OR REPLACE FUNCTION public.validate_club_product_linkage(
  p_club_id uuid,
  p_subscription_id uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL
)
RETURNS TABLE(
  valid boolean,
  reason text,
  resolved_product_id uuid,
  resolved_club_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_mapping_exists boolean;
BEGIN
  -- Resolve product_id from subscription if not provided
  IF p_product_id IS NOT NULL THEN
    v_product_id := p_product_id;
  ELSIF p_subscription_id IS NOT NULL THEN
    SELECT s.product_id INTO v_product_id
    FROM subscriptions_v2 s
    WHERE s.id = p_subscription_id;
    
    IF v_product_id IS NULL THEN
      RETURN QUERY SELECT false, 'subscription_not_found'::text, NULL::uuid, p_club_id;
      RETURN;
    END IF;
  ELSE
    RETURN QUERY SELECT false, 'no_product_or_subscription'::text, NULL::uuid, p_club_id;
    RETURN;
  END IF;

  -- Check if product is mapped to this club
  SELECT EXISTS(
    SELECT 1 FROM product_club_mappings pcm
    WHERE pcm.product_id = v_product_id
      AND pcm.club_id = p_club_id
      AND pcm.is_active = true
  ) INTO v_mapping_exists;

  IF v_mapping_exists THEN
    RETURN QUERY SELECT true, 'ok'::text, v_product_id, p_club_id;
  ELSE
    RETURN QUERY SELECT false, 'club_product_mismatch'::text, v_product_id, p_club_id;
  END IF;
  
  RETURN;
END;
$$;

-- 3. Update has_valid_access_for_club to ensure it exists and is current
CREATE OR REPLACE FUNCTION public.has_valid_access_for_club(p_user_id uuid, p_club_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Active subscription with product mapped to this club
  IF EXISTS (
    SELECT 1
    FROM subscriptions_v2 s
    JOIN product_club_mappings pcm ON pcm.product_id = s.product_id AND pcm.is_active = true
    WHERE s.user_id = p_user_id
      AND pcm.club_id = p_club_id
      AND s.status IN ('active', 'trial', 'past_due')
      AND (s.access_end_at IS NULL OR s.access_end_at > NOW())
  ) THEN
    RETURN true;
  END IF;

  -- 2. Active entitlement
  IF EXISTS (
    SELECT 1
    FROM entitlements e
    WHERE e.user_id = p_user_id
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > NOW())
  ) THEN
    RETURN true;
  END IF;

  -- 3. Manual access
  IF EXISTS (
    SELECT 1
    FROM telegram_manual_access tma
    WHERE tma.user_id = p_user_id
      AND tma.club_id = p_club_id
      AND tma.is_active = true
      AND (tma.valid_until IS NULL OR tma.valid_until > NOW())
  ) THEN
    RETURN true;
  END IF;

  -- 4. telegram_access not revoked
  IF EXISTS (
    SELECT 1
    FROM telegram_access ta
    WHERE ta.user_id = p_user_id
      AND ta.club_id = p_club_id
      AND ta.state_chat != 'revoked'
      AND ta.state_channel != 'revoked'
      AND (ta.active_until IS NULL OR ta.active_until > NOW())
  ) THEN
    RETURN true;
  END IF;

  -- 5. Active grant
  IF EXISTS (
    SELECT 1
    FROM telegram_access_grants tag
    WHERE tag.user_id = p_user_id
      AND tag.club_id = p_club_id
      AND tag.status = 'active'
      AND (tag.end_at IS NULL OR tag.end_at > NOW())
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;
