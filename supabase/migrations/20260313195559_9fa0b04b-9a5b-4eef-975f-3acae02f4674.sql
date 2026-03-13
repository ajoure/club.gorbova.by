
-- PATCH TG-REVOKE-FALSE-REGRANT: ФАЗА 1 — SQL trigger guard + ФАЗА 6 — SQL function + view

-- ============================================================
-- 1. SQL function has_valid_access_for_club (единый SoT для SQL)
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_valid_access_for_club(p_user_id uuid, p_club_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now timestamptz := now();
BEGIN
  -- 1. subscriptions_v2 (highest priority)
  IF EXISTS (
    SELECT 1 FROM subscriptions_v2 s
    JOIN product_club_mappings pcm ON pcm.product_id = s.product_id AND pcm.is_active = true AND pcm.club_id = p_club_id
    WHERE s.user_id = p_user_id
      AND s.status IN ('active', 'trial', 'past_due')
      AND (s.access_end_at IS NULL OR s.access_end_at > _now)
  ) THEN
    RETURN true;
  END IF;

  -- 2. entitlements
  IF EXISTS (
    SELECT 1 FROM entitlements e
    JOIN products_v2 pv ON pv.code = e.product_code
    JOIN product_club_mappings pcm ON pcm.product_id = pv.id AND pcm.is_active = true AND pcm.club_id = p_club_id
    WHERE e.user_id = p_user_id
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > _now)
  ) THEN
    RETURN true;
  END IF;

  -- 3. telegram_manual_access
  IF EXISTS (
    SELECT 1 FROM telegram_manual_access tma
    WHERE tma.user_id = p_user_id
      AND tma.club_id = p_club_id
      AND tma.is_active = true
      AND (tma.valid_until IS NULL OR tma.valid_until > _now)
  ) THEN
    RETURN true;
  END IF;

  -- 4. telegram_access (not revoked)
  IF EXISTS (
    SELECT 1 FROM telegram_access ta
    WHERE ta.user_id = p_user_id
      AND ta.club_id = p_club_id
      AND (ta.active_until IS NULL OR ta.active_until > _now)
      AND ta.state_chat != 'revoked'
      AND ta.state_channel != 'revoked'
  ) THEN
    RETURN true;
  END IF;

  -- 5. telegram_access_grants
  IF EXISTS (
    SELECT 1 FROM telegram_access_grants tag
    WHERE tag.user_id = p_user_id
      AND tag.club_id = p_club_id
      AND tag.status = 'active'
      AND (tag.end_at IS NULL OR tag.end_at > _now)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- ============================================================
-- 2. Hardened trigger function with whitelist + guards
-- ============================================================
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

-- ============================================================
-- 3. Update v_club_members_enriched to use has_valid_access_for_club
-- ============================================================
CREATE OR REPLACE VIEW v_club_members_enriched AS
SELECT 
  tcm.id,
  tcm.club_id,
  tcm.telegram_user_id,
  tcm.telegram_username,
  tcm.telegram_first_name,
  tcm.telegram_last_name,
  tcm.in_chat,
  tcm.in_channel,
  tcm.profile_id,
  tcm.link_status,
  tcm.access_status,
  tcm.created_at,
  tcm.updated_at,
  p.user_id AS auth_user_id,
  p.email,
  p.full_name,
  p.phone,
  p.external_id_amo,
  CASE
    WHEN p.user_id IS NULL THEN false
    ELSE has_valid_access_for_club(p.user_id, tcm.club_id)
  END AS has_active_access,
  CASE
    WHEN p.user_id IS NULL THEN false
    ELSE (
      EXISTS (SELECT 1 FROM telegram_access ta WHERE ta.user_id = p.user_id AND ta.club_id = tcm.club_id)
      OR EXISTS (SELECT 1 FROM telegram_manual_access tma WHERE tma.user_id = p.user_id AND tma.club_id = tcm.club_id)
      OR EXISTS (SELECT 1 FROM telegram_access_grants tag WHERE tag.user_id = p.user_id AND tag.club_id = tcm.club_id)
    )
  END AS has_any_access_history,
  (COALESCE(tcm.in_chat, false) OR COALESCE(tcm.in_channel, false)) AS in_any,
  ((tcm.telegram_user_id IS NULL) OR (tcm.telegram_user_id < 100)) AS is_orphaned
FROM telegram_club_members tcm
LEFT JOIN profiles p ON p.id = tcm.profile_id;
