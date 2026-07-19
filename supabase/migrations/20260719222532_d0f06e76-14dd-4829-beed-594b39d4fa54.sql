
DO $cleanup$
DECLARE
  v_company uuid := '270b0637-32d4-41f4-ba42-6616a7d2553e';
  v_contact uuid := 'c8cf1255-ef87-4a97-a27f-54c77eca1007';
  v_seq bigint;
BEGIN
  -- FK-safe order: activity/audit/events → contacts → companies
  DELETE FROM public.crm_activity_log WHERE id IN ('8068537b-6379-43cf-83c9-094ad80b0b6d','270bcb8e-d911-49be-8ebd-086a91b04c7e');
  DELETE FROM public.domain_events    WHERE id IN ('d4213901-154f-4caf-bb43-747a3121aa46','4abf9ec5-62e6-4f6a-ae38-4b5e4998eac2');
  DELETE FROM public.audit_logs       WHERE id  =  '373f4af3-0d89-4a78-b806-df05944b0e49';
  DELETE FROM public.company_sync_queue WHERE entity_id IN (v_company, v_contact);
  DELETE FROM public.company_contacts WHERE id = v_contact;
  DELETE FROM public.companies WHERE id = v_company;

  -- Restore CMP sequence to 0 only if no companies remain and current seq is exactly 1
  SELECT last_value INTO v_seq FROM public.public_id_sequences WHERE entity_type='company';
  IF (SELECT count(*) FROM public.companies) = 0 AND v_seq = 1 THEN
    UPDATE public.public_id_sequences SET last_value = 0 WHERE entity_type='company';
  ELSE
    RAISE EXCEPTION 'CMP seq restore guard failed: companies_count=% seq=%', (SELECT count(*) FROM public.companies), v_seq;
  END IF;
END
$cleanup$;
