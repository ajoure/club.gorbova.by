-- The service-performance term is measured in calendar days.  Keep the
-- payment term wording untouched: it is a separate contractual condition.
UPDATE public.document_token_registry
SET ui_label = 'Срок оказания услуг (дней)'
WHERE token_key = 'document.execution_days'
  AND ui_label IS DISTINCT FROM 'Срок оказания услуг (дней)';
