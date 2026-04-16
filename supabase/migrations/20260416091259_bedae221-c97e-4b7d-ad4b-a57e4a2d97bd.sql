CREATE OR REPLACE FUNCTION public.generate_order_number()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  new_number TEXT;
  year_part TEXT;
  seq_part INTEGER;
BEGIN
  year_part := to_char(now(), 'YY');
  
  SELECT COALESCE(MAX(
    CASE 
      WHEN regexp_replace(order_number, '^ORD-' || year_part || '-', '') ~ '^\d+$'
      THEN regexp_replace(order_number, '^ORD-' || year_part || '-', '')::INTEGER
      ELSE 0
    END
  ), 0) + 1
  INTO seq_part
  FROM public.orders_v2
  WHERE order_number LIKE 'ORD-' || year_part || '-%';
  
  new_number := 'ORD-' || year_part || '-' || LPAD(seq_part::TEXT, 5, '0');
  RETURN new_number;
END;
$function$;