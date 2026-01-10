-- Create reentry price multipliers table
CREATE TABLE public.reentry_price_multipliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES public.products_v2(id) ON DELETE CASCADE,
  tariff_id UUID REFERENCES public.tariffs(id) ON DELETE CASCADE,
  multiplier DECIMAL(3,2) DEFAULT 1.50,
  fixed_price DECIMAL(10,2),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.reentry_price_multipliers ENABLE ROW LEVEL SECURITY;

-- RLS policies for reentry_price_multipliers with correct type cast
CREATE POLICY "Admins can manage reentry multipliers"
ON public.reentry_price_multipliers
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role::text IN ('admin', 'super_admin')
  )
);

CREATE POLICY "Public can read active reentry multipliers"
ON public.reentry_price_multipliers
FOR SELECT
USING (is_active = TRUE);