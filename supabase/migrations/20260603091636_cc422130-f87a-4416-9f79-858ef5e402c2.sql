
CREATE TABLE public.acquiring_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              text NOT NULL,
  account_code          text NOT NULL,
  account_name          text NOT NULL,
  is_default            boolean NOT NULL DEFAULT false,
  test_mode             boolean NOT NULL DEFAULT true,
  status                text NOT NULL DEFAULT 'pending',
  publishable_key       text,
  success_url           text,
  cancel_url            text,
  locale                text,
  capabilities_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at      timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acquiring_connections_provider_check
    CHECK (provider IN ('stripe','bepaid')),
  CONSTRAINT acquiring_connections_status_check
    CHECK (status IN ('pending','active','disabled','invalid')),
  CONSTRAINT acquiring_connections_account_code_unique
    UNIQUE (provider, account_code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.acquiring_connections TO authenticated;
GRANT ALL ON public.acquiring_connections TO service_role;

ALTER TABLE public.acquiring_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_select_acquiring_connections"
  ON public.acquiring_connections FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "superadmin_modify_acquiring_connections"
  ON public.acquiring_connections FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin'));

CREATE INDEX idx_acquiring_connections_provider_account
  ON public.acquiring_connections(provider, account_code);

CREATE TRIGGER trg_acquiring_connections_updated_at
  BEFORE UPDATE ON public.acquiring_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.provider_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text NOT NULL,
  account_code        text NOT NULL,
  event_id            text NOT NULL,
  event_type          text NOT NULL,
  idempotency_key     text NOT NULL,
  payload             jsonb NOT NULL,
  signature_valid     boolean NOT NULL,
  processed_at        timestamptz,
  processing_status   text NOT NULL DEFAULT 'received',
  processing_error    text,
  related_order_id    uuid,
  related_payment_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_events_provider_check
    CHECK (provider IN ('stripe','bepaid')),
  CONSTRAINT provider_events_processing_status_check
    CHECK (processing_status IN ('received','processed','skipped_duplicate','failed','manual_review')),
  CONSTRAINT provider_events_idem_unique UNIQUE (idempotency_key)
);

GRANT SELECT ON public.provider_events TO authenticated;
GRANT ALL ON public.provider_events TO service_role;

ALTER TABLE public.provider_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_select_provider_events"
  ON public.provider_events FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'));

CREATE INDEX idx_provider_events_event_id ON public.provider_events(event_id);
CREATE INDEX idx_provider_events_lookup
  ON public.provider_events(provider, account_code, event_type, created_at DESC);
CREATE INDEX idx_provider_events_related_order
  ON public.provider_events(related_order_id) WHERE related_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_save_acquiring_secret(
  p_connection_id uuid,
  p_kind          text,
  p_value         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_provider     text;
  v_account_code text;
  v_secret_name  text;
  v_existing_id  uuid;
  v_secret_id    uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role_v2(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_kind NOT IN ('secret_key','webhook_signing_secret') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;

  IF p_value IS NULL OR length(btrim(p_value)) = 0 THEN
    RAISE EXCEPTION 'empty_value' USING ERRCODE = '22023';
  END IF;

  SELECT provider, account_code INTO v_provider, v_account_code
  FROM public.acquiring_connections WHERE id = p_connection_id;

  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'connection_not_found' USING ERRCODE = '02000';
  END IF;

  v_secret_name := 'acq:' || v_provider || ':' || v_account_code || ':' || p_kind;

  SELECT id INTO v_existing_id FROM vault.secrets WHERE name = v_secret_name;

  IF v_existing_id IS NULL THEN
    SELECT vault.create_secret(p_value, v_secret_name, 'Acquiring secret for ' || v_secret_name)
      INTO v_secret_id;
  ELSE
    PERFORM vault.update_secret(v_existing_id, p_value, v_secret_name);
    v_secret_id := v_existing_id;
  END IF;

  INSERT INTO public.audit_logs (action, actor_user_id, entity_type, entity_id, meta)
  VALUES (
    'acquiring.connection.secret_updated',
    auth.uid(),
    'acquiring_connections',
    p_connection_id::text,
    jsonb_build_object(
      'provider', v_provider,
      'account_code', v_account_code,
      'kind', p_kind,
      'vault_secret_name', v_secret_name
    )
  );

  RETURN jsonb_build_object('ok', true, 'secret_id', v_secret_id, 'name', v_secret_name);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_acquiring_secret(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_acquiring_secret(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_acquiring_secrets(
  p_connection_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_provider     text;
  v_account_code text;
  v_name         text;
  v_kind         text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role_v2(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT provider, account_code INTO v_provider, v_account_code
  FROM public.acquiring_connections WHERE id = p_connection_id;

  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'connection_not_found' USING ERRCODE = '02000';
  END IF;

  FOREACH v_kind IN ARRAY ARRAY['secret_key','webhook_signing_secret'] LOOP
    v_name := 'acq:' || v_provider || ':' || v_account_code || ':' || v_kind;
    DELETE FROM vault.secrets WHERE name = v_name;
  END LOOP;

  INSERT INTO public.audit_logs (action, actor_user_id, entity_type, entity_id, meta)
  VALUES (
    'acquiring.connection.secrets_deleted',
    auth.uid(),
    'acquiring_connections',
    p_connection_id::text,
    jsonb_build_object('provider', v_provider, 'account_code', v_account_code)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_acquiring_secrets(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_acquiring_secrets(uuid) TO authenticated;
