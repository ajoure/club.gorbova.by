-- Add origin and import_ref columns to payments_v2
-- origin: 'bepaid' (webhook), 'import' (CSV archive), 'manual_adjustment'
-- import_ref: reference to source (queue_id, etc.)

ALTER TABLE payments_v2 
ADD COLUMN IF NOT EXISTS origin text DEFAULT 'bepaid';

ALTER TABLE payments_v2 
ADD COLUMN IF NOT EXISTS import_ref text;

COMMENT ON COLUMN payments_v2.origin IS 'Источник записи: bepaid (webhook), import (CSV), manual_adjustment';
COMMENT ON COLUMN payments_v2.import_ref IS 'Ссылка на источник импорта (queue_id, csv_file, etc)';

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_payments_v2_origin ON payments_v2(origin);

-- Step 1: Mark imported records (materialized from queue)
UPDATE payments_v2
SET origin = 'import',
    import_ref = meta->>'queue_id'
WHERE provider = 'bepaid'
  AND meta->>'materialized_from_queue' = 'true'
  AND origin IS DISTINCT FROM 'import';

-- Step 2: Mark old payments (before 2026) as import
UPDATE payments_v2
SET origin = 'import'
WHERE provider = 'bepaid'
  AND paid_at < '2026-01-01'
  AND origin IS DISTINCT FROM 'import';

-- Step 3: Ensure all remaining bepaid records have origin='bepaid'
UPDATE payments_v2
SET origin = 'bepaid'
WHERE provider = 'bepaid'
  AND origin IS NULL;