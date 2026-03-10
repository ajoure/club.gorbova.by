ALTER TABLE public.orders_v2 ADD COLUMN deal_date timestamptz;

UPDATE public.orders_v2 SET deal_date = created_at WHERE deal_date IS NULL;