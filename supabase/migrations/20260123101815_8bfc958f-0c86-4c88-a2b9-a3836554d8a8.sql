-- PATCH 14.3: Изменить FK product_club_mappings на products_v2 и добавить маппинг

-- 1. Изменить FK product_club_mappings.product_id с products на products_v2
ALTER TABLE product_club_mappings 
DROP CONSTRAINT IF EXISTS product_club_mappings_product_id_fkey;

ALTER TABLE product_club_mappings
ADD CONSTRAINT product_club_mappings_product_id_fkey 
FOREIGN KEY (product_id) REFERENCES products_v2(id) ON DELETE CASCADE;

-- 2. Добавить маппинг product→club для Gorbova Club
INSERT INTO product_club_mappings (product_id, club_id, duration_days, is_active)
VALUES (
  '11c9f1b8-0355-4753-bd74-40b42aa53616',  -- Gorbova Club product
  'fa547c41-3a84-4c4f-904a-427332a0506e',  -- Gorbova Club telegram club
  30,
  true
)
ON CONFLICT (product_id, club_id) DO NOTHING;