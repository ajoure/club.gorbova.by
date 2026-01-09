-- Add signature_url to executors table
ALTER TABLE public.executors ADD COLUMN IF NOT EXISTS signature_url TEXT;

-- Create document_templates table for storing DOCX templates
CREATE TABLE public.document_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  document_type TEXT NOT NULL DEFAULT 'invoice_act', -- invoice_act, contract, act
  template_path TEXT NOT NULL, -- path in storage bucket
  placeholders JSONB DEFAULT '[]'::jsonb, -- list of available placeholders
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

-- Only admins can manage templates
CREATE POLICY "Admins can view document templates" 
ON public.document_templates 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can create document templates" 
ON public.document_templates 
FOR INSERT 
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update document templates" 
ON public.document_templates 
FOR UPDATE 
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete document templates" 
ON public.document_templates 
FOR DELETE 
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Create junction table for product-template mapping
CREATE TABLE public.product_document_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.document_templates(id) ON DELETE CASCADE,
  auto_generate BOOLEAN DEFAULT true, -- auto generate after purchase
  auto_send_email BOOLEAN DEFAULT false, -- auto send to customer email
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(product_id, template_id)
);

-- Enable RLS
ALTER TABLE public.product_document_templates ENABLE ROW LEVEL SECURITY;

-- Only admins can manage mappings
CREATE POLICY "Admins can view product document templates" 
ON public.product_document_templates 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can create product document templates" 
ON public.product_document_templates 
FOR INSERT 
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update product document templates" 
ON public.product_document_templates 
FOR UPDATE 
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete product document templates" 
ON public.product_document_templates 
FOR DELETE 
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Create updated_at triggers
CREATE TRIGGER update_document_templates_updated_at
BEFORE UPDATE ON public.document_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_product_document_templates_updated_at
BEFORE UPDATE ON public.product_document_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create public bucket for signatures (they need to be accessible in PDF generation)
INSERT INTO storage.buckets (id, name, public)
VALUES ('signatures', 'signatures', true)
ON CONFLICT (id) DO NOTHING;

-- RLS for signatures bucket - only admins can upload, everyone can view
CREATE POLICY "Anyone can view signatures"
ON storage.objects FOR SELECT
USING (bucket_id = 'signatures');

CREATE POLICY "Admins can upload signatures"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'signatures' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update signatures"
ON storage.objects FOR UPDATE
USING (bucket_id = 'signatures' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete signatures"
ON storage.objects FOR DELETE
USING (bucket_id = 'signatures' AND public.has_role(auth.uid(), 'admin'::public.app_role));