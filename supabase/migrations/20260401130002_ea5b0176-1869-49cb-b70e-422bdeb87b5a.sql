ALTER TABLE public.site_form_submissions 
  ADD COLUMN order_id UUID REFERENCES public.orders_v2(id);