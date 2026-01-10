-- Extend email_accounts with IMAP settings
ALTER TABLE public.email_accounts
ADD COLUMN IF NOT EXISTS imap_host TEXT,
ADD COLUMN IF NOT EXISTS imap_port INTEGER DEFAULT 993,
ADD COLUMN IF NOT EXISTS imap_encryption TEXT DEFAULT 'SSL',
ADD COLUMN IF NOT EXISTS imap_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_fetched_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_fetched_uid TEXT;

-- Create email_inbox table for incoming emails
CREATE TABLE IF NOT EXISTS public.email_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account_id UUID REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  message_uid TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  received_at TIMESTAMP WITH TIME ZONE,
  is_read BOOLEAN DEFAULT false,
  is_starred BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  folder TEXT DEFAULT 'INBOX',
  attachments JSONB DEFAULT '[]',
  headers JSONB DEFAULT '{}',
  linked_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(email_account_id, message_uid)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_email_inbox_account ON public.email_inbox(email_account_id);
CREATE INDEX IF NOT EXISTS idx_email_inbox_from ON public.email_inbox(from_email);
CREATE INDEX IF NOT EXISTS idx_email_inbox_received ON public.email_inbox(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_inbox_is_read ON public.email_inbox(is_read);
CREATE INDEX IF NOT EXISTS idx_email_inbox_linked_profile ON public.email_inbox(linked_profile_id);

-- Enable RLS
ALTER TABLE public.email_inbox ENABLE ROW LEVEL SECURITY;

-- RLS policies for email_inbox (admin only)
CREATE POLICY "Admins can view all emails"
ON public.email_inbox
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert emails"
ON public.email_inbox
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update emails"
ON public.email_inbox
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete emails"
ON public.email_inbox
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_email_inbox_updated_at
BEFORE UPDATE ON public.email_inbox
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();