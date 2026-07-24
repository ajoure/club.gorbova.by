ALTER TABLE public.company_contacts
  DROP CONSTRAINT IF EXISTS company_contacts_source_client_legal_details_map_id_fkey;

ALTER TABLE public.company_contacts
  ADD CONSTRAINT company_contacts_source_client_legal_details_map_id_fkey
  FOREIGN KEY (source_client_legal_details_map_id)
  REFERENCES public.client_legal_details_company_map(id)
  ON DELETE CASCADE;