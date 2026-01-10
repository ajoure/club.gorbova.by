-- Add index for faster email-to-profile matching
CREATE INDEX IF NOT EXISTS idx_email_inbox_from_email ON public.email_inbox(from_email);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Create email threads table for grouping conversations
CREATE TABLE IF NOT EXISTS public.email_threads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE,
  subject TEXT,
  profile_id UUID REFERENCES public.profiles(id),
  last_message_at TIMESTAMPTZ DEFAULT now(),
  message_count INTEGER DEFAULT 1,
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;

-- Policies for email_threads (admin only)
CREATE POLICY "Admins can view email threads" ON public.email_threads
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert email threads" ON public.email_threads
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update email threads" ON public.email_threads
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

-- Add thread_id to email_inbox if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'email_inbox' AND column_name = 'thread_id') THEN
    ALTER TABLE public.email_inbox ADD COLUMN thread_id TEXT;
  END IF;
END $$;

-- Create function to auto-link emails to profiles
CREATE OR REPLACE FUNCTION public.auto_link_email_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile_id UUID;
BEGIN
  -- Try to find profile by from_email
  SELECT id INTO v_profile_id
  FROM public.profiles
  WHERE email = NEW.from_email
  LIMIT 1;
  
  IF v_profile_id IS NOT NULL THEN
    NEW.linked_profile_id := v_profile_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for auto-linking
DROP TRIGGER IF EXISTS trigger_auto_link_email ON public.email_inbox;
CREATE TRIGGER trigger_auto_link_email
  BEFORE INSERT ON public.email_inbox
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_email_to_profile();

-- Update existing emails without linked_profile_id
UPDATE public.email_inbox e
SET linked_profile_id = p.id
FROM public.profiles p
WHERE e.from_email = p.email
  AND e.linked_profile_id IS NULL;