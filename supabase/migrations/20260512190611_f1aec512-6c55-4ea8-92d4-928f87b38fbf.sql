-- Global aliases: payer.* → customer.*, service.* → deal.service_*, order.* → deal.*
-- template_id/template_version_id = NULL → applied globally
INSERT INTO public.document_token_aliases (alias_token, canonical_token_key, template_id, template_version_id, notes, metadata)
VALUES
  ('{{payer.name}}',       'customer.name',         NULL, NULL, 'Global alias payer.* → customer.*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{payer.short_name}}', 'customer.short_name',   NULL, NULL, 'Global alias payer.* → customer.*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{payer.unp}}',        'customer.unp',          NULL, NULL, 'Global alias payer.* → customer.*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{payer.address}}',    'customer.address',      NULL, NULL, 'Global alias payer.* → customer.*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{payer.email}}',      'customer.email',        NULL, NULL, 'Global alias payer.* → customer.*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{payer.phone}}',      'customer.phone',        NULL, NULL, 'Global alias payer.* → customer.*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{payer.passport}}',   'customer.passport',     NULL, NULL, 'Global alias payer.* → customer.*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{service.name}}',       'deal.service_name',     NULL, NULL, 'Global alias service.* → deal.service_*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{service.quantity}}',   'deal.service_quantity', NULL, NULL, 'Global alias service.* → deal.service_*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{service.unit_price}}', 'deal.service_price',    NULL, NULL, 'Global alias service.* → deal.service_*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{service.amount}}',     'deal.service_amount',   NULL, NULL, 'Global alias service.* → deal.service_*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{order.number}}',   'deal.id',       NULL, NULL, 'Global alias order.* → deal.*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{order.amount}}',   'deal.amount',   NULL, NULL, 'Global alias order.* → deal.*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{order.currency}}', 'deal.currency', NULL, NULL, 'Global alias order.* → deal.*', '{"source":"seed_payer_service_order_aliases"}'::jsonb),
  ('{{order.paid_at}}',  'deal.paid_at',  NULL, NULL, 'Global alias order.* → deal.*', '{"source":"seed_payer_service_order_aliases"}'::jsonb)
ON CONFLICT (alias_token, COALESCE(template_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(template_version_id, '00000000-0000-0000-0000-000000000000'::uuid))
DO NOTHING;