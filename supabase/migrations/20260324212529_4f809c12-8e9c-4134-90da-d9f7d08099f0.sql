
-- public_id sequence for corporate drafts
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('corporate_draft', 'CDS', 0) ON CONFLICT DO NOTHING;

-- Trigger function for public_id
CREATE OR REPLACE FUNCTION public.set_corporate_draft_public_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.public_id IS NULL THEN
    NEW.public_id := public.next_public_id('corporate_draft');
  END IF;
  RETURN NEW;
END;
$$;

-- Main table
CREATE TABLE public.corporate_draft_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  legal_details_id uuid REFERENCES public.client_legal_details(id),

  report_year integer NOT NULL DEFAULT (EXTRACT(YEAR FROM now()) - 1)::int,
  procedure_mode text NOT NULL DEFAULT 'annual_meeting'
    CHECK (procedure_mode IN ('annual_meeting', 'sole_participant_decision')),
  procedure_mode_override_reason text,

  -- Charter
  charter_source_type text CHECK (charter_source_type IN ('upload_docx', 'upload_pdf', 'upload_image', 'text', 'manual')),
  charter_extraction_status text DEFAULT 'none' CHECK (charter_extraction_status IN ('none', 'pending', 'extracted', 'confirmed', 'failed')),
  charter_file_path text,
  charter_raw_text text,
  extracted_charter_rules jsonb DEFAULT '{}',
  confirmed_charter_rules jsonb DEFAULT '{}',
  charter_confirmed_at timestamptz,
  charter_confirmed_by text CHECK (charter_confirmed_by IN ('ai_extraction', 'manual')),

  -- Corporate params (structured JSONB)
  corporate_params jsonb DEFAULT '{}',

  -- Rules basis
  rules_basis text DEFAULT 'law_default' CHECK (rules_basis IN ('charter_confirmed', 'law_default', 'mixed')),

  -- Package manifest (calculated by rule engine)
  package_manifest jsonb DEFAULT '{}',

  -- Warnings separated
  warnings jsonb DEFAULT '[]',
  blocking_errors jsonb DEFAULT '[]',
  non_blocking_warnings jsonb DEFAULT '[]',

  -- Status
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','charter_pending','params_pending',
                      'preview','confirmed','generating','generated','cancelled')),

  metadata jsonb DEFAULT '{}',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Triggers
CREATE TRIGGER trg_corporate_draft_public_id
  BEFORE INSERT ON public.corporate_draft_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_corporate_draft_public_id();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.corporate_draft_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.corporate_draft_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner full access" ON public.corporate_draft_sessions
  FOR ALL TO authenticated
  USING (profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))
  WITH CHECK (profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()));

-- Storage bucket for charter documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('charter-documents', 'charter-documents', false)
ON CONFLICT DO NOTHING;

-- Storage RLS: owner can upload/read own files (path starts with profile_id)
CREATE POLICY "Owner upload charter" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'charter-documents' AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Owner read charter" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'charter-documents' AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Owner delete charter" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'charter-documents' AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM profiles WHERE user_id = auth.uid()
  ));
