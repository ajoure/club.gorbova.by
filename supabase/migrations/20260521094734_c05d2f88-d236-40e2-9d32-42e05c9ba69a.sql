INSERT INTO public.fields_registry (entity_type, key, label, data_type, public_id, description)
SELECT 'payment', 'payment.paid_at_long', 'Дата оплаты прописью', 'string', 'FLD-000371',
       'Дата оплаты в длинном формате с названием месяца, например "«21» мая 2026 года". Источник: payments_v2.paid_at. Не смешивать с payment.paid_at (FLD-000263, формат 21.05.2026).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.fields_registry WHERE public_id = 'FLD-000371' OR key = 'payment.paid_at_long'
);

INSERT INTO public.document_token_registry (token_key, ui_label, description, category, source_type, field_id, resolver_key, data_type, is_required, display_order, example_value)
SELECT
  'payment.paid_at_long',
  'Дата оплаты прописью',
  'Дата оплаты в длинном формате с названием месяца. Используйте отдельно от payment.paid_at (короткий формат 21.05.2026).',
  'payment',
  'system',
  fr.id,
  'payment.paid_at_long',
  'string',
  false,
  9998,
  '«21» мая 2026 года'
FROM public.fields_registry fr
WHERE fr.public_id = 'FLD-000371'
  AND NOT EXISTS (
    SELECT 1 FROM public.document_token_registry WHERE token_key = 'payment.paid_at_long'
  );