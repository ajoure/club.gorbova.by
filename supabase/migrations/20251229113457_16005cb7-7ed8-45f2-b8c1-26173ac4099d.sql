-- Add duplicate tracking fields to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS duplicate_flag text DEFAULT 'none' CHECK (duplicate_flag IN ('none', 'duplicate_by_phone')),
ADD COLUMN IF NOT EXISTS duplicate_group_id uuid,
ADD COLUMN IF NOT EXISTS primary_in_group boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS merged_to_profile_id uuid,
ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;

-- Create duplicate_cases table for managing duplicate groups
CREATE TABLE IF NOT EXISTS public.duplicate_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'merged', 'ignored')),
  profile_count integer DEFAULT 0,
  master_profile_id uuid REFERENCES public.profiles(id),
  resolved_by uuid,
  resolved_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create client_duplicates table to link profiles to cases
CREATE TABLE IF NOT EXISTS public.client_duplicates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.duplicate_cases(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_master boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(case_id, profile_id)
);

-- Create merge_history table for audit trail
CREATE TABLE IF NOT EXISTS public.merge_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES public.duplicate_cases(id),
  master_profile_id uuid REFERENCES public.profiles(id),
  merged_profile_id uuid REFERENCES public.profiles(id),
  merged_by uuid,
  merged_data jsonb,
  created_at timestamp with time zone DEFAULT now()
);

-- Add possible_duplicate flag to orders
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS possible_duplicate boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS duplicate_reason text;

-- Enable RLS on new tables
ALTER TABLE public.duplicate_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_duplicates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merge_history ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for duplicate_cases (admin only)
CREATE POLICY "Admins can view duplicate cases"
ON public.duplicate_cases
FOR SELECT
USING (has_permission(auth.uid(), 'users.view'));

CREATE POLICY "Admins can manage duplicate cases"
ON public.duplicate_cases
FOR ALL
USING (has_permission(auth.uid(), 'users.update'))
WITH CHECK (has_permission(auth.uid(), 'users.update'));

-- Create RLS policies for client_duplicates (admin only)
CREATE POLICY "Admins can view client duplicates"
ON public.client_duplicates
FOR SELECT
USING (has_permission(auth.uid(), 'users.view'));

CREATE POLICY "Admins can manage client duplicates"
ON public.client_duplicates
FOR ALL
USING (has_permission(auth.uid(), 'users.update'))
WITH CHECK (has_permission(auth.uid(), 'users.update'));

-- Create RLS policies for merge_history (admin only)
CREATE POLICY "Admins can view merge history"
ON public.merge_history
FOR SELECT
USING (has_permission(auth.uid(), 'users.view'));

CREATE POLICY "Admins can insert merge history"
ON public.merge_history
FOR INSERT
WITH CHECK (has_permission(auth.uid(), 'users.update'));

-- Create index for faster duplicate detection by phone
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_duplicate_flag ON public.profiles(duplicate_flag) WHERE duplicate_flag != 'none';
CREATE INDEX IF NOT EXISTS idx_duplicate_cases_status ON public.duplicate_cases(status);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_duplicate_cases_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for duplicate_cases
DROP TRIGGER IF EXISTS update_duplicate_cases_updated_at ON public.duplicate_cases;
CREATE TRIGGER update_duplicate_cases_updated_at
BEFORE UPDATE ON public.duplicate_cases
FOR EACH ROW
EXECUTE FUNCTION public.update_duplicate_cases_updated_at();