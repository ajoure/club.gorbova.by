-- Add club membership tracking columns to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS was_club_member boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS club_exit_at timestamptz,
ADD COLUMN IF NOT EXISTS club_exit_reason text;