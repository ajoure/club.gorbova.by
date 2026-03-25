-- Sprint 3: Add 2 new array tokens + link batches to corporate sessions

-- 1. board_candidates array token
INSERT INTO fields_registry (entity_type, key, label, data_type, display_order, public_id, options)
VALUES ('package', 'package.board_candidates', 'Кандидаты в совет директоров', 'array', 50, 'FLD-000101',
  '{"source_strategy":"loop","item_schema":[
    {"key":"full_name","type":"text","label":"ФИО кандидата","required":true},
    {"key":"info","type":"text","label":"Сведения о кандидате","required":false}
  ]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. commission_members array token
INSERT INTO fields_registry (entity_type, key, label, data_type, display_order, public_id, options)
VALUES ('package', 'package.commission_members', 'Члены ревизионной комиссии', 'array', 51, 'FLD-000102',
  '{"source_strategy":"loop","item_schema":[
    {"key":"full_name","type":"text","label":"ФИО члена комиссии","required":true},
    {"key":"info","type":"text","label":"Сведения","required":false}
  ]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3. Link batches to corporate sessions
ALTER TABLE public.ai_document_generation_batches
  ADD COLUMN IF NOT EXISTS corporate_draft_session_id uuid
  REFERENCES public.corporate_draft_sessions(id) ON DELETE SET NULL;