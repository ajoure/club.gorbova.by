-- Create tariff_features table for dynamic plan features/bullets
CREATE TABLE public.tariff_features (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tariff_id UUID NOT NULL REFERENCES public.tariffs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  icon TEXT DEFAULT 'check',
  is_bonus BOOLEAN DEFAULT false,
  is_highlighted BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  
  -- Visibility/promo settings
  visibility_mode TEXT DEFAULT 'always' CHECK (visibility_mode IN ('always', 'date_range', 'until_date')),
  active_from TIMESTAMPTZ,
  active_to TIMESTAMPTZ,
  
  -- Optional extras
  label TEXT,
  link_url TEXT,
  bonus_type TEXT CHECK (bonus_type IS NULL OR bonus_type IN ('none', 'telegram_message', 'email', 'external_link', 'internal_access')),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tariff_features ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (public read for active features, admin write)
CREATE POLICY "Public can read tariff features"
ON public.tariff_features
FOR SELECT
USING (true);

CREATE POLICY "Admins can manage tariff features"
ON public.tariff_features
FOR ALL
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role)
);

-- Create index for faster lookups
CREATE INDEX idx_tariff_features_tariff ON public.tariff_features(tariff_id, sort_order);

-- Add trigger for updated_at
CREATE TRIGGER update_tariff_features_updated_at
BEFORE UPDATE ON public.tariff_features
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();