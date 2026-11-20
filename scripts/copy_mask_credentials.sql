-- Copy-only: replace live provider credentials and card tokens in the restored
-- copy (ypwsuumurrtkxatoyqhk) so the copy can never act on real accounts.
-- Never run against the source/production. Re-run after every copy refresh.
-- The production cutover restore loads fresh unmasked data instead.
-- Idempotent; aborts unless executed on our own project database.
-- Business triggers are disabled for this transaction so masking enqueues nothing.
BEGIN;
SET LOCAL session_replication_role = replica;
DO $mask$
DECLARE
  fence constant text := 'fenced-by-gorbova-copy';
  secret_config_keys constant text[] := array['auth_code','secret_key','access_token','long_term_token',
    'api_token','egress_token','dns_access_key','dns_secret_key','cloud_access_key','cloud_secret_key',
    'api_key','webhook_secret','test_password','battle_password','token','client_secret','password'];
  n bigint;
  report jsonb := '{}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE prosrc LIKE '%ypwsuumurrtkxatoyqhk.supabase.co%')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE prosrc LIKE '%hdjgkjceownmmnrqqtuz%') THEN
    RAISE EXCEPTION 'not_the_fenced_copy_database';
  END IF;

  -- jsonb provider secrets: mask listed keys in config, every key in secret blobs.
  UPDATE public.integration_instances SET config = (
      SELECT jsonb_object_agg(k, CASE WHEN k = ANY(secret_config_keys) AND jsonb_typeof(v) = 'string'
                                       AND v #>> '{}' <> '' THEN to_jsonb(fence) ELSE v END)
      FROM jsonb_each(config) e(k, v))
    WHERE config IS NOT NULL AND config <> '{}'::jsonb AND EXISTS (
      SELECT 1 FROM jsonb_each_text(config) e(k, v) WHERE k = ANY(secret_config_keys) AND v <> '' AND v <> fence);
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('integration_instances.config', n);

  UPDATE public.integration_instances SET config_secrets = (
      SELECT jsonb_object_agg(k, to_jsonb(fence)) FROM jsonb_each(config_secrets) e(k, v))
    WHERE config_secrets IS NOT NULL AND config_secrets <> '{}'::jsonb
      AND EXISTS (SELECT 1 FROM jsonb_each_text(config_secrets) e(k, v) WHERE v IS DISTINCT FROM fence);
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('integration_instances.config_secrets', n);

  UPDATE public.integration_credentials SET secrets = (
      SELECT jsonb_object_agg(k, to_jsonb(fence)) FROM jsonb_each(secrets) e(k, v))
    WHERE secrets IS NOT NULL AND secrets <> '{}'::jsonb
      AND EXISTS (SELECT 1 FROM jsonb_each_text(secrets) e(k, v) WHERE v IS DISTINCT FROM fence);
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('integration_credentials.secrets', n);

  -- Plain-text credentials.
  UPDATE public.telegram_bots SET bot_token_encrypted = fence
    WHERE bot_token_encrypted IS NOT NULL AND bot_token_encrypted <> fence;
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('telegram_bots.bot_token_encrypted', n);

  UPDATE public.telegram_mtproto_sessions SET session_string = fence
    WHERE session_string IS NOT NULL AND session_string <> fence;
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('telegram_mtproto_sessions.session_string', n);

  UPDATE public.email_accounts SET smtp_password = fence
    WHERE smtp_password IS NOT NULL AND smtp_password <> fence;
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('email_accounts.smtp_password', n);

  -- Card/payment tokens: keep uniqueness and NULLs, lose the real value.
  UPDATE public.payment_methods SET provider_token = 'fenced-copy-' || md5(provider_token) WHERE provider_token NOT LIKE 'fenced-copy-%';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('payment_methods.provider_token', n);
  UPDATE public.card_profile_links SET provider_token = 'fenced-copy-' || md5(provider_token) WHERE provider_token NOT LIKE 'fenced-copy-%';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('card_profile_links.provider_token', n);
  UPDATE public.provider_subscriptions SET card_token = 'fenced-copy-' || md5(card_token) WHERE card_token NOT LIKE 'fenced-copy-%';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('provider_subscriptions.card_token', n);
  UPDATE public.provider_subscriptions_synthetic_cleanup_backup_2026_05 SET card_token = 'fenced-copy-' || md5(card_token) WHERE card_token NOT LIKE 'fenced-copy-%';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('provider_subscriptions_backup.card_token', n);
  UPDATE public.subscription_payment_credentials SET payment_token = 'fenced-copy-' || md5(payment_token) WHERE payment_token NOT LIKE 'fenced-copy-%';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('subscription_payment_credentials.payment_token', n);
  UPDATE public.subscriptions_v2 SET payment_token = 'fenced-copy-' || md5(payment_token) WHERE payment_token NOT LIKE 'fenced-copy-%';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('subscriptions_v2.payment_token', n);
  UPDATE public.payments_v2 SET payment_token = 'fenced-copy-' || md5(payment_token) WHERE payment_token NOT LIKE 'fenced-copy-%';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('payments_v2.payment_token', n);
  UPDATE public.orders SET bepaid_token = 'fenced-copy-' || md5(bepaid_token) WHERE bepaid_token NOT LIKE 'fenced-copy-%';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('orders.bepaid_token', n);
  UPDATE public._stripe_cleanup_2026_06_backup_payments SET payment_token = 'fenced-copy-' || md5(payment_token) WHERE payment_token NOT LIKE 'fenced-copy-%';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('stripe_backup_payments.payment_token', n);
  UPDATE public._stripe_cleanup_2026_06_backup_provider_subs SET card_token = 'fenced-copy-' || md5(card_token) WHERE card_token NOT LIKE 'fenced-copy-%';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('stripe_backup_provider_subs.card_token', n);
  UPDATE public._stripe_cleanup_2026_06_backup_subscriptions SET payment_token = 'fenced-copy-' || md5(payment_token) WHERE payment_token NOT LIKE 'fenced-copy-%';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('stripe_backup_subscriptions.payment_token', n);

  -- bePaid in the copy is test mode only.
  UPDATE public.integration_instances SET config = jsonb_set(config, '{test_mode}', 'true'::jsonb)
    WHERE provider::text = 'bepaid' AND config ? 'test_mode' AND config->'test_mode' IS DISTINCT FROM 'true'::jsonb;
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('integration_instances.bepaid_test_mode', n);
  UPDATE public.payment_settings SET value = 'true' WHERE key = 'bepaid_test_mode' AND value IS DISTINCT FROM 'true';
  GET DIAGNOSTICS n = ROW_COUNT; report := report || jsonb_build_object('payment_settings.bepaid_test_mode', n);

  CREATE TEMP TABLE IF NOT EXISTS copy_mask_report(report jsonb);
  INSERT INTO copy_mask_report VALUES (report);
END
$mask$;
COMMIT;
SELECT report FROM copy_mask_report;
