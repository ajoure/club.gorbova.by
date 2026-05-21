INSERT INTO public.fields_registry (entity_type, key, label, data_type, public_id, description)
SELECT 'payment', 'payment.amount_words', 'Сумма платежа прописью', 'string', 'FLD-000370',
       'Сумма платежа прописью в формате "100 (сто) рублей, 56 копеек". Источник: payments_v2.amount + payments_v2.currency. Не смешивать с payment.amount (число) и payment.currency (код валюты).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.fields_registry WHERE public_id = 'FLD-000370' OR key = 'payment.amount_words'
);

INSERT INTO public.document_token_registry (token_key, ui_label, description, category, source_type, field_id, resolver_key, data_type, is_required, display_order, example_value)
SELECT
  'payment.amount_words',
  'Сумма платежа прописью',
  'Сумма платежа прописью с учётом валюты. Используйте отдельно от payment.amount и payment.currency.',
  'payment',
  'system',
  fr.id,
  'payment.amount_words',
  'string',
  false,
  9999,
  '100 (сто) рублей, 56 копеек'
FROM public.fields_registry fr
WHERE fr.public_id = 'FLD-000370'
  AND NOT EXISTS (
    SELECT 1 FROM public.document_token_registry WHERE token_key = 'payment.amount_words'
  );