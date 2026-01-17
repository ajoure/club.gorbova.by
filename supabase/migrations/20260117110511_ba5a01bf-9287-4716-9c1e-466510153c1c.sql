-- Create scrape logs table for tracking background parsing results
CREATE TABLE public.scrape_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  sources_total INTEGER DEFAULT 0,
  sources_success INTEGER DEFAULT 0,
  sources_failed INTEGER DEFAULT 0,
  news_found INTEGER DEFAULT 0,
  news_saved INTEGER DEFAULT 0,
  news_duplicates INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  triggered_by TEXT DEFAULT 'manual',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scrape_logs ENABLE ROW LEVEL SECURITY;

-- Admin can view all logs
CREATE POLICY "Admins can view scrape logs"
  ON public.scrape_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Index for quick lookups
CREATE INDEX idx_scrape_logs_status ON public.scrape_logs(status);
CREATE INDEX idx_scrape_logs_started_at ON public.scrape_logs(started_at DESC);

-- Add last_error_code column to news_sources for detailed diagnostics
ALTER TABLE public.news_sources 
ADD COLUMN IF NOT EXISTS last_error_code TEXT,
ADD COLUMN IF NOT EXISTS last_error_details JSONB;

-- Comment for clarity
COMMENT ON TABLE public.scrape_logs IS 'Logs for background news scraping runs';
COMMENT ON COLUMN public.news_sources.last_error_code IS 'HTTP error code or error type (403, 500, timeout, etc.)';
COMMENT ON COLUMN public.news_sources.last_error_details IS 'Detailed error info including message and timestamp';