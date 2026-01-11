-- Create table for mapping bePaid products to our products
CREATE TABLE public.bepaid_product_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bepaid_plan_title TEXT NOT NULL,
  bepaid_description TEXT,
  product_id UUID REFERENCES public.products_v2(id) ON DELETE SET NULL,
  tariff_id UUID REFERENCES public.tariffs(id) ON DELETE SET NULL,
  offer_id UUID REFERENCES public.tariff_offers(id) ON DELETE SET NULL,
  is_subscription BOOLEAN DEFAULT true,
  auto_create_order BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(bepaid_plan_title)
);

-- Enable RLS
ALTER TABLE public.bepaid_product_mappings ENABLE ROW LEVEL SECURITY;

-- Admin-only access policies using role enum directly
CREATE POLICY "Admins can view bepaid mappings"
  ON public.bepaid_product_mappings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'superadmin')
    )
  );

CREATE POLICY "Admins can insert bepaid mappings"
  ON public.bepaid_product_mappings
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'superadmin')
    )
  );

CREATE POLICY "Admins can update bepaid mappings"
  ON public.bepaid_product_mappings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'superadmin')
    )
  );

CREATE POLICY "Admins can delete bepaid mappings"
  ON public.bepaid_product_mappings
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'superadmin')
    )
  );

-- Create trigger for updated_at
CREATE TRIGGER update_bepaid_product_mappings_updated_at
  BEFORE UPDATE ON public.bepaid_product_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for fast lookup
CREATE INDEX idx_bepaid_mappings_plan_title ON public.bepaid_product_mappings(bepaid_plan_title);
CREATE INDEX idx_bepaid_mappings_product_id ON public.bepaid_product_mappings(product_id);