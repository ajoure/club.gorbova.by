-- Stage 4 Playwright fixtures — idempotent reset.
-- Safe to re-run: every write is scoped by exact fixture UUIDs and meta.fixture='stage4_playwright'.
-- Restores the exact 9-row inventory (6 payments + 1 order + 1 queue + 0 profiles;
-- add profile row here if/when a dedicated fixture profile is provisioned).
-- HARD RULE: this script MUST NOT touch any row outside the fixture ID set below.

BEGIN;

-- ------------------------------------------------------------------
-- 1. Purge derived Stage-4 artifacts referencing fixture IDs (tombstones,
--    delete operations, audit trail). No effect on non-fixture data.
-- ------------------------------------------------------------------
DELETE FROM public.payment_tombstones
 WHERE original_payment_id IN (
   '11111111-1111-4111-8111-000000000001',
   '22222222-2222-4222-8222-0000000000a1',
   '22222222-2222-4222-8222-0000000000a2',
   '33333333-3333-4333-8333-00000000000a',
   '33333333-3333-4333-8333-00000000000b',
   '44444444-4444-4444-8444-000000000001'
 );

DELETE FROM public.payment_delete_operations
 WHERE payload::text LIKE '%stage4_playwright%'
    OR (target_payment_ids && ARRAY[
          '11111111-1111-4111-8111-000000000001'::uuid,
          '22222222-2222-4222-8222-0000000000a1'::uuid,
          '22222222-2222-4222-8222-0000000000a2'::uuid,
          '33333333-3333-4333-8333-00000000000a'::uuid,
          '33333333-3333-4333-8333-00000000000b'::uuid,
          '44444444-4444-4444-8444-000000000001'::uuid
        ]);

-- ------------------------------------------------------------------
-- 2. Hard-delete fixture payments / order / queue row (bypass soft-delete
--    guard because these are E2E fixtures owned by the test harness).
-- ------------------------------------------------------------------
DELETE FROM public.payments_v2
 WHERE id IN (
   '11111111-1111-4111-8111-000000000001',
   '22222222-2222-4222-8222-0000000000a1',
   '22222222-2222-4222-8222-0000000000a2',
   '33333333-3333-4333-8333-00000000000a',
   '33333333-3333-4333-8333-00000000000b',
   '44444444-4444-4444-8444-000000000001'
 );

DELETE FROM public.orders_v2
 WHERE id = '22222222-2222-4222-8222-000000000002';

DELETE FROM public.payment_reconcile_queue
 WHERE id = '44444444-4444-4444-8444-0000000000f0';

-- ------------------------------------------------------------------
-- 3. Recreate fixtures.
-- ------------------------------------------------------------------
INSERT INTO public.orders_v2 (id, order_number, base_price, final_price, currency, status, meta)
VALUES (
  '22222222-2222-4222-8222-000000000002',
  'E2E-STAGE4-S2-ORDER',
  50.00, 50.00, 'BYN', 'paid',
  jsonb_build_object('env','test','fixture','stage4_playwright','scenario','S2')
);

INSERT INTO public.payments_v2 (id, amount, currency, status, provider, provider_payment_id, origin, paid_at, meta)
VALUES
  ('11111111-1111-4111-8111-000000000001', 10.00, 'BYN', 'succeeded', 'bepaid', 'stage4-s1-bepaid',   'manual_admin', now(),
   jsonb_build_object('env','test','fixture','stage4_playwright','scenario','S1','label','E2E-STAGE4-S1')),
  ('33333333-3333-4333-8333-00000000000a', 15.00, 'BYN', 'succeeded', 'bepaid', 'stage4-s3a-bepaid',  'manual_admin', now(),
   jsonb_build_object('env','test','fixture','stage4_playwright','scenario','S3-A','label','E2E-STAGE4-S3-A')),
  ('33333333-3333-4333-8333-00000000000b', 20.00, 'BYN', 'succeeded', 'stripe', 'stage4-s3b-stripe',  'manual_admin', now(),
   jsonb_build_object('env','test','fixture','stage4_playwright','scenario','S3-B','label','E2E-STAGE4-S3-B')),
  ('44444444-4444-4444-8444-000000000001', 12.00, 'BYN', 'succeeded', 'bepaid', 'stage4-s4-canonical','manual_admin', now(),
   jsonb_build_object('env','test','fixture','stage4_playwright','scenario','S4-canonical','label','E2E-STAGE4-S4-CANONICAL'));

INSERT INTO public.payments_v2 (id, order_id, amount, currency, status, provider, provider_payment_id, origin, paid_at, meta)
VALUES
  ('22222222-2222-4222-8222-0000000000a1', '22222222-2222-4222-8222-000000000002',
   25.00, 'BYN', 'succeeded', 'bepaid', 'stage4-s2-bepaid-a',  'manual_admin', now(),
   jsonb_build_object('env','test','fixture','stage4_playwright','scenario','S2','label','E2E-STAGE4-S2-A')),
  ('22222222-2222-4222-8222-0000000000a2', '22222222-2222-4222-8222-000000000002',
   25.00, 'BYN', 'succeeded', 'stripe', 'stage4-s2-stripe-b',  'manual_admin', now(),
   jsonb_build_object('env','test','fixture','stage4_playwright','scenario','S2','label','E2E-STAGE4-S2-B'));

INSERT INTO public.payment_reconcile_queue (
  id, amount, currency, provider, bepaid_uid, source, status, status_normalized,
  transaction_type, is_fee, paid_at, raw_payload
)
VALUES (
  '44444444-4444-4444-8444-0000000000f0',
  7.00, 'BYN', 'bepaid', 'stage4-s4-queue', 'webhook', 'pending', 'successful',
  'payment', false, now(),
  jsonb_build_object('env','test','fixture','stage4_playwright','scenario','S4-queue','label','E2E-STAGE4-S4-QUEUE')
);


COMMIT;

-- Self-check (run separately if needed):
--   SELECT count(*) FROM public.payments_v2            WHERE meta->>'fixture'='stage4_playwright'; -- expect 6
--   SELECT count(*) FROM public.orders_v2              WHERE meta->>'fixture'='stage4_playwright'; -- expect 1
--   SELECT count(*) FROM public.payment_reconcile_queue WHERE raw_payload->>'fixture'='stage4_playwright'; -- expect 1
