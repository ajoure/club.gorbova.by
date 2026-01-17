-- Create table for storing imported channel posts history
CREATE TABLE public.channel_posts_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL,
  telegram_message_id BIGINT,
  text TEXT,
  date TIMESTAMPTZ,
  from_name TEXT,
  views INTEGER DEFAULT 0,
  forwards INTEGER DEFAULT 0,
  media_type TEXT,
  raw_data JSONB,
  imported_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX idx_channel_posts_archive_channel_id ON public.channel_posts_archive(channel_id);
CREATE INDEX idx_channel_posts_archive_date ON public.channel_posts_archive(date DESC);
CREATE UNIQUE INDEX idx_channel_posts_archive_unique ON public.channel_posts_archive(channel_id, telegram_message_id);

-- Enable RLS
ALTER TABLE public.channel_posts_archive ENABLE ROW LEVEL SECURITY;

-- Allow admins to manage archive using user_roles table
CREATE POLICY "Admins can manage channel posts archive"
ON public.channel_posts_archive
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
  )
);

-- Add comment
COMMENT ON TABLE public.channel_posts_archive IS 'Stores imported Telegram channel posts history for style learning';