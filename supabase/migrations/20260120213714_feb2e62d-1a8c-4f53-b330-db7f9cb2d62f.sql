-- Create safe delete profile function
CREATE OR REPLACE FUNCTION public.admin_safe_delete_profile(
  _profile_id UUID,
  _dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result JSONB;
  _counts JSONB;
  _has_active_subscriptions BOOLEAN;
  _profile_exists BOOLEAN;
BEGIN
  -- Check if profile exists
  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = _profile_id) INTO _profile_exists;
  
  IF NOT _profile_exists THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'profile_not_found',
      'message', 'Profile not found'
    );
  END IF;

  -- Check for active subscriptions (blocking condition)
  SELECT EXISTS(
    SELECT 1 FROM subscriptions_v2 
    WHERE profile_id = _profile_id 
      AND status IN ('active', 'trial')
      AND (access_end_at IS NULL OR access_end_at > NOW())
  ) INTO _has_active_subscriptions;

  -- Count related records
  SELECT jsonb_build_object(
    'payments', (SELECT COUNT(*) FROM payments_v2 WHERE profile_id = _profile_id),
    'orders', (SELECT COUNT(*) FROM orders_v2 WHERE profile_id = _profile_id),
    'subscriptions_total', (SELECT COUNT(*) FROM subscriptions_v2 WHERE profile_id = _profile_id),
    'subscriptions_active', (SELECT COUNT(*) FROM subscriptions_v2 WHERE profile_id = _profile_id AND status IN ('active', 'trial')),
    'card_links', (SELECT COUNT(*) FROM card_profile_links WHERE profile_id = _profile_id),
    'entitlements', (SELECT COUNT(*) FROM entitlements WHERE profile_id = _profile_id),
    'entitlements_active', (SELECT COUNT(*) FROM entitlements WHERE profile_id = _profile_id AND status = 'active')
  ) INTO _counts;

  -- Safeguard: cannot delete with active subscriptions
  IF _has_active_subscriptions THEN
    RETURN jsonb_build_object(
      'ok', false,
      'stop_reason', 'has_active_subscriptions',
      'message', 'Cannot archive: contact has active subscriptions',
      'counts', _counts
    );
  END IF;

  -- Dry run - return preview
  IF _dry_run THEN
    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'action', 'preview',
      'message', 'Preview of what would be archived',
      'counts', _counts
    );
  END IF;

  -- Execute soft-delete: set status to archived
  UPDATE profiles SET 
    status = 'archived',
    updated_at = NOW(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'archived_at', NOW()::text,
      'archived_counts', _counts
    )
  WHERE id = _profile_id;

  -- Clear card_profile_links (break the link, data stays in payments)
  DELETE FROM card_profile_links WHERE profile_id = _profile_id;

  -- Revoke active entitlements
  UPDATE entitlements 
  SET status = 'revoked', updated_at = NOW() 
  WHERE profile_id = _profile_id AND status = 'active';

  -- Cancel non-expired subscriptions
  UPDATE subscriptions_v2 
  SET status = 'cancelled', updated_at = NOW() 
  WHERE profile_id = _profile_id 
    AND status NOT IN ('cancelled', 'expired');

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'action', 'archived',
    'message', 'Contact archived successfully',
    'counts', _counts
  );
END;
$$;