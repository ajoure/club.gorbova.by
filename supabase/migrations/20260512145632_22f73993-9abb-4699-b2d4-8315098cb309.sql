-- Sprint D — register canonical .full address aliases.
-- Эти токены равны customer.address / executor.address и нужны как
-- семантически явный плейсхолдер для шаблонов (одной подстановкой
-- вставить полный адрес).
INSERT INTO public.document_token_registry
  (token_key, ui_label, description, category, source_type, resolver_key, data_type, is_required, display_order)
VALUES
  ('customer.address.full', 'Заказчик: адрес (полный)',
   'Полный адрес заказчика (синоним customer.address). Собирается в порядке: улица → дом → корпус → пом./кв. → нас.пункт → индекс → страна.',
   'customer', 'system', 'customer.address.full', 'string', false, 1001),
  ('executor.address.full', 'Исполнитель: адрес (полный)',
   'Полный адрес исполнителя (синоним executor.address). Собирается в порядке: улица → дом → корпус → пом. → нас.пункт → индекс → страна.',
   'executor', 'system', 'executor.address.full', 'string', false, 1002)
ON CONFLICT (token_key) DO UPDATE SET
  archived_at = NULL,
  resolver_key = EXCLUDED.resolver_key,
  description = EXCLUDED.description,
  ui_label = EXCLUDED.ui_label;