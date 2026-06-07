
-- Backfill business_stream for Gorbova Club product.
-- Source: .lovable/discovery/business_stream_classification_v1.md §3 — Gorbova Club → 'club'.
-- Idempotent: only sets if not already present.
UPDATE products_v2
SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{business_stream}', '"club"'::jsonb, true)
WHERE id = '11c9f1b8-0355-4753-bd74-40b42aa53616'
  AND (meta->>'business_stream') IS DISTINCT FROM 'club';

INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, actor_label, meta)
VALUES (
  'products_v2.business_stream_backfill',
  'product',
  '11c9f1b8-0355-4753-bd74-40b42aa53616',
  'system',
  'phase_6_hot_patch_customer_choice_smoke',
  jsonb_build_object('business_stream','club','source','discovery/business_stream_classification_v1.md','reason','unblock_customer_choice_stripe_price_provision')
);
