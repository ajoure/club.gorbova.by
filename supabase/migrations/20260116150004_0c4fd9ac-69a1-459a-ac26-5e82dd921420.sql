-- Enable realtime for payments tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments_v2;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_reconcile_queue;