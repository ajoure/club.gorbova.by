-- Extend products_v2 with landing configuration
ALTER TABLE public.products_v2
ADD COLUMN IF NOT EXISTS landing_config jsonb DEFAULT '{
  "hero_title": "",
  "hero_subtitle": "",
  "tariffs_title": "Тарифы",
  "tariffs_subtitle": "Выберите подходящий формат участия",
  "disclaimer_text": "",
  "show_badges": true,
  "price_suffix": "BYN/мес"
}'::jsonb;

-- Extend tariffs with more display options
ALTER TABLE public.tariffs
ADD COLUMN IF NOT EXISTS is_popular boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS discount_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS discount_percent integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS original_price numeric;

-- Create product_versions for tracking changes
CREATE TABLE IF NOT EXISTS public.product_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  changed_by uuid,
  changed_at timestamp with time zone NOT NULL DEFAULT now(),
  diff_summary text,
  snapshot jsonb NOT NULL,
  UNIQUE(product_id, version)
);

ALTER TABLE public.product_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage product versions"
ON public.product_versions FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_product_versions_product ON public.product_versions(product_id, version DESC);

-- Add features as jsonb array to tariffs if not exists
ALTER TABLE public.tariffs
ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '[]'::jsonb;

-- Ensure tariff_offers has all needed fields for trial
ALTER TABLE public.tariff_offers
ADD COLUMN IF NOT EXISTS requires_card_tokenization boolean DEFAULT false;