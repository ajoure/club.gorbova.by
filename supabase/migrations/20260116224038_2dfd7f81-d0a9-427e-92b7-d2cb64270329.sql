-- Create news_content table for managing news/digest content
CREATE TABLE public.news_content (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  country TEXT NOT NULL CHECK (country IN ('by', 'ru')),
  category TEXT NOT NULL CHECK (category IN ('digest', 'comments', 'urgent')),
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.news_content ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can view published news
CREATE POLICY "Anyone can view published news"
ON public.news_content
FOR SELECT
USING (is_published = true);

-- Policy: Admins and editors can view all news (using user_roles.role enum)
CREATE POLICY "Admins can view all news"
ON public.news_content
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role::text IN ('super_admin', 'admin', 'editor')
  )
);

-- Policy: Admins and editors can insert news
CREATE POLICY "Admins can insert news"
ON public.news_content
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role::text IN ('super_admin', 'admin', 'editor')
  )
);

-- Policy: Admins and editors can update news
CREATE POLICY "Admins can update news"
ON public.news_content
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role::text IN ('super_admin', 'admin', 'editor')
  )
);

-- Policy: Admins and editors can delete news
CREATE POLICY "Admins can delete news"
ON public.news_content
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role::text IN ('super_admin', 'admin', 'editor')
  )
);

-- Create index for common queries
CREATE INDEX idx_news_content_country_category ON public.news_content(country, category);
CREATE INDEX idx_news_content_published ON public.news_content(is_published) WHERE is_published = true;

-- Add trigger for updated_at
CREATE TRIGGER update_news_content_updated_at
BEFORE UPDATE ON public.news_content
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();