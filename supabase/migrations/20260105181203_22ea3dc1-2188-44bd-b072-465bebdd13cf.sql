-- Add chat_analytics_enabled to telegram_clubs
ALTER TABLE public.telegram_clubs 
ADD COLUMN IF NOT EXISTS chat_analytics_enabled boolean DEFAULT false;

-- Create table for storing chat messages
CREATE TABLE public.tg_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.telegram_clubs(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  message_ts timestamp with time zone NOT NULL,
  from_tg_user_id bigint NOT NULL,
  from_display_name text,
  text text,
  has_media boolean DEFAULT false,
  reply_to_message_id bigint,
  raw_payload jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(club_id, message_id)
);

-- Create index for efficient queries
CREATE INDEX idx_tg_chat_messages_club_date ON public.tg_chat_messages(club_id, message_ts DESC);
CREATE INDEX idx_tg_chat_messages_user ON public.tg_chat_messages(from_tg_user_id);

-- Create table for daily summaries
CREATE TABLE public.tg_daily_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.telegram_clubs(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  date date NOT NULL,
  summary_text text,
  key_topics jsonb DEFAULT '[]',
  support_issues jsonb DEFAULT '[]',
  action_items jsonb DEFAULT '[]',
  messages_count integer DEFAULT 0,
  unique_users_count integer DEFAULT 0,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  model_meta jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(club_id, date)
);

CREATE INDEX idx_tg_daily_summaries_club_date ON public.tg_daily_summaries(club_id, date DESC);

-- Create table for support signals
CREATE TABLE public.tg_support_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.telegram_clubs(id) ON DELETE CASCADE,
  date date NOT NULL,
  severity text DEFAULT 'low', -- low, medium, high
  category text, -- question, complaint, bug, suggestion
  excerpt text,
  tg_user_id bigint,
  tg_username text,
  message_id bigint,
  status text DEFAULT 'new', -- new, in_progress, done, ignored
  resolved_by uuid,
  resolved_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_tg_support_signals_club_status ON public.tg_support_signals(club_id, status);
CREATE INDEX idx_tg_support_signals_date ON public.tg_support_signals(date DESC);

-- Enable RLS
ALTER TABLE public.tg_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tg_daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tg_support_signals ENABLE ROW LEVEL SECURITY;

-- RLS Policies - only admins can access
CREATE POLICY "Admins can view chat messages" ON public.tg_chat_messages
  FOR SELECT USING (public.has_permission(auth.uid(), 'telegram.manage'));

CREATE POLICY "System can insert chat messages" ON public.tg_chat_messages
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can view daily summaries" ON public.tg_daily_summaries
  FOR SELECT USING (public.has_permission(auth.uid(), 'telegram.manage'));

CREATE POLICY "System can manage daily summaries" ON public.tg_daily_summaries
  FOR ALL USING (true);

CREATE POLICY "Admins can view support signals" ON public.tg_support_signals
  FOR SELECT USING (public.has_permission(auth.uid(), 'telegram.manage'));

CREATE POLICY "Admins can manage support signals" ON public.tg_support_signals
  FOR ALL USING (public.has_permission(auth.uid(), 'telegram.manage'));

-- Trigger for updated_at on support_signals
CREATE TRIGGER update_tg_support_signals_updated_at
  BEFORE UPDATE ON public.tg_support_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();