
CREATE OR REPLACE FUNCTION public.get_acquiring_secret(
  p_provider     text,
  p_account_code text,
  p_kind         text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_name  text;
  v_value text;
BEGIN
  IF p_kind NOT IN ('secret_key','webhook_signing_secret') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  v_name := 'acq:' || p_provider || ':' || p_account_code || ':' || p_kind;
  SELECT decrypted_secret INTO v_value
  FROM vault.decrypted_secrets WHERE name = v_name;
  RETURN v_value;
END;
$$;

REVOKE ALL ON FUNCTION public.get_acquiring_secret(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_acquiring_secret(text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_acquiring_secret(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_acquiring_secret(text, text, text) TO service_role;
