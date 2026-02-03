-- Add product_id to training_lessons for lesson monetization
ALTER TABLE training_lessons 
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products_v2(id);

CREATE INDEX IF NOT EXISTS idx_training_lessons_product_id 
  ON training_lessons(product_id);

COMMENT ON COLUMN training_lessons.product_id IS 
  'Product for lesson monetization (if sold separately)';

-- Create lesson_price_rules table for tariff-specific pricing
CREATE TABLE IF NOT EXISTS lesson_price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES training_lessons(id) ON DELETE CASCADE,
  tariff_id uuid REFERENCES tariffs(id) ON DELETE CASCADE,
  price numeric NOT NULL,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  
  CONSTRAINT unique_lesson_tariff UNIQUE (lesson_id, tariff_id)
);

COMMENT ON TABLE lesson_price_rules IS 
  'Pricing rules for lessons: different prices for different tariffs';

-- Enable RLS
ALTER TABLE lesson_price_rules ENABLE ROW LEVEL SECURITY;

-- Admin manage policy
CREATE POLICY "Admin manage lesson price rules"
ON lesson_price_rules FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles_v2 ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid() 
    AND r.code IN ('admin', 'super_admin')
  )
);

-- Users can view lesson price rules (needed for purchase UI)
CREATE POLICY "Users can view lesson price rules"
ON lesson_price_rules FOR SELECT TO authenticated
USING (true);