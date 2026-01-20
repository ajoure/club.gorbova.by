-- =============================================
-- 1. Create normalize_card_brand function
-- =============================================
CREATE OR REPLACE FUNCTION public.normalize_card_brand(_brand TEXT)
RETURNS TEXT
IMMUTABLE
PARALLEL SAFE
LANGUAGE plpgsql AS $$
BEGIN
  IF _brand IS NULL OR _brand = '' THEN
    RETURN 'unknown';
  END IF;
  
  RETURN CASE lower(trim(_brand))
    WHEN 'master' THEN 'mastercard'
    WHEN 'mc' THEN 'mastercard'
    WHEN 'mastercard' THEN 'mastercard'
    WHEN 'visa' THEN 'visa'
    WHEN 'belkart' THEN 'belkart'
    WHEN 'belcard' THEN 'belkart'
    WHEN 'maestro' THEN 'maestro'
    WHEN 'mir' THEN 'mir'
    ELSE lower(trim(_brand))
  END;
END;
$$;

-- =============================================
-- 2. Update admin_unlinked_cards_report to use normalization
-- =============================================
CREATE OR REPLACE FUNCTION public.admin_unlinked_cards_report(_limit integer DEFAULT 100, _offset integer DEFAULT 0, _brand text DEFAULT NULL::text, _last4 text DEFAULT NULL::text)
 RETURNS TABLE(last4 text, brand text, unlinked_payments_v2_count bigint, unlinked_queue_count bigint, payments_amount numeric, queue_amount numeric, total_amount numeric, last_seen_at timestamp with time zone, collision_risk boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH payments_agg AS (
    SELECT 
      p.card_last4,
      normalize_card_brand(p.card_brand) as card_brand,
      COUNT(*)::BIGINT as cnt,
      COALESCE(SUM(p.amount), 0) as sum_amount,
      MAX(p.paid_at) as max_paid
    FROM payments_v2 p
    WHERE p.profile_id IS NULL
      AND p.card_last4 IS NOT NULL 
      AND p.card_brand IS NOT NULL
    GROUP BY p.card_last4, normalize_card_brand(p.card_brand)
  ),
  queue_agg AS (
    SELECT 
      q.card_last4,
      normalize_card_brand(q.card_brand) as card_brand,
      COUNT(*)::BIGINT as cnt,
      COALESCE(SUM(q.amount), 0) as sum_amount,
      MAX(COALESCE(q.paid_at, q.created_at)) as max_paid
    FROM payment_reconcile_queue q
    WHERE q.matched_profile_id IS NULL
      AND q.card_last4 IS NOT NULL 
      AND q.card_brand IS NOT NULL
    GROUP BY q.card_last4, normalize_card_brand(q.card_brand)
  ),
  combined AS (
    SELECT 
      COALESCE(p.card_last4, q.card_last4) as card_last4,
      COALESCE(p.card_brand, q.card_brand) as card_brand,
      COALESCE(p.cnt, 0) as payments_count,
      COALESCE(q.cnt, 0) as queue_count,
      COALESCE(p.sum_amount, 0) as payments_sum,
      COALESCE(q.sum_amount, 0) as queue_sum,
      GREATEST(p.max_paid, q.max_paid) as last_seen
    FROM payments_agg p
    FULL OUTER JOIN queue_agg q 
      ON p.card_last4 = q.card_last4 AND p.card_brand = q.card_brand
  ),
  collision_cards AS (
    SELECT cc.card_last4, cc.card_brand
    FROM (
      SELECT cpl.card_last4, normalize_card_brand(cpl.card_brand) as card_brand, cpl.profile_id 
      FROM card_profile_links cpl
      WHERE cpl.card_last4 IS NOT NULL AND cpl.card_brand IS NOT NULL
      UNION ALL
      SELECT pm.last4, normalize_card_brand(pm.brand), pr.id 
      FROM payment_methods pm 
      JOIN profiles pr ON pr.user_id = pm.user_id 
      WHERE pm.status = 'active' AND pm.last4 IS NOT NULL AND pm.brand IS NOT NULL
    ) cc
    GROUP BY cc.card_last4, cc.card_brand
    HAVING COUNT(DISTINCT cc.profile_id) >= 2
  )
  SELECT 
    c.card_last4 as last4,
    c.card_brand as brand,
    c.payments_count as unlinked_payments_v2_count,
    c.queue_count as unlinked_queue_count,
    c.payments_sum as payments_amount,
    c.queue_sum as queue_amount,
    (c.payments_sum + c.queue_sum) as total_amount,
    c.last_seen as last_seen_at,
    (EXISTS (SELECT 1 FROM collision_cards col WHERE col.card_last4 = c.card_last4 AND col.card_brand = c.card_brand)) as collision_risk
  FROM combined c
  WHERE 
    (_brand IS NULL OR c.card_brand = normalize_card_brand(_brand))
    AND (_last4 IS NULL OR c.card_last4 = _last4)
  ORDER BY (c.payments_count + c.queue_count) DESC
  LIMIT _limit
  OFFSET _offset;
END;
$function$;

-- =============================================
-- 3. Update admin_unlinked_cards_details to use normalization
-- =============================================
CREATE OR REPLACE FUNCTION public.admin_unlinked_cards_details(_last4 text, _brand text, _limit integer DEFAULT 100, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, uid text, amount numeric, paid_at timestamp with time zone, status text, source text, customer_email text, card_holder text, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _total BIGINT;
  _norm_brand TEXT;
BEGIN
  _norm_brand := normalize_card_brand(_brand);
  
  -- Count total for pagination
  SELECT 
    (SELECT COUNT(*) FROM payments_v2 
     WHERE profile_id IS NULL AND card_last4 = _last4 AND normalize_card_brand(card_brand) = _norm_brand)
    +
    (SELECT COUNT(*) FROM payment_reconcile_queue 
     WHERE matched_profile_id IS NULL AND card_last4 = _last4 AND normalize_card_brand(card_brand) = _norm_brand)
  INTO _total;

  RETURN QUERY
  SELECT * FROM (
    (
      SELECT 
        p.id,
        p.provider_payment_id as uid,
        p.amount,
        p.paid_at,
        p.status::TEXT,
        'payments_v2'::TEXT as source,
        NULL::TEXT as customer_email,
        NULL::TEXT as card_holder,
        _total as total_count
      FROM payments_v2 p
      WHERE p.profile_id IS NULL 
        AND p.card_last4 = _last4 
        AND normalize_card_brand(p.card_brand) = _norm_brand
    )
    UNION ALL
    (
      SELECT 
        q.id,
        q.bepaid_uid as uid,
        q.amount,
        COALESCE(q.paid_at, q.created_at) as paid_at,
        q.status::TEXT,
        'queue'::TEXT as source,
        q.customer_email,
        q.card_holder,
        _total as total_count
      FROM payment_reconcile_queue q
      WHERE q.matched_profile_id IS NULL 
        AND q.card_last4 = _last4 
        AND normalize_card_brand(q.card_brand) = _norm_brand
    )
  ) combined
  ORDER BY paid_at DESC NULLS LAST
  LIMIT _limit
  OFFSET _offset;
END;
$function$;

-- =============================================
-- 4. Create admin_repair_card_links RPC
-- =============================================
CREATE OR REPLACE FUNCTION public.admin_repair_card_links(
  _last4 TEXT,
  _brand TEXT,
  _target_profile_id UUID,
  _dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  _norm_brand TEXT;
  _candidates JSONB;
  _active_profiles_count INT;
  _links_to_delete UUID[];
  _deleted_count INT := 0;
  _target_exists BOOLEAN;
  _target_user_id UUID;
BEGIN
  -- Normalize brand
  _norm_brand := normalize_card_brand(_brand);
  
  -- Verify target profile exists and is not archived
  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = _target_profile_id AND (is_archived IS NULL OR is_archived = false)),
         (SELECT user_id FROM profiles WHERE id = _target_profile_id)
  INTO _target_exists, _target_user_id;
  
  IF NOT _target_exists THEN
    RETURN jsonb_build_object(
      'error', 'Target profile not found or is archived',
      'target_profile_id', _target_profile_id
    );
  END IF;
  
  -- Find all profiles linked to this card (by normalized brand)
  SELECT jsonb_agg(jsonb_build_object(
    'profile_id', sub.profile_id,
    'source', sub.source,
    'has_user_id', sub.has_user_id,
    'is_archived', sub.is_archived,
    'full_name', sub.full_name
  ))
  INTO _candidates
  FROM (
    SELECT DISTINCT ON (profile_id)
      cpl.profile_id,
      'card_profile_links' as source,
      p.user_id IS NOT NULL as has_user_id,
      COALESCE(p.is_archived, false) as is_archived,
      p.full_name
    FROM card_profile_links cpl
    LEFT JOIN profiles p ON p.id = cpl.profile_id
    WHERE cpl.card_last4 = _last4 
      AND normalize_card_brand(cpl.card_brand) = _norm_brand
    UNION
    SELECT DISTINCT ON (pr.id)
      pr.id,
      'payment_methods' as source,
      true as has_user_id,
      COALESCE(pr.is_archived, false) as is_archived,
      pr.full_name
    FROM payment_methods pm
    JOIN profiles pr ON pr.user_id = pm.user_id
    WHERE pm.last4 = _last4 
      AND normalize_card_brand(pm.brand) = _norm_brand
      AND pm.status = 'active'
  ) sub;
  
  -- Count active (non-archived) profiles with user_id, excluding target
  SELECT COUNT(*)
  INTO _active_profiles_count
  FROM jsonb_array_elements(_candidates) elem
  WHERE (elem->>'has_user_id')::boolean = true 
    AND (elem->>'is_archived')::boolean = false
    AND (elem->>'profile_id')::uuid != _target_profile_id;
  
  -- STOP guard: If multiple REAL profiles with user_id exist (besides target)
  IF _active_profiles_count > 0 THEN
    RETURN jsonb_build_object(
      'error', 'STOP: Multiple active profiles with user_id for this card. Manual merge required first.',
      'candidates', _candidates,
      'active_profiles_count', _active_profiles_count + 1,
      'last4', _last4,
      'brand', _norm_brand
    );
  END IF;
  
  -- Find card_profile_links to delete (all for this card except target)
  SELECT array_agg(cpl.id)
  INTO _links_to_delete
  FROM card_profile_links cpl
  WHERE cpl.card_last4 = _last4 
    AND normalize_card_brand(cpl.card_brand) = _norm_brand
    AND cpl.profile_id != _target_profile_id;
  
  IF _dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'last4', _last4,
      'brand', _norm_brand,
      'target_profile_id', _target_profile_id,
      'candidates', COALESCE(_candidates, '[]'::jsonb),
      'links_to_delete_count', COALESCE(array_length(_links_to_delete, 1), 0),
      'links_to_delete_ids', _links_to_delete
    );
  END IF;
  
  -- EXECUTE: Delete stale links
  IF _links_to_delete IS NOT NULL AND array_length(_links_to_delete, 1) > 0 THEN
    DELETE FROM card_profile_links WHERE id = ANY(_links_to_delete);
    GET DIAGNOSTICS _deleted_count = ROW_COUNT;
  END IF;
  
  -- Ensure target has a link (create if not exists)
  INSERT INTO card_profile_links (card_last4, card_brand, profile_id)
  VALUES (_last4, _norm_brand, _target_profile_id)
  ON CONFLICT DO NOTHING;
  
  -- Write SYSTEM ACTOR audit log
  INSERT INTO audit_logs (actor_type, actor_label, actor_user_id, action, target_user_id, meta)
  VALUES (
    'system', 
    'admin_repair_card_links', 
    NULL, 
    'admin_repair_card_links',
    _target_user_id,
    jsonb_build_object(
      'last4', _last4,
      'brand', _norm_brand,
      'target_profile_id', _target_profile_id,
      'deleted_link_ids', _links_to_delete,
      'deleted_count', _deleted_count,
      'candidates', COALESCE(_candidates, '[]'::jsonb),
      'dry_run', false
    )
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'dry_run', false,
    'last4', _last4,
    'brand', _norm_brand,
    'target_profile_id', _target_profile_id,
    'deleted_count', _deleted_count,
    'candidates', COALESCE(_candidates, '[]'::jsonb)
  );
END;
$$;