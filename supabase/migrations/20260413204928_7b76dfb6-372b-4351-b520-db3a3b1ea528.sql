UPDATE public.products_v2 
SET primary_domain = 'consultation.gorbova.by', updated_at = now()
WHERE code = 'consultation' AND primary_domain = 'cons.gorbova.by';