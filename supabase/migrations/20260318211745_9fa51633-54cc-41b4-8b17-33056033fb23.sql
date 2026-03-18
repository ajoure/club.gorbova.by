COMMENT ON TABLE public.media_jobs IS
  'Service-role only. RLS enabled with no policies by design. No client access.';

COMMENT ON TABLE public.notification_outbox IS
  'Service-role only. RLS enabled with no policies by design.';

COMMENT ON TABLE public.subscription_payment_credentials IS
  'Service-role only. Contains sensitive data. Never exposed to client.';

COMMENT ON TABLE public.support_ticket_counters IS
  'Service-role only. Internal counters.';