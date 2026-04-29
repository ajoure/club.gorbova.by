-- Problem:
-- After PATCH 20260429083952, trigger trg_subscription_grant_telegram still enqueues
-- a second telegram_access_queue grant for provider-managed public-link subscriptions
-- because their canonical markers are different (meta.source='public_link_subscription',
-- meta.checkout_order_id, meta.tracking_id='subv2:%:order:%', meta.extended_by_orders).
--
-- Diagnose:
-- Confirmed live: subscription 085952d5-ef13-41c6-91e3-a49d431b5e7d for user
-- f32ff3d9-7411-49da-969a-da8451044351 had:
--   meta.source='public_link_subscription'
--   meta.checkout_order_id='3e376279-...'
--   meta.tracking_id='subv2:085952d5-...:order:3e376279-...'
--   meta.extended_by_orders=['3e376279-...']
-- but none of the existing canonical guards matched, so a queue row was inserted
-- and telegram-grant-access sent a second "Доступ открыт!" DM (telegram message_id 17170)
-- 10 seconds after the canonical one (17164) from grant-access-for-order.
--
-- Execute:
-- Extend the canonical-path guard with public-link / tracking_id / extended_by_orders
-- markers. Per user instruction: do NOT block on order_id alone (that could affect
-- legitimate legacy subscriptions). Manual paths are unaffected — manual grants do
-- not go through this trigger.
--
-- STOP-guards:
-- - Additive only, no DELETE, no schema change, only function body update.
-- - Existing queue rows are not touched.
-- - Manual admin grants bypass this trigger entirely (they call telegram-grant-access directly with is_manual=true).
--
-- DoD:
-- For a fresh provider-managed public-link payment, no extra row appears in
-- telegram_access_queue, and the user receives only one "Доступ открыт!" DM.

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
  meta_source text;
  meta_tracking_id text;
  meta_extended_count int;
BEGIN
  -- Only for active or trial subscriptions
  IF NEW.status NOT IN ('active', 'trial') THEN
    RETURN NEW;
  END IF;

  meta_source := COALESCE(NEW.meta->>'source', '');
  meta_tracking_id := COALESCE(NEW.meta->>'tracking_id', '');
  meta_extended_count := COALESCE(jsonb_array_length(NEW.meta->'extended_by_orders'), 0);

  -- CANONICAL PATH GUARD (extended):
  -- grant-access-for-order is the canonical write-path and already calls
  -- telegram-grant-access with source_id=order_id. Skip the legacy queue path
  -- whenever the subscription has any marker that proves it was created/extended
  -- by a canonical order/checkout flow.
  created_by_canonical_grant :=
       COALESCE(NEW.meta->>'granted_by', '') = 'grant-access-for-order'
    OR meta_source = 'grant-access-for-order'
    OR NEW.meta ? 'initial_order_id'
    -- Public-link / installment provider-managed checkout (pre-create from create-payment-checkout)
    OR meta_source IN ('public_link_subscription', 'public_link_installment')
    -- Canonical tracking id format: subv2:{sub_id}:order:{order_id}
    OR meta_tracking_id LIKE 'subv2:%:order:%'
    -- Subscription has a checkout order linked or has been extended by at least one canonical order
    OR NEW.meta ? 'checkout_order_id'
    OR meta_extended_count > 0;

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
      RETURN NEW;
    END IF;
  END IF;

  -- GUARD 2: Don't queue if access_end_at already expired
  IF NEW.access_end_at IS NOT NULL AND NEW.access_end_at < NOW() THEN
    RETURN NEW;
  END IF;

  -- GUARD 4 (business-sense): On UPDATE, skip if no real activation change
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status
       AND OLD.tariff_id IS NOT DISTINCT FROM NEW.tariff_id
       AND OLD.product_id IS NOT DISTINCT FROM NEW.product_id
       AND (
         OLD.access_end_at IS NOT DISTINCT FROM NEW.access_end_at
         OR (NEW.access_end_at IS NOT NULL AND OLD.access_end_at IS NOT NULL AND NEW.access_end_at <= OLD.access_end_at)
       )
    THEN
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
      CONTINUE;
    END IF;

    SELECT telegram_user_id, telegram_link_status
    INTO profile_telegram
    FROM profiles
    WHERE user_id = NEW.user_id;

    IF profile_telegram.telegram_user_id IS NOT NULL
       AND profile_telegram.telegram_link_status = 'active' THEN
      INSERT INTO telegram_access_queue (user_id, club_id, subscription_id, action, status)
      VALUES (NEW.user_id, club_mapping.club_id, NEW.id, 'grant', 'pending')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.trg_subscription_grant_telegram() IS
  'Legacy Telegram queue trigger. Skips subscriptions already handled by canonical grant-access-for-order or public-link checkout (markers: granted_by, source IN (grant-access-for-order, public_link_subscription, public_link_installment), initial_order_id, checkout_order_id, tracking_id LIKE subv2:%:order:%, extended_by_orders not empty) to prevent duplicate access-opened messages. Manual admin grants do not go through this trigger.';