CREATE OR REPLACE FUNCTION public.resolve_ai_generated_document_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_count int;
BEGIN
  IF NEW.company_id IS NULL
     AND NEW.context_type IN ('order', 'deal')
     AND NEW.context_id IS NOT NULL
  THEN
    SELECT count(DISTINCT company_id)
      INTO v_count
      FROM public.company_order_links
     WHERE order_id = NEW.context_id
       AND unlinked_at IS NULL;

    IF v_count = 1 THEN
      SELECT company_id
        INTO v_company_id
        FROM public.company_order_links
       WHERE order_id = NEW.context_id
         AND unlinked_at IS NULL
       LIMIT 1;
      NEW.company_id := v_company_id;
    END IF;
  END IF;
  RETURN NEW;
END
$function$;