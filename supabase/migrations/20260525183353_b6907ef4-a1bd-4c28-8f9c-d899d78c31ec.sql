
-- AI access resolver RPC (SECURITY DEFINER, read-only). 
-- НЕ создаёт новую тарифную подсистему; читает существующие entitlements.

CREATE OR REPLACE FUNCTION public.get_ai_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_has_zg boolean := false;
  v_has_full boolean := false;
  v_chat_day int := 0;
  v_chat_month int := 0;
  v_ba_day int := 0;
  v_ba_month int := 0;
  v_nk_day int := 0;
  v_nk_month int := 0;
  v_day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Minsk') AT TIME ZONE 'Europe/Minsk';
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'Europe/Minsk') AT TIME ZONE 'Europe/Minsk';
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('error','unauthenticated');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM entitlements
    WHERE user_id = v_user
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
      AND product_id = '73c29914-63a3-4f4f-ac42-9f5287e58696'::uuid
  ) INTO v_has_zg;

  SELECT EXISTS(
    SELECT 1 FROM entitlements
    WHERE user_id = v_user
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
      AND product_id IN (
        '11c9f1b8-0355-4753-bd74-40b42aa53616'::uuid,  -- Gorbova Club
        '85046734-2282-4ded-b0d3-8c66c8f5bc2b'::uuid   -- Бухгалтерия как бизнес
      )
  ) INTO v_has_full;

  -- Подсчёт пользовательских сообщений (исключая системные/denial-записи)
  SELECT
    count(*) FILTER (WHERE created_at >= v_day_start AND coalesce(metadata->>'ai_mode','') = 'chat'),
    count(*) FILTER (WHERE created_at >= v_month_start AND coalesce(metadata->>'ai_mode','') = 'chat'),
    count(*) FILTER (WHERE created_at >= v_day_start AND coalesce(metadata->>'scenario_code','') = 'balance_analysis'),
    count(*) FILTER (WHERE created_at >= v_month_start AND coalesce(metadata->>'scenario_code','') = 'balance_analysis'),
    count(*) FILTER (WHERE created_at >= v_day_start AND coalesce(metadata->>'scenario_code','') = '107NK'),
    count(*) FILTER (WHERE created_at >= v_month_start AND coalesce(metadata->>'scenario_code','') = '107NK')
  INTO v_chat_day, v_chat_month, v_ba_day, v_ba_month, v_nk_day, v_nk_month
  FROM ai_chat_messages
  WHERE user_id = v_user
    AND role = 'user'
    AND coalesce(metadata->>'denial_reason','') = '';

  RETURN jsonb_build_object(
    'chat', v_has_full,
    'balance_analysis', v_has_full OR v_has_zg,
    'one_zero_seven_nk', v_has_full,
    'access_tier', CASE WHEN v_has_full THEN 'full' WHEN v_has_zg THEN 'zg_only' ELSE 'none' END,
    'limits', jsonb_build_object(
      'chat', jsonb_build_object('daily', 50, 'monthly', 500),
      'balance_analysis', jsonb_build_object('daily', 20, 'monthly', 200),
      'one_zero_seven_nk', jsonb_build_object('daily', 20, 'monthly', 200)
    ),
    'used', jsonb_build_object(
      'chat', jsonb_build_object('daily', v_chat_day, 'monthly', v_chat_month),
      'balance_analysis', jsonb_build_object('daily', v_ba_day, 'monthly', v_ba_month),
      'one_zero_seven_nk', jsonb_build_object('daily', v_nk_day, 'monthly', v_nk_month)
    ),
    'cta', jsonb_build_object(
      'business_url', '/buhgalteria-kak-biznes',
      'club_url', '/gorbova-club'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_access() TO authenticated;
