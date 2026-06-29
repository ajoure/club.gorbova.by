ALTER TABLE public.integrations DROP CONSTRAINT IF EXISTS integrations_ws_provider_uniq;
ALTER TABLE public.integrations ADD CONSTRAINT integrations_ws_provider_uniq UNIQUE NULLS NOT DISTINCT (workspace_id, provider);

ALTER TABLE public.integration_credentials DROP CONSTRAINT IF EXISTS integration_credentials_ws_provider_uniq;
ALTER TABLE public.integration_credentials ADD CONSTRAINT integration_credentials_ws_provider_uniq UNIQUE NULLS NOT DISTINCT (workspace_id, provider);