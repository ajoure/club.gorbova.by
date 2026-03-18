

# Add Table Comments for Service-Role-Only Tables

## Summary

Add explicit `COMMENT ON TABLE` documentation to 4 service-role-only tables that have RLS enabled with no policies by design. This prevents future confusion when someone tries to use these tables from the client.

## Migration

Single SQL migration with 4 `COMMENT` statements:

```sql
COMMENT ON TABLE public.media_jobs IS
  'Service-role only. RLS enabled with no policies by design. No client access.';

COMMENT ON TABLE public.notification_outbox IS
  'Service-role only. RLS enabled with no policies by design.';

COMMENT ON TABLE public.subscription_payment_credentials IS
  'Service-role only. Contains sensitive data. Never exposed to client.';

COMMENT ON TABLE public.support_ticket_counters IS
  'Service-role only. Internal counters.';
```

## Impact

- Zero functional impact — `COMMENT` is metadata only
- No code changes required
- Serves as inline documentation for future developers

