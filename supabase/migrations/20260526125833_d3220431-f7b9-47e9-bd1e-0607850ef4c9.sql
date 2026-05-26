-- PATCH-R4-SYNTHETIC-PROVIDER-SUB-CLEANUP-2026-05
-- Step 1: backup snapshot for the 73 synthetic internal:* provider_subscriptions
CREATE TABLE IF NOT EXISTS public.provider_subscriptions_synthetic_cleanup_backup_2026_05 AS
SELECT ps.*,
       to_jsonb(ps.*) AS before_json,
       CASE
         WHEN sv.product_id = '73c29914-63a3-4f4f-ac42-9f5287e58696'
           THEN 'phantom_no_provider'
         ELSE 'split_brain_synth_over_real'
       END AS cohort,
       now() AS backed_up_at
FROM public.provider_subscriptions ps
LEFT JOIN public.subscriptions_v2 sv ON sv.id = ps.subscription_v2_id
WHERE ps.provider = 'bepaid'
  AND ps.provider_subscription_id LIKE 'internal:%'
  AND (ps.meta->>'synthetic')::boolean = true;

COMMENT ON TABLE public.provider_subscriptions_synthetic_cleanup_backup_2026_05
  IS 'PATCH-R4-SYNTHETIC-PROVIDER-SUB-CLEANUP-2026-05: pre-cleanup snapshot of 73 synthetic internal:* provider_subscriptions created by token_direct_charge backfill 2026-05-25.';