-- Serialize issuance per e-mail and IP before the OTP row is inserted. The
-- public Edge Function calls this only as service_role; anon/authenticated
-- remain unable to read or write inline_otp_codes directly.
CREATE OR REPLACE FUNCTION public.issue_inline_otp_code(
  p_email text,
  p_code_hash text,
  p_salt text,
  p_flow_id text,
  p_purpose text,
  p_meta jsonb,
  p_ip text,
  p_user_agent text,
  p_ttl_seconds integer DEFAULT 600
)
RETURNS TABLE(status text, retry_after_s integer, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_last_send_at timestamptz;
  v_email_count integer;
  v_ip_count integer;
  v_expires_at timestamptz;
  v_retry_after_s integer;
BEGIN
  IF p_ttl_seconds < 60 OR p_ttl_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid OTP TTL';
  END IF;

  -- These locks are transaction scoped and prevent concurrent requests from
  -- passing a count before another request inserts its OTP row.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('inline_otp:email:' || p_email, 0)
  );
  IF p_ip IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('inline_otp:ip:' || p_ip, 0)
    );
  END IF;

  SELECT max(last_send_at)
  INTO v_last_send_at
  FROM public.inline_otp_codes
  WHERE email = p_email;
  IF v_last_send_at IS NOT NULL AND v_last_send_at > v_now - interval '60 seconds' THEN
    v_retry_after_s := greatest(
      1,
      ceil(extract(epoch FROM (v_last_send_at + interval '60 seconds' - v_now)))::integer
    );
    RETURN QUERY SELECT 'rate_limited'::text, v_retry_after_s, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT count(*)::integer
  INTO v_email_count
  FROM public.inline_otp_codes
  WHERE email = p_email
    AND created_at >= v_now - interval '1 hour';
  IF v_email_count >= 5 THEN
    RETURN QUERY SELECT 'rate_limited'::text, 900, NULL::timestamptz;
    RETURN;
  END IF;

  IF p_ip IS NOT NULL THEN
    SELECT count(*)::integer
    INTO v_ip_count
    FROM public.inline_otp_codes
    WHERE ip = p_ip::inet
      AND created_at >= v_now - interval '1 hour';
    IF v_ip_count >= 20 THEN
      RETURN QUERY SELECT 'rate_limited'::text, 900, NULL::timestamptz;
      RETURN;
    END IF;
  END IF;

  UPDATE public.inline_otp_codes
  SET revoked_at = v_now
  WHERE email = p_email
    AND used_at IS NULL
    AND revoked_at IS NULL;

  v_expires_at := v_now + make_interval(secs => p_ttl_seconds);
  INSERT INTO public.inline_otp_codes (
    email, code_hash, salt, flow_id, purpose, meta, ip, user_agent,
    expires_at, last_send_at
  ) VALUES (
    p_email, p_code_hash, p_salt, p_flow_id, p_purpose, p_meta, p_ip::inet,
    p_user_agent, v_expires_at, v_now
  );

  RETURN QUERY SELECT 'issued'::text, 0, v_expires_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.issue_inline_otp_code(text, text, text, text, text, jsonb, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.issue_inline_otp_code(text, text, text, text, text, jsonb, text, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_inline_otp_code(text, text, text, text, text, jsonb, text, text, integer) TO service_role;
