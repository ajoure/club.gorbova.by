UPDATE public.integration_instances
   SET config = jsonb_set(config, '{mode}', '"test"'::jsonb, true),
       updated_at = now()
 WHERE provider='rr';