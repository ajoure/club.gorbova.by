-- Seed structured address sub-fields for ЮЛ (leg_) and ИП (ent_)
-- Idempotent: ON CONFLICT DO NOTHING
INSERT INTO fields_registry (entity_type, key, label, data_type, display_order)
VALUES
  -- ЮЛ structured address sub-fields (display_order 130-139)
  ('legal_details', 'legal_details.leg_address_street',      'Улица (ЮЛ)',       'text', 130),
  ('legal_details', 'legal_details.leg_address_house',        'Дом (ЮЛ)',         'text', 131),
  ('legal_details', 'legal_details.leg_address_building',     'Корпус (ЮЛ)',      'text', 132),
  ('legal_details', 'legal_details.leg_address_apartment',    'Кв./Офис (ЮЛ)',    'text', 133),
  ('legal_details', 'legal_details.leg_address_city',         'Город (ЮЛ)',        'text', 134),
  ('legal_details', 'legal_details.leg_address_region',       'Область (ЮЛ)',      'text', 135),
  ('legal_details', 'legal_details.leg_address_postal_code',  'Индекс (ЮЛ)',       'text', 136),
  ('legal_details', 'legal_details.leg_address_country',      'Страна (ЮЛ)',       'text', 137),
  -- ИП structured address sub-fields (display_order 230-237)
  ('legal_details', 'legal_details.ent_address_street',      'Улица (ИП)',        'text', 230),
  ('legal_details', 'legal_details.ent_address_house',        'Дом (ИП)',          'text', 231),
  ('legal_details', 'legal_details.ent_address_building',     'Корпус (ИП)',       'text', 232),
  ('legal_details', 'legal_details.ent_address_apartment',    'Кв./Офис (ИП)',     'text', 233),
  ('legal_details', 'legal_details.ent_address_city',         'Город (ИП)',         'text', 234),
  ('legal_details', 'legal_details.ent_address_region',       'Область (ИП)',       'text', 235),
  ('legal_details', 'legal_details.ent_address_postal_code',  'Индекс (ИП)',        'text', 236),
  ('legal_details', 'legal_details.ent_address_country',      'Страна (ИП)',        'text', 237)
ON CONFLICT (entity_type, key) DO NOTHING;