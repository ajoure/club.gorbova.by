UPDATE public.payments_v2
SET amount = 5.00
WHERE provider_payment_id = 'pi_3TeJWM6UYJj2vm0G0L6LxhcN'
  AND amount = 500.00;

UPDATE public.orders_v2
SET paid_amount = 5.00
WHERE id = 'cffcb1f2-ecd6-492f-a8d7-ded4d32452df'
  AND (paid_amount IS NULL OR paid_amount = 0);

INSERT INTO public.audit_logs (action, entity_type, entity_id, meta)
VALUES (
  'stripe.repair.amount_minor_units_2026_06_03',
  'orders_v2',
  'cffcb1f2-ecd6-492f-a8d7-ded4d32452df',
  jsonb_build_object(
    'order_number', 'ORD-26-00140',
    'provider_payment_id', 'pi_3TeJWM6UYJj2vm0G0L6LxhcN',
    'reason', 'webhook recorded minor units (500) instead of major (5.00); fixed in code add-only',
    'fix', 'one-shot repair single order'
  )
);