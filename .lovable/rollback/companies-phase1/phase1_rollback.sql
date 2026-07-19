-- CRM Companies — Phase 1 rollback SQL (готовится, НЕ применяется).
-- Источник: companies_phase1_runnable_plan.md §9.
-- Порядок строго обратный созданию, без CASCADE.

BEGIN;

-- 9.1 RPC
DROP FUNCTION IF EXISTS public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid);
DROP FUNCTION IF EXISTS public.crm_company_get_or_create(text,text,text,text,text,uuid);

-- 9.2 Triggers
DROP TRIGGER IF EXISTS trg_set_companies_public_id ON public.companies;
DROP TRIGGER IF EXISTS update_companies_updated_at ON public.companies;
DROP TRIGGER IF EXISTS update_company_contacts_updated_at ON public.company_contacts;
DROP TRIGGER IF EXISTS update_client_legal_details_company_map_updated_at ON public.client_legal_details_company_map;
DROP TRIGGER IF EXISTS update_company_sync_queue_updated_at ON public.company_sync_queue;

-- 9.3 Trigger function
DROP FUNCTION IF EXISTS public.set_companies_public_id();

-- 9.4 Policies
DROP POLICY IF EXISTS "companies read for CRM staff" ON public.companies;
DROP POLICY IF EXISTS "companies insert for admin+manager" ON public.companies;
DROP POLICY IF EXISTS "companies update for admin+manager" ON public.companies;
DROP POLICY IF EXISTS "companies delete for super_admin" ON public.companies;
DROP POLICY IF EXISTS "company_contacts read for CRM staff" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts insert for admin+manager" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts update for admin+manager" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts delete for super_admin" ON public.company_contacts;
DROP POLICY IF EXISTS "client_legal_details_company_map read for CRM staff" ON public.client_legal_details_company_map;
DROP POLICY IF EXISTS "client_legal_details_company_map insert for admin+manager" ON public.client_legal_details_company_map;
DROP POLICY IF EXISTS "client_legal_details_company_map update for admin+manager" ON public.client_legal_details_company_map;
DROP POLICY IF EXISTS "client_legal_details_company_map delete for super_admin" ON public.client_legal_details_company_map;
DROP POLICY IF EXISTS "company_sync_queue service only" ON public.company_sync_queue;

-- 9.5 Tables (reverse order: FK targets last)
DROP TABLE public.company_sync_queue;
DROP TABLE public.company_contacts;
DROP TABLE public.client_legal_details_company_map;
DROP TABLE public.companies;

-- 9.6 Namespace
DELETE FROM public.public_id_sequences WHERE entity_type='company';

COMMIT;
