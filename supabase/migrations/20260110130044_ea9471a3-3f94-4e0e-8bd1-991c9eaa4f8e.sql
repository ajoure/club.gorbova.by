-- Enable RLS if not already enabled
ALTER TABLE public.product_email_mappings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any and recreate them
DROP POLICY IF EXISTS "Admin can view product email mappings" ON public.product_email_mappings;
DROP POLICY IF EXISTS "Admin can insert product email mappings" ON public.product_email_mappings;
DROP POLICY IF EXISTS "Admin can update product email mappings" ON public.product_email_mappings;
DROP POLICY IF EXISTS "Admin can delete product email mappings" ON public.product_email_mappings;

-- RLS policies (admin only via role enum)
CREATE POLICY "Admin can view product email mappings" 
ON public.product_email_mappings 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'superadmin')
  )
);

CREATE POLICY "Admin can insert product email mappings" 
ON public.product_email_mappings 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'superadmin')
  )
);

CREATE POLICY "Admin can update product email mappings" 
ON public.product_email_mappings 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'superadmin')
  )
);

CREATE POLICY "Admin can delete product email mappings" 
ON public.product_email_mappings 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'superadmin')
  )
);

-- Create indexes if not exist
CREATE INDEX IF NOT EXISTS idx_product_email_mappings_product ON public.product_email_mappings(product_id);
CREATE INDEX IF NOT EXISTS idx_product_email_mappings_account ON public.product_email_mappings(email_account_id);