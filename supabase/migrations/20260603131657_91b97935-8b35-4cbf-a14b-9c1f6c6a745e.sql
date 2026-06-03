UPDATE public.orders_v2
SET status = 'failed',
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'sandbox_aborted', true,
      'abort_reason', 'stripe_currency_not_supported_legacy_pre_patch',
      'aborted_at', now()
    )
WHERE order_number IN ('ORD-26-00127','ORD-26-00128')
  AND status = 'pending'
  AND provider = 'stripe';