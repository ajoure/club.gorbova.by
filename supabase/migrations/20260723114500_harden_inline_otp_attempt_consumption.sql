-- OTP verification is publicly reachable through an Edge Function. The
-- read/compare/write sequence must be serialized so parallel incorrect guesses
-- cannot overwrite each other's attempts count.
CREATE OR REPLACE FUNCTION public.consume_inline_otp_attempt(
  p_code_id uuid,
  p_code_hash text,
  p_max_attempts integer DEFAULT 5
)
RETURNS TABLE(status text, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code public.inline_otp_codes%ROWTYPE;
  v_attempts integer;
  v_now timestamptz := now();
BEGIN
  SELECT *
  INTO v_code
  FROM public.inline_otp_codes
  WHERE id = p_code_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, 0;
    RETURN;
  END IF;

  IF v_code.used_at IS NOT NULL THEN
    RETURN QUERY SELECT 'used'::text, v_code.attempts;
    RETURN;
  END IF;

  IF v_code.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked'::text, v_code.attempts;
    RETURN;
  END IF;

  IF v_code.expires_at < v_now THEN
    RETURN QUERY SELECT 'expired'::text, v_code.attempts;
    RETURN;
  END IF;

  IF v_code.attempts >= p_max_attempts THEN
    RETURN QUERY SELECT 'locked'::text, v_code.attempts;
    RETURN;
  END IF;

  IF v_code.code_hash = p_code_hash THEN
    UPDATE public.inline_otp_codes
    SET used_at = v_now
    WHERE id = v_code.id;

    RETURN QUERY SELECT 'consumed'::text, v_code.attempts;
    RETURN;
  END IF;

  UPDATE public.inline_otp_codes
  SET attempts = attempts + 1
  WHERE id = v_code.id
  RETURNING inline_otp_codes.attempts INTO v_attempts;

  RETURN QUERY SELECT 'invalid'::text, v_attempts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_inline_otp_attempt(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_inline_otp_attempt(uuid, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_inline_otp_attempt(uuid, text, integer) TO service_role;
