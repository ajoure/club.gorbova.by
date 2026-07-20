-- Companies Phase 8A: additive document compatibility.
-- Existing document snapshots remain immutable; company_id is only populated
-- for new rows when a single active company link can be resolved explicitly.

ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
ALTER TABLE public.ai_generated_documents
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_generated_documents_company
  ON public.generated_documents(company_id, document_date DESC)
  WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_generated_documents_company
  ON public.ai_generated_documents(company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.resolve_generated_document_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF NEW.company_id IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT min(company_id) INTO v_company_id
      FROM public.company_order_links
     WHERE order_id = NEW.order_id AND unlinked_at IS NULL
     HAVING count(DISTINCT company_id) = 1;
    NEW.company_id := v_company_id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_ai_generated_document_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF NEW.company_id IS NULL
     AND NEW.context_type IN ('order', 'deal')
     AND NEW.context_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    SELECT min(company_id) INTO v_company_id
      FROM public.company_order_links
     WHERE order_id = NEW.context_id::uuid AND unlinked_at IS NULL
     HAVING count(DISTINCT company_id) = 1;
    NEW.company_id := v_company_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_resolve_generated_document_company ON public.generated_documents;
CREATE TRIGGER trg_resolve_generated_document_company
BEFORE INSERT ON public.generated_documents
FOR EACH ROW EXECUTE FUNCTION public.resolve_generated_document_company();

DROP TRIGGER IF EXISTS trg_resolve_ai_generated_document_company ON public.ai_generated_documents;
CREATE TRIGGER trg_resolve_ai_generated_document_company
BEFORE INSERT ON public.ai_generated_documents
FOR EACH ROW EXECUTE FUNCTION public.resolve_ai_generated_document_company();
