-- PATCH-1: Добавить meta jsonb в course_preregistrations
ALTER TABLE course_preregistrations
ADD COLUMN IF NOT EXISTS meta jsonb;

-- Backfill NULL → '{}'
UPDATE course_preregistrations
SET meta = '{}'::jsonb
WHERE meta IS NULL;

-- Индекс по meta.billing.billing_status (правильный путь)
CREATE INDEX IF NOT EXISTS idx_prereg_billing_status
ON course_preregistrations ((meta->'billing'->>'billing_status'));

-- Audit log
INSERT INTO audit_logs (action, actor_type, actor_user_id, actor_label, meta)
VALUES (
  'schema.course_preregistrations_meta_added',
  'system',
  NULL,
  'patch-buh_business-schema',
  '{"change":"added meta jsonb column; index on meta.billing.billing_status"}'::jsonb
);