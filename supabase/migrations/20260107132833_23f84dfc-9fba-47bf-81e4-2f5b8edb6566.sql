-- Create privacy_policy_versions table
CREATE TABLE public.privacy_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  effective_date DATE NOT NULL,
  summary TEXT,
  is_current BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Insert initial version
INSERT INTO privacy_policy_versions (version, effective_date, summary, is_current) 
VALUES ('v2026-01-07', '2026-01-07', 'Первоначальная редакция политики конфиденциальности', true);

-- Enable RLS
ALTER TABLE privacy_policy_versions ENABLE ROW LEVEL SECURITY;

-- Everyone can read policy versions
CREATE POLICY "Anyone can read policy versions"
  ON privacy_policy_versions FOR SELECT
  TO authenticated, anon
  USING (true);

-- Create consent_logs table
CREATE TABLE public.consent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  email TEXT,
  consent_type TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT true,
  ip_address TEXT,
  user_agent TEXT,
  source TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE consent_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own consent logs
CREATE POLICY "Users can view own consent logs"
  ON consent_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can insert their own consent logs
CREATE POLICY "Users can insert own consent logs"
  ON consent_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Anonymous users can insert consent logs
CREATE POLICY "Anonymous can insert consent logs"
  ON consent_logs FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

-- Add consent fields to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS consent_version TEXT,
ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN DEFAULT false;