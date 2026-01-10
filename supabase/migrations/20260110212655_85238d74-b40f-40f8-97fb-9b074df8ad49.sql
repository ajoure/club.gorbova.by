-- Extend lesson_blocks table for nested blocks and conditional visibility
ALTER TABLE lesson_blocks ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES lesson_blocks(id) ON DELETE CASCADE;
ALTER TABLE lesson_blocks ADD COLUMN IF NOT EXISTS visibility_rules JSONB DEFAULT '{}';

-- Index for nested blocks queries
CREATE INDEX IF NOT EXISTS idx_lesson_blocks_parent ON lesson_blocks(parent_id);

-- Note: block_type is already TEXT without constraints, so new types work automatically