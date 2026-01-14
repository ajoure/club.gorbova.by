-- STEP 2: Add 6 tariff-specific mappings for Gorbova Club
INSERT INTO bepaid_product_mappings
  (bepaid_plan_title, product_id, tariff_id, offer_id, auto_create_order, is_subscription, notes)
VALUES
  ('Gorbova Club - CHAT (Trial)', '11c9f1b8-0355-4753-bd74-40b42aa53616', '31f75673-a7ae-420a-b5ab-5906e34cbf84', '4f1163c9-db56-4d2e-8882-03419b6e458a', true, true, 'CHAT trial 1 BYN'),
  ('Gorbova Club - CHAT', '11c9f1b8-0355-4753-bd74-40b42aa53616', '31f75673-a7ae-420a-b5ab-5906e34cbf84', '6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e', true, true, 'CHAT full 100 BYN'),
  ('Gorbova Club - FULL (Trial)', '11c9f1b8-0355-4753-bd74-40b42aa53616', 'b276d8a5-8e5f-4876-9f99-36f818722d6c', '220f923b-c69d-4e86-a8a7-f715a5ca1fdc', true, true, 'FULL trial 1 BYN'),
  ('Gorbova Club - FULL', '11c9f1b8-0355-4753-bd74-40b42aa53616', 'b276d8a5-8e5f-4876-9f99-36f818722d6c', 'c5781abf-0376-4e1f-91dc-99773906ee77', true, true, 'FULL full 150 BYN'),
  ('Gorbova Club - BUSINESS (Trial)', '11c9f1b8-0355-4753-bd74-40b42aa53616', '7c748940-dcad-4c7c-a92e-76a2344622d3', '0703ab0a-9fa1-41e1-9e99-9411f9a23ab6', true, true, 'BUSINESS trial 1 BYN'),
  ('Gorbova Club - BUSINESS', '11c9f1b8-0355-4753-bd74-40b42aa53616', '7c748940-dcad-4c7c-a92e-76a2344622d3', 'bc0f7a90-df41-4a86-b2ea-2a1234d0d534', true, true, 'BUSINESS full 250 BYN')
ON CONFLICT (bepaid_plan_title) DO UPDATE SET
  tariff_id = EXCLUDED.tariff_id,
  offer_id = EXCLUDED.offer_id,
  notes = EXCLUDED.notes;

-- Deprecate old ambiguous mapping
UPDATE bepaid_product_mappings
SET auto_create_order = false,
    notes = 'DEPRECATED: ambiguous trial without tariff'
WHERE bepaid_plan_title = 'Gorbova Club (Trial)'