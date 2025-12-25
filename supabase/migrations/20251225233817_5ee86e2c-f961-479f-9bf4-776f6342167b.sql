-- Create content table
CREATE TABLE public.content (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'article',
  content TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  access_level TEXT NOT NULL DEFAULT 'free',
  author_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.content ENABLE ROW LEVEL SECURITY;

-- Content can be viewed by anyone with content.view permission or by author
CREATE POLICY "Content view permission"
ON public.content
FOR SELECT
USING (
  has_permission(auth.uid(), 'content.view') OR author_id = auth.uid()
);

-- Content can be created by users with content.edit permission
CREATE POLICY "Content create permission"
ON public.content
FOR INSERT
WITH CHECK (has_permission(auth.uid(), 'content.edit'));

-- Content can be updated by users with content.edit permission
CREATE POLICY "Content update permission"
ON public.content
FOR UPDATE
USING (has_permission(auth.uid(), 'content.edit'));

-- Content can be deleted by users with content.edit permission
CREATE POLICY "Content delete permission"
ON public.content
FOR DELETE
USING (has_permission(auth.uid(), 'content.edit'));

-- Trigger for updated_at
CREATE TRIGGER update_content_updated_at
BEFORE UPDATE ON public.content
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for common queries
CREATE INDEX idx_content_type ON public.content(type);
CREATE INDEX idx_content_status ON public.content(status);
CREATE INDEX idx_content_access_level ON public.content(access_level);