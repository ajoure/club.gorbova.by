
-- Backup tables
CREATE TABLE IF NOT EXISTS public.subscriptions_v2_repair_backup_2026_05 (
  backup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  sub_id uuid NOT NULL,
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  tariff_id uuid,
  status text,
  access_end_at timestamptz,
  next_charge_at timestamptz,
  meta jsonb,
  source_order_id uuid NOT NULL,
  source_payment_id uuid NOT NULL,
  expected_min_end timestamptz NOT NULL,
  reason text NOT NULL,
  repair_bucket text NOT NULL,
  CONSTRAINT uniq_sub_per_batch UNIQUE (batch_id, sub_id)
);

CREATE TABLE IF NOT EXISTS public.entitlements_repair_backup_2026_05 (
  backup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  ent_id uuid NOT NULL,
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  status text,
  expires_at timestamptz,
  meta jsonb,
  source_order_id uuid NOT NULL,
  source_payment_id uuid NOT NULL,
  expected_min_end timestamptz NOT NULL,
  reason text NOT NULL,
  repair_bucket text NOT NULL,
  CONSTRAINT uniq_ent_per_batch UNIQUE (batch_id, ent_id)
);

CREATE TABLE IF NOT EXISTS public.telegram_access_repair_backup_2026_05 (
  backup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  tg_id uuid NOT NULL,
  user_id uuid NOT NULL,
  club_id uuid NOT NULL,
  active_until timestamptz,
  state_chat text,
  state_channel text,
  source_order_id uuid NOT NULL,
  source_payment_id uuid NOT NULL,
  expected_min_end timestamptz NOT NULL,
  reason text NOT NULL,
  repair_bucket text NOT NULL,
  CONSTRAINT uniq_tg_per_batch UNIQUE (batch_id, tg_id)
);

ALTER TABLE public.subscriptions_v2_repair_backup_2026_05 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements_repair_backup_2026_05 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_access_repair_backup_2026_05 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "no client access subs backup 2026_05" ON public.subscriptions_v2_repair_backup_2026_05;
CREATE POLICY "no client access subs backup 2026_05" ON public.subscriptions_v2_repair_backup_2026_05 FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "no client access ent backup 2026_05" ON public.entitlements_repair_backup_2026_05;
CREATE POLICY "no client access ent backup 2026_05" ON public.entitlements_repair_backup_2026_05 FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "no client access tg backup 2026_05" ON public.telegram_access_repair_backup_2026_05;
CREATE POLICY "no client access tg backup 2026_05" ON public.telegram_access_repair_backup_2026_05 FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Repair execution
DO $repair$
DECLARE
  v_batch_id text := 'recurring_repair_2026_05_' || to_char(now() AT TIME ZONE 'UTC','YYYYMMDD_HH24MISS');
  v_rows int;
  v_sub_backup_count int;
  v_ent_backup_count int;
  v_tg_backup_count int;
  v_sub_upd int;
  v_ent_upd int;
  v_tg_upd int;
  v_audit_count int;
  v_patch_lineage jsonb := jsonb_build_array('patch-12.1-stale-local-recovery','patch-12.2-skip-stale-guard');

  -- cohort: sub_id, ent_id, tg_id, club_id, user_id, product_id, tariff_id, source_order_id, source_payment_id, expected_min_end
  v_cohort jsonb := jsonb_build_array(
    jsonb_build_object('sub_id','9f67beb4-9c82-4cf5-8b32-5bd8319ad662','ent_id','7c8bc1a3-89d2-488f-83c8-02d7997abca6','tg_id','a7202186-87fd-4efb-8e49-147e609409f3','club_id','fa547c41-3a84-4c4f-904a-427332a0506e','user_id','871ac688-88c8-4739-b2eb-51779bd69fed','product_id','11c9f1b8-0355-4753-bd74-40b42aa53616','tariff_id','7c748940-dcad-4c7c-a92e-76a2344622d3','source_order_id','23657631-c2f8-4094-8c0d-38b4d90124aa','source_payment_id','eb548686-1ac9-4ade-a438-e0691bfb71c2','expected_min_end','2026-06-03T20:59:59+00:00'),
    jsonb_build_object('sub_id','b72233dd-456a-45f7-8dbe-0229b24f7446','ent_id','80361311-4c02-44c7-9ab1-b532a91de93c','tg_id','1f061a65-6a14-4c8b-aaae-a774af6cfdc6','club_id','fa547c41-3a84-4c4f-904a-427332a0506e','user_id','8475df88-cb91-453f-a222-308f000f40a8','product_id','11c9f1b8-0355-4753-bd74-40b42aa53616','tariff_id','7c748940-dcad-4c7c-a92e-76a2344622d3','source_order_id','6d9b7bdb-8d30-4973-9175-ca3913333245','source_payment_id','b6322606-4de0-4857-bb87-c7dae5adc2bd','expected_min_end','2026-06-03T20:59:59+00:00'),
    jsonb_build_object('sub_id','be5dca0d-447c-4320-990c-0f16c65a1df1','ent_id','eb4e0ff6-bb8d-48d8-a955-6c4129d2aa85','tg_id','798592a1-12d5-4b7d-9d3c-5ceadc54ff79','club_id','fa547c41-3a84-4c4f-904a-427332a0506e','user_id','961ac34c-75b4-47e6-b8f9-002ec87247ed','product_id','11c9f1b8-0355-4753-bd74-40b42aa53616','tariff_id','7c748940-dcad-4c7c-a92e-76a2344622d3','source_order_id','3c0bc1e1-fd95-4105-b3a9-a19b599bdbb0','source_payment_id','a3737a29-9d8a-4eea-88d4-f52d4b676073','expected_min_end','2026-06-02T20:59:59+00:00'),
    jsonb_build_object('sub_id','4616c3ed-75ba-46f1-a964-4f634d3fe3c8','ent_id','d3c3e069-b1f0-4a77-80e6-7dd01369b08a','tg_id','1faa5a46-4e8d-45c6-a186-c902b6f772d2','club_id','fa547c41-3a84-4c4f-904a-427332a0506e','user_id','2b352bdf-c251-4864-a8f3-ac32fcb96cf0','product_id','11c9f1b8-0355-4753-bd74-40b42aa53616','tariff_id','7c748940-dcad-4c7c-a92e-76a2344622d3','source_order_id','9b1ffb49-9319-46d4-b740-0dd13784ce7d','source_payment_id','58d1d641-3220-4511-b387-a37dab25fba2','expected_min_end','2026-05-31T20:59:59+00:00'),
    jsonb_build_object('sub_id','9cff47a2-4a2a-4cca-8b9c-ba230b91849c','ent_id','c8457528-761b-4af6-b85f-e3f162307f43','tg_id','36365883-f244-4e59-ba48-c49995f5797c','club_id','fa547c41-3a84-4c4f-904a-427332a0506e','user_id','1ca89a55-80aa-4178-8d35-652ffe4ce888','product_id','11c9f1b8-0355-4753-bd74-40b42aa53616','tariff_id','7c748940-dcad-4c7c-a92e-76a2344622d3','source_order_id','849198d4-93d8-4633-bc03-e317ac5a26f0','source_payment_id','b358d540-d9a2-412d-9e03-420424536263','expected_min_end','2026-05-30T20:59:59+00:00')
  );
BEGIN
  -- 1) BACKUP subscriptions_v2
  WITH src AS (
    SELECT
      (e->>'sub_id')::uuid AS sub_id,
      (e->>'user_id')::uuid AS user_id,
      (e->>'product_id')::uuid AS product_id,
      (e->>'tariff_id')::uuid AS tariff_id,
      (e->>'source_order_id')::uuid AS source_order_id,
      (e->>'source_payment_id')::uuid AS source_payment_id,
      (e->>'expected_min_end')::timestamptz AS expected_min_end
    FROM jsonb_array_elements(v_cohort) e
  )
  INSERT INTO public.subscriptions_v2_repair_backup_2026_05
    (batch_id, sub_id, user_id, product_id, tariff_id, status, access_end_at, next_charge_at, meta,
     source_order_id, source_payment_id, expected_min_end, reason, repair_bucket)
  SELECT v_batch_id, s.id, s.user_id, s.product_id, s.tariff_id, s.status, s.access_end_at, s.next_charge_at, s.meta,
         src.source_order_id, src.source_payment_id, src.expected_min_end,
         'recurring webhook overshoot stale-local + skip-stale-guard miss (patch 12.1+12.2 retroactive repair)',
         'auto_repair'
  FROM src
  JOIN public.subscriptions_v2 s ON s.id = src.sub_id;
  GET DIAGNOSTICS v_sub_backup_count = ROW_COUNT;
  IF v_sub_backup_count <> 5 THEN
    RAISE EXCEPTION 'subscriptions backup count mismatch: expected 5, got %', v_sub_backup_count;
  END IF;

  -- 2) BACKUP entitlements
  WITH src AS (
    SELECT
      (e->>'ent_id')::uuid AS ent_id,
      (e->>'source_order_id')::uuid AS source_order_id,
      (e->>'source_payment_id')::uuid AS source_payment_id,
      (e->>'expected_min_end')::timestamptz AS expected_min_end
    FROM jsonb_array_elements(v_cohort) e
  )
  INSERT INTO public.entitlements_repair_backup_2026_05
    (batch_id, ent_id, user_id, product_id, status, expires_at, meta,
     source_order_id, source_payment_id, expected_min_end, reason, repair_bucket)
  SELECT v_batch_id, ent.id, ent.user_id, ent.product_id, ent.status, ent.expires_at, ent.meta,
         src.source_order_id, src.source_payment_id, src.expected_min_end,
         'recurring webhook overshoot stale-local + skip-stale-guard miss (patch 12.1+12.2 retroactive repair)',
         'auto_repair'
  FROM src
  JOIN public.entitlements ent ON ent.id = src.ent_id;
  GET DIAGNOSTICS v_ent_backup_count = ROW_COUNT;
  IF v_ent_backup_count <> 5 THEN
    RAISE EXCEPTION 'entitlements backup count mismatch: expected 5, got %', v_ent_backup_count;
  END IF;

  -- 3) BACKUP telegram_access
  WITH src AS (
    SELECT
      (e->>'tg_id')::uuid AS tg_id,
      (e->>'source_order_id')::uuid AS source_order_id,
      (e->>'source_payment_id')::uuid AS source_payment_id,
      (e->>'expected_min_end')::timestamptz AS expected_min_end
    FROM jsonb_array_elements(v_cohort) e
  )
  INSERT INTO public.telegram_access_repair_backup_2026_05
    (batch_id, tg_id, user_id, club_id, active_until, state_chat, state_channel,
     source_order_id, source_payment_id, expected_min_end, reason, repair_bucket)
  SELECT v_batch_id, ta.id, ta.user_id, ta.club_id, ta.active_until, ta.state_chat, ta.state_channel,
         src.source_order_id, src.source_payment_id, src.expected_min_end,
         'recurring webhook overshoot stale-local + skip-stale-guard miss (patch 12.1+12.2 retroactive repair)',
         'auto_repair'
  FROM src
  JOIN public.telegram_access ta ON ta.id = src.tg_id;
  GET DIAGNOSTICS v_tg_backup_count = ROW_COUNT;
  IF v_tg_backup_count <> 5 THEN
    RAISE EXCEPTION 'telegram_access backup count mismatch: expected 5, got %', v_tg_backup_count;
  END IF;

  -- 4) UPDATE subscriptions_v2 (GREATEST + status flip expired→active)
  WITH src AS (
    SELECT
      (e->>'sub_id')::uuid AS sub_id,
      (e->>'expected_min_end')::timestamptz AS expected_min_end
    FROM jsonb_array_elements(v_cohort) e
  )
  UPDATE public.subscriptions_v2 s
  SET access_end_at = GREATEST(COALESCE(s.access_end_at, 'epoch'::timestamptz), src.expected_min_end),
      status = CASE WHEN s.status = 'expired' THEN 'active' ELSE s.status END,
      updated_at = now()
  FROM src
  WHERE s.id = src.sub_id;
  GET DIAGNOSTICS v_sub_upd = ROW_COUNT;
  IF v_sub_upd <> 5 THEN
    RAISE EXCEPTION 'subscriptions update count mismatch: expected 5, got %', v_sub_upd;
  END IF;

  -- 5) UPDATE entitlements
  WITH src AS (
    SELECT
      (e->>'ent_id')::uuid AS ent_id,
      (e->>'expected_min_end')::timestamptz AS expected_min_end
    FROM jsonb_array_elements(v_cohort) e
  )
  UPDATE public.entitlements ent
  SET expires_at = GREATEST(COALESCE(ent.expires_at, 'epoch'::timestamptz), src.expected_min_end),
      status = CASE WHEN ent.status = 'expired' THEN 'active' ELSE ent.status END,
      updated_at = now()
  FROM src
  WHERE ent.id = src.ent_id;
  GET DIAGNOSTICS v_ent_upd = ROW_COUNT;
  IF v_ent_upd <> 5 THEN
    RAISE EXCEPTION 'entitlements update count mismatch: expected 5, got %', v_ent_upd;
  END IF;

  -- 6) UPDATE telegram_access (только active_until; state_chat / state_channel НЕ меняем)
  WITH src AS (
    SELECT
      (e->>'tg_id')::uuid AS tg_id,
      (e->>'expected_min_end')::timestamptz AS expected_min_end
    FROM jsonb_array_elements(v_cohort) e
  )
  UPDATE public.telegram_access ta
  SET active_until = GREATEST(COALESCE(ta.active_until, 'epoch'::timestamptz), src.expected_min_end),
      updated_at = now()
  FROM src
  WHERE ta.id = src.tg_id;
  GET DIAGNOSTICS v_tg_upd = ROW_COUNT;
  IF v_tg_upd <> 5 THEN
    RAISE EXCEPTION 'telegram_access update count mismatch: expected 5, got %', v_tg_upd;
  END IF;

  -- 7) AUDIT — 15 строк: 3 action × 5 пользователей. before/after из backup + текущего состояния.
  -- subscription_extended
  INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, target_user_id, meta)
  SELECT
    NULL,
    'system',
    'recurring-repair-2026-05',
    'repair.recurring_2026_05.subscription_extended',
    b.user_id,
    jsonb_build_object(
      'batch_id', v_batch_id,
      'source_order_id', b.source_order_id,
      'source_payment_id', b.source_payment_id,
      'user_id', b.user_id,
      'product_id', b.product_id,
      'tariff_id', b.tariff_id,
      'expected_min_end_eod_minsk', b.expected_min_end,
      'before', jsonb_build_object('id', b.sub_id, 'status', b.status, 'access_end_at', b.access_end_at),
      'after', jsonb_build_object('id', s.id, 'status', s.status, 'access_end_at', s.access_end_at),
      'rule', 'GREATEST(current, expected_min_end)',
      'repair_bucket', b.repair_bucket,
      'patch_lineage', v_patch_lineage
    )
  FROM public.subscriptions_v2_repair_backup_2026_05 b
  JOIN public.subscriptions_v2 s ON s.id = b.sub_id
  WHERE b.batch_id = v_batch_id;

  -- entitlement_extended
  INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, target_user_id, meta)
  SELECT
    NULL,
    'system',
    'recurring-repair-2026-05',
    'repair.recurring_2026_05.entitlement_extended',
    b.user_id,
    jsonb_build_object(
      'batch_id', v_batch_id,
      'source_order_id', b.source_order_id,
      'source_payment_id', b.source_payment_id,
      'user_id', b.user_id,
      'product_id', b.product_id,
      'expected_min_end_eod_minsk', b.expected_min_end,
      'before', jsonb_build_object('id', b.ent_id, 'status', b.status, 'expires_at', b.expires_at),
      'after', jsonb_build_object('id', ent.id, 'status', ent.status, 'expires_at', ent.expires_at),
      'rule', 'GREATEST(current, expected_min_end)',
      'repair_bucket', b.repair_bucket,
      'patch_lineage', v_patch_lineage
    )
  FROM public.entitlements_repair_backup_2026_05 b
  JOIN public.entitlements ent ON ent.id = b.ent_id
  WHERE b.batch_id = v_batch_id;

  -- telegram_access_extended
  INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, target_user_id, meta)
  SELECT
    NULL,
    'system',
    'recurring-repair-2026-05',
    'repair.recurring_2026_05.telegram_access_extended',
    b.user_id,
    jsonb_build_object(
      'batch_id', v_batch_id,
      'source_order_id', b.source_order_id,
      'source_payment_id', b.source_payment_id,
      'user_id', b.user_id,
      'club_id', b.club_id,
      'expected_min_end_eod_minsk', b.expected_min_end,
      'before', jsonb_build_object('id', b.tg_id, 'active_until', b.active_until, 'state_chat', b.state_chat, 'state_channel', b.state_channel),
      'after', jsonb_build_object('id', ta.id, 'active_until', ta.active_until, 'state_chat', ta.state_chat, 'state_channel', ta.state_channel),
      'rule', 'GREATEST(current, expected_min_end)',
      'repair_bucket', b.repair_bucket,
      'patch_lineage', v_patch_lineage
    )
  FROM public.telegram_access_repair_backup_2026_05 b
  JOIN public.telegram_access ta ON ta.id = b.tg_id
  WHERE b.batch_id = v_batch_id;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_logs
  WHERE actor_label = 'recurring-repair-2026-05'
    AND meta->>'batch_id' = v_batch_id;

  IF v_audit_count <> 15 THEN
    RAISE EXCEPTION 'audit rows count mismatch: expected 15, got %', v_audit_count;
  END IF;

  RAISE NOTICE 'REPAIR OK: batch_id=%, sub_backup=%, ent_backup=%, tg_backup=%, sub_upd=%, ent_upd=%, tg_upd=%, audit=%',
    v_batch_id, v_sub_backup_count, v_ent_backup_count, v_tg_backup_count, v_sub_upd, v_ent_upd, v_tg_upd, v_audit_count;
END
$repair$;
