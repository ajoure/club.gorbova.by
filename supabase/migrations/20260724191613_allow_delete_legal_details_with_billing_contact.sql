-- A billing contact created from user requisites keeps source lineage through
-- client_legal_details_company_map. Deleting those requisites cascades to the
-- map, so the generated billing contact must disappear with that map as well.
--
-- This does not delete the CRM company, profile, orders, payments or documents.
ALTER TABLE public.company_contacts
  DROP CONSTRAINT IF EXISTS company_contacts_source_client_legal_details_map_id_fkey;

ALTER TABLE public.company_contacts
  ADD CONSTRAINT company_contacts_source_client_legal_details_map_id_fkey
  FOREIGN KEY (source_client_legal_details_map_id)
  REFERENCES public.client_legal_details_company_map(id)
  ON DELETE CASCADE;
