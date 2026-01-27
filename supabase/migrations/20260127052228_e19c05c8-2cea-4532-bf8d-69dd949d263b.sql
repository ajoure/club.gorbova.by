-- Fix: Enable RLS on payment_reconcile_queue_archive
-- This table contains sensitive customer payment data (emails, phones, card details)
-- and must be protected from public access

-- Enable Row Level Security
ALTER TABLE public.payment_reconcile_queue_archive ENABLE ROW LEVEL SECURITY;

-- Only admins can read archived payment data
CREATE POLICY "Admins can view payment archive"
ON public.payment_reconcile_queue_archive
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Only service role can manage archive records (for automated archival)
CREATE POLICY "Service role can manage payment archive"
ON public.payment_reconcile_queue_archive
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Fix: Ensure bepaid_statement_rows has proper admin-only policies
-- Drop any overly permissive policies first, then recreate with proper restrictions

-- Check if table has RLS enabled (it should, but ensure it does)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'bepaid_statement_rows'
    AND n.nspname = 'public'
    AND c.relrowsecurity = true
  ) THEN
    EXECUTE 'ALTER TABLE public.bepaid_statement_rows ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- Drop existing policies on bepaid_statement_rows to replace with secure versions
DROP POLICY IF EXISTS "Allow all access to bepaid_statement_rows" ON public.bepaid_statement_rows;
DROP POLICY IF EXISTS "Anyone can read bepaid_statement_rows" ON public.bepaid_statement_rows;
DROP POLICY IF EXISTS "Public read access" ON public.bepaid_statement_rows;
DROP POLICY IF EXISTS "Admins can view bePaid statements" ON public.bepaid_statement_rows;
DROP POLICY IF EXISTS "Service role can manage bePaid statements" ON public.bepaid_statement_rows;

-- Create secure admin-only policy for SELECT
CREATE POLICY "Admins can view bePaid statements"
ON public.bepaid_statement_rows
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Service role can manage records (for sync operations)
CREATE POLICY "Service role can manage bePaid statements"
ON public.bepaid_statement_rows
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);