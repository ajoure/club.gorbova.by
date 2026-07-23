ALTER TABLE public.order_groups
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;
