-- Table for storing import mapping rules (reusable patterns)
CREATE TABLE public.import_mapping_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_pattern TEXT NOT NULL,
  target_tariff_id UUID REFERENCES public.tariffs(id) ON DELETE SET NULL,
  secondary_field_name TEXT,
  secondary_field_value TEXT,
  additional_conditions JSONB DEFAULT '{}',
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE public.import_mapping_rules ENABLE ROW LEVEL SECURITY;

-- Admin-only policies using has_role function
CREATE POLICY "Admins can view import mapping rules"
ON public.import_mapping_rules
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Admins can manage import mapping rules"
ON public.import_mapping_rules
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

-- Index for faster pattern matching
CREATE INDEX idx_import_mapping_rules_pattern ON public.import_mapping_rules(source_pattern);
CREATE INDEX idx_import_mapping_rules_active ON public.import_mapping_rules(is_active) WHERE is_active = true;

-- Trigger for updated_at
CREATE TRIGGER update_import_mapping_rules_updated_at
BEFORE UPDATE ON public.import_mapping_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();