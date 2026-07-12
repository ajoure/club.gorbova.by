DO $$
DECLARE active_battle int;
BEGIN
  SELECT COUNT(*) INTO active_battle FROM public.orders_v2
   WHERE meta->'rr'->>'mode'='battle' AND status::text NOT IN ('paid','cancelled','failed','refunded','expired','fulfilled');
  IF active_battle <> 0 THEN
    RAISE EXCEPTION 'active_battle_rr_orders=% > 0, aborted', active_battle;
  END IF;
  UPDATE public.integration_instances
     SET config = jsonb_set(config, '{mode}', '"battle"'::jsonb, true),
         updated_at = now()
   WHERE provider='rr';
END $$;