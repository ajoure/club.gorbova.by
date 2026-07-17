REVOKE ALL ON FUNCTION public.claim_notification_outbox_slot(uuid, text, text, text, text, jsonb, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_notification_outbox_slot(uuid, text, text, text, text, jsonb, interval) FROM anon;
REVOKE ALL ON FUNCTION public.claim_notification_outbox_slot(uuid, text, text, text, text, jsonb, interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox_slot(uuid, text, text, text, text, jsonb, interval) TO service_role;