-- Problem:
-- Active subscription rows created by the canonical grant-access-for-order path already
-- trigger telegram-grant-access directly. The subscriptions_v2 trigger then enqueues
-- the same grant again via telegram_access_queue, causing a second Telegram DM.
--
-- Diagnose:
-- Confirmed by live rows for user 56de61af-3e13-4ab9-b492-8287a3d3cd21:
-- 1) telegram_messages source=telegram-grant-access, source_id=order_id, at 07:06
-- 2) telegram_messages source=telegram-grant-access, source_id=subscription_id, at 07:07
-- The second came from telegram_access_queue row created by trg_subscription_grant_telegram.
--
-- Dry-run evidence before execute:
-- SELECT pg_get_functiondef('public.trg_subscription_grant_telegram()'::regprocedure);
-- SELECT * FROM public.telegram_access_queue WHERE subscription_id = '<subscription_id>';
--
-- Execute:
-- Add a STOP-guard to the trigger: if a subscription row is already marked as
-- created/handled by grant-access-for-order, do not enqueue a secondary Telegram grant.
--
-- STOP-guard:
-- This does not delete rows, does not change existing access, and keeps the queue
-- available for legacy direct subscription writes.
--
-- DoD:
-- A canonical paid order produces one outgoing Telegram message: the mirrored blue
-- telegram_messages bubble from telegram-grant-access with source_id=order_id.
-- No extra pending queue row is created for the canonical subscription row.
--
-- SYSTEM ACTOR proof:
-- The trigger continues to operate as SECURITY DEFINER and only gates duplicate queue writes.

CREATE OR REPLACE FUNCTION public.trg_subscription_grant_telegram()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  club_mapping RECORD;
  profile_telegram RECORD;
  created_by_canonical_grant boolean;
BEGIN
  -- Only for active or trial subscriptions
  IF NEW.status NOT IN ('active', 'trial') THEN
    RETURN NEW;
  END IF;

  -- CANONICAL PATH GUARD:
  -- grant-access-for-order is the single write-path for paid access and already
  -- calls telegram-grant-access with source_id = order_id. If this trigger also
  -- queues by subscription_id, the user receives a second access-opened DM.
  created_by_canonical_grant :=
    COALESCE(NEW.meta->>'granted_by', '') = 'grant-access-for-order'
    OR COALESCE(NEW.meta->>'source', '') = 'grant-access-for-order'
    OR NEW.meta ? 'initial_order_id';

  IF created_by_canonical_grant THEN
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

  -- GUARD 4 (business-sense): On UPDATE, skip if no real activation change
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

  -- Find active product-club mappings for this product (legacy queue path)
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
$function$;

COMMENT ON FUNCTION public.trg_subscription_grant_telegram() IS
  'Legacy Telegram queue trigger. Skips subscriptions already handled by canonical grant-access-for-order to prevent duplicate access-opened messages.';