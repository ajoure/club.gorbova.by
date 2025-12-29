-- Integration sync settings table
CREATE TABLE public.integration_sync_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES public.integration_instances(id) ON DELETE CASCADE,
  entity_type text NOT NULL, -- users, orders, payments, groups, contacts, companies, deals
  direction text NOT NULL DEFAULT 'import' CHECK (direction IN ('import', 'export', 'bidirectional')),
  is_enabled boolean NOT NULL DEFAULT false,
  filters jsonb DEFAULT '{}'::jsonb,
  conflict_strategy text DEFAULT 'project_wins' CHECK (conflict_strategy IN ('project_wins', 'external_wins', 'by_updated_at')),
  last_sync_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(instance_id, entity_type)
);

-- Field mapping table
CREATE TABLE public.integration_field_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES public.integration_instances(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  project_field text NOT NULL,
  external_field text NOT NULL,
  field_type text DEFAULT 'text', -- text, number, date, select, multitext
  is_required boolean DEFAULT false,
  is_key_field boolean DEFAULT false, -- e.g., email
  transform_rules jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(instance_id, entity_type, project_field)
);

-- Sync log/history table for detailed sync operations
CREATE TABLE public.integration_sync_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES public.integration_instances(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  direction text NOT NULL,
  object_id text, -- ID of synced object
  object_type text, -- user, order, payment, etc.
  result text NOT NULL CHECK (result IN ('success', 'error', 'skipped')),
  error_message text,
  payload_meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.integration_sync_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_field_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for sync settings
CREATE POLICY "Admins can manage sync settings" 
ON public.integration_sync_settings 
FOR ALL 
USING (has_permission(auth.uid(), 'entitlements.manage'))
WITH CHECK (has_permission(auth.uid(), 'entitlements.manage'));

-- RLS policies for field mappings
CREATE POLICY "Admins can manage field mappings" 
ON public.integration_field_mappings 
FOR ALL 
USING (has_permission(auth.uid(), 'entitlements.manage'))
WITH CHECK (has_permission(auth.uid(), 'entitlements.manage'));

-- RLS policies for sync logs
CREATE POLICY "Admins can view sync logs" 
ON public.integration_sync_logs 
FOR SELECT 
USING (has_permission(auth.uid(), 'entitlements.manage'));

CREATE POLICY "Admins can insert sync logs" 
ON public.integration_sync_logs 
FOR INSERT 
WITH CHECK (has_permission(auth.uid(), 'entitlements.manage'));

-- Triggers for updated_at
CREATE TRIGGER update_integration_sync_settings_updated_at
BEFORE UPDATE ON public.integration_sync_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_integration_field_mappings_updated_at
BEFORE UPDATE ON public.integration_field_mappings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_integration_sync_settings_instance ON public.integration_sync_settings(instance_id);
CREATE INDEX idx_integration_field_mappings_instance ON public.integration_field_mappings(instance_id);
CREATE INDEX idx_integration_sync_logs_instance ON public.integration_sync_logs(instance_id);
CREATE INDEX idx_integration_sync_logs_created_at ON public.integration_sync_logs(created_at DESC);