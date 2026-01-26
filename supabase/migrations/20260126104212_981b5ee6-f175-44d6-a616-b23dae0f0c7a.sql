-- PATCH 1: Add needs_mapping to order_status enum + advisory lock functions

-- 1. Add new enum value for problematic orders
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'needs_mapping';

-- 2. Create advisory lock wrapper functions for backfill anti-parallelism
CREATE OR REPLACE FUNCTION public.try_backfill_lock(p_lock_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT pg_try_advisory_lock(p_lock_id);
$$;

CREATE OR REPLACE FUNCTION public.release_backfill_lock(p_lock_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT pg_advisory_unlock(p_lock_id);
$$;