-- Create table for MNS response documents history
CREATE TABLE public.mns_response_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'unknown',
  original_request TEXT NOT NULL,
  response_text TEXT NOT NULL,
  tax_authority TEXT,
  request_number TEXT,
  request_date DATE,
  organization_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.mns_response_documents ENABLE ROW LEVEL SECURITY;

-- Users can view their own documents
CREATE POLICY "Users can view their own MNS documents"
ON public.mns_response_documents
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own documents
CREATE POLICY "Users can create their own MNS documents"
ON public.mns_response_documents
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can delete their own documents
CREATE POLICY "Users can delete their own MNS documents"
ON public.mns_response_documents
FOR DELETE
USING (auth.uid() = user_id);

-- Admins and super_admins can view all documents
CREATE POLICY "Admins can view all MNS documents"
ON public.mns_response_documents
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles_v2 ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
    AND r.code IN ('admin', 'super_admin')
  )
);

-- Create trigger for updated_at
CREATE TRIGGER update_mns_response_documents_updated_at
BEFORE UPDATE ON public.mns_response_documents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for faster queries
CREATE INDEX idx_mns_response_documents_user_id ON public.mns_response_documents(user_id);
CREATE INDEX idx_mns_response_documents_created_at ON public.mns_response_documents(created_at DESC);