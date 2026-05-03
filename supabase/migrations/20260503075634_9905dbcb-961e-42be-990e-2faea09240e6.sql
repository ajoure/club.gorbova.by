
CREATE TABLE IF NOT EXISTS public._microcorrection_rollback_2026_05_03_backup (
  backup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  user_id uuid,
  product_id uuid,
  marker text,
  access_end_at_before timestamptz,
  next_charge_at_before timestamptz,
  expires_at_before timestamptz,
  meta_before jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public._microcorrection_rollback_2026_05_03_backup
  (source_table, source_id, user_id, product_id, marker, access_end_at_before, next_charge_at_before, meta_before)
SELECT 'subscriptions_v2', id, user_id, product_id,
  meta->>'access_end_at_corrected_by',
  access_end_at, next_charge_at, meta
FROM public.subscriptions_v2
WHERE meta->>'access_end_at_corrected_by' IN ('bepaid_overshoot_backfill_2026_05','inv22_overshoot_backfill_2026_05_v3.1');

INSERT INTO public._microcorrection_rollback_2026_05_03_backup
  (source_table, source_id, user_id, product_id, marker, expires_at_before, meta_before)
SELECT DISTINCT 'entitlements', e.id, e.user_id, e.product_id,
  s.meta->>'access_end_at_corrected_by', e.expires_at, e.meta
FROM public.entitlements e
JOIN public.subscriptions_v2 s
  ON s.user_id = e.user_id AND s.product_id = e.product_id
WHERE s.meta->>'access_end_at_corrected_by' IN ('bepaid_overshoot_backfill_2026_05','inv22_overshoot_backfill_2026_05_v3.1')
  AND e.expires_at IS NOT NULL
  AND date_trunc('day', e.expires_at AT TIME ZONE 'Europe/Minsk') = date_trunc('day', s.access_end_at AT TIME ZONE 'Europe/Minsk');
