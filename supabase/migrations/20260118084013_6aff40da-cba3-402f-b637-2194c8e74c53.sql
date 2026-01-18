-- Add content field to news_content for full article text
ALTER TABLE public.news_content 
ADD COLUMN IF NOT EXISTS content TEXT;

COMMENT ON COLUMN public.news_content.content IS 'Full article text/content for displaying in detail view';