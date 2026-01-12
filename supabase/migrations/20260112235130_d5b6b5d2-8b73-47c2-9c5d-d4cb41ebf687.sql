-- Fix link_new_user_to_archived_profile trigger to use profile_id instead of user_id
-- The bug: orders/subscriptions were being updated WHERE user_id = archived_data.id
-- But archived_data.id is a PROFILE ID, not user_id!

CREATE OR REPLACE FUNCTION public.link_new_user_to_archived_profile()
RETURNS TRIGGER AS $$
DECLARE
  archived_data record;
BEGIN
  -- Find archived profile with this email
  SELECT id, full_name, first_name, last_name, phone, phones, emails, telegram_username, 
         telegram_user_id, was_club_member
  INTO archived_data
  FROM profiles
  WHERE (email = NEW.email OR emails @> to_jsonb(NEW.email::text))
    AND status = 'archived'
    AND user_id IS NULL
  LIMIT 1;
  
  IF archived_data.id IS NOT NULL THEN
    -- Update archived profile: link to new user
    UPDATE profiles SET
      user_id = NEW.id,
      status = 'active',
      updated_at = NOW()
    WHERE id = archived_data.id;
    
    -- FIX: Transfer orders by profile_id, not user_id
    UPDATE orders_v2 SET
      user_id = NEW.id,
      updated_at = NOW()
    WHERE profile_id = archived_data.id;
    
    -- FIX: Transfer subscriptions by profile_id
    UPDATE subscriptions_v2 SET
      user_id = NEW.id,
      updated_at = NOW()
    WHERE profile_id = archived_data.id;
    
    -- FIX: Transfer entitlements by profile_id
    UPDATE entitlements SET
      user_id = NEW.id,
      updated_at = NOW()
    WHERE profile_id = archived_data.id;
    
    -- Create club entitlements for paid orders if not exists
    INSERT INTO entitlements (user_id, profile_id, product_code, status, expires_at, meta)
    SELECT 
      NEW.id,
      archived_data.id,
      'club',
      'active',
      NOW() + INTERVAL '1 month',
      jsonb_build_object('source', 'archived_profile_link', 'original_profile_id', archived_data.id)
    FROM orders_v2 o
    WHERE o.profile_id = archived_data.id
      AND o.status = 'paid'
      AND o.product_id = '11c9f1b8-0355-4753-bd74-40b42aa53616'
      AND NOT EXISTS (
        SELECT 1 FROM entitlements e WHERE e.user_id = NEW.id AND e.product_code = 'club'
      )
    LIMIT 1;
    
    -- Log the linkage
    INSERT INTO audit_logs (actor_user_id, action, target_user_id, meta)
    VALUES (
      NEW.id,
      'archived_profile_linked',
      NEW.id,
      jsonb_build_object(
        'archived_profile_id', archived_data.id,
        'was_club_member', archived_data.was_club_member,
        'linked_at', NOW()
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;