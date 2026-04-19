-- Generate webhook_secret for existing ManyChat instances that don't have one.
-- This secret is used by the manychat-inbound edge function to authenticate
-- incoming External Requests from ManyChat flows.
UPDATE integration_instances
SET config_secrets = COALESCE(config_secrets, '{}'::jsonb) || jsonb_build_object(
  'webhook_secret', encode(gen_random_bytes(24), 'hex')
)
WHERE provider = 'manychat'
  AND (config_secrets IS NULL OR NOT (config_secrets ? 'webhook_secret'));