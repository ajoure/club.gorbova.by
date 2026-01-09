-- Add pinned and favorite columns to track chat preferences
ALTER TABLE public.telegram_messages 
ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS is_favorite boolean DEFAULT false;

-- Create a chat_preferences table for per-user-dialog preferences
CREATE TABLE IF NOT EXISTS public.chat_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  contact_user_id uuid NOT NULL,
  is_pinned boolean DEFAULT false,
  is_favorite boolean DEFAULT false,
  is_read boolean DEFAULT true,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(admin_user_id, contact_user_id)
);

-- Enable RLS
ALTER TABLE public.chat_preferences ENABLE ROW LEVEL SECURITY;

-- Only admins can manage their own preferences
CREATE POLICY "Admins can manage their own chat preferences"
ON public.chat_preferences
FOR ALL
TO authenticated
USING (admin_user_id = auth.uid())
WITH CHECK (admin_user_id = auth.uid());

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_chat_preferences_admin ON public.chat_preferences(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_preferences_contact ON public.chat_preferences(contact_user_id);