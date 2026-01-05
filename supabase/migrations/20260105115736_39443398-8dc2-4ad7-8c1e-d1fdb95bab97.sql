-- Fix RLS for tariff_offers to allow admin access
DROP POLICY IF EXISTS "Public read access for active offers" ON public.tariff_offers;
DROP POLICY IF EXISTS "Super admins can manage offers" ON public.tariff_offers;

-- Create proper policies
CREATE POLICY "Admins can manage offers"
ON public.tariff_offers FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Public can read active offers"
ON public.tariff_offers FOR SELECT
USING (is_active = true);

-- Ensure products_v2 new columns are accessible
-- Add default values for existing rows
UPDATE public.products_v2 
SET status = 'active', currency = 'BYN' 
WHERE status IS NULL OR currency IS NULL;