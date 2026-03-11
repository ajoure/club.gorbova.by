-- Add safe trigger-based default: trigger will override this immediately
-- This is needed so Supabase generated types allow inserts without explicit public_id
ALTER TABLE tariffs ALTER COLUMN public_id SET DEFAULT '';
