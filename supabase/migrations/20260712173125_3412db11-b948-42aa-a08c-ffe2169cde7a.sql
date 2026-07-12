-- Guarded one-off return of RR integration to test mode.
-- Idempotent: WHERE clause ensures re-application is a no-op after first success.
-- Only touches config.mode; other fields (logins, secret flags) preserved.
UPDATE public.integration_instances
   SET config = jsonb_set(config, '{mode}', '"test"'::jsonb),
       updated_at = now()
 WHERE provider = 'rr'
   AND config->>'mode' = 'battle'
   AND NOT EXISTS (
     SELECT 1 FROM public.orders_v2
      WHERE provider = 'rr'
        AND meta->'rr'->>'mode' = 'battle'
   );