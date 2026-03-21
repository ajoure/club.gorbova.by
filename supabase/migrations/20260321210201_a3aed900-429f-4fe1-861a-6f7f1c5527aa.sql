
INSERT INTO fields_registry (entity_type, key, label, data_type, display_order)
VALUES
  -- Common fields
  ('legal_details', 'legal_details.bank_account', 'Расчётный счёт (IBAN)', 'text', 1),
  ('legal_details', 'legal_details.bank_name', 'Банк', 'text', 2),
  ('legal_details', 'legal_details.bank_code', 'БИК / Код банка', 'text', 3),
  ('legal_details', 'legal_details.phone', 'Телефон', 'text', 4),
  ('legal_details', 'legal_details.email', 'Email', 'text', 5),
  -- Legal entity (leg_*)
  ('legal_details', 'legal_details.leg_unp', 'УНП (ЮЛ)', 'text', 10),
  ('legal_details', 'legal_details.leg_org_form', 'Форма собственности', 'text', 11),
  ('legal_details', 'legal_details.leg_name', 'Название организации', 'text', 12),
  ('legal_details', 'legal_details.leg_address', 'Юридический адрес (ЮЛ)', 'text', 13),
  ('legal_details', 'legal_details.leg_director_position', 'Должность руководителя', 'text', 14),
  ('legal_details', 'legal_details.leg_director_name', 'ФИО руководителя', 'text', 15),
  ('legal_details', 'legal_details.leg_acts_on_basis', 'Действует на основании (ЮЛ)', 'text', 16),
  -- Entrepreneur (ent_*)
  ('legal_details', 'legal_details.ent_unp', 'УНП (ИП)', 'text', 20),
  ('legal_details', 'legal_details.ent_name', 'Имя ИП', 'text', 21),
  ('legal_details', 'legal_details.ent_address', 'Адрес (ИП)', 'text', 22),
  ('legal_details', 'legal_details.ent_acts_on_basis', 'Действует на основании (ИП)', 'text', 23),
  -- Individual (ind_*)
  ('legal_details', 'legal_details.ind_full_name', 'ФИО', 'text', 30),
  ('legal_details', 'legal_details.ind_birth_date', 'Дата рождения', 'date', 31),
  ('legal_details', 'legal_details.ind_passport_series', 'Серия паспорта', 'text', 32),
  ('legal_details', 'legal_details.ind_passport_number', 'Номер паспорта', 'text', 33),
  ('legal_details', 'legal_details.ind_passport_issued_by', 'Кем выдан паспорт', 'text', 34),
  ('legal_details', 'legal_details.ind_passport_issued_date', 'Дата выдачи паспорта', 'date', 35),
  ('legal_details', 'legal_details.ind_passport_valid_until', 'Паспорт действителен до', 'date', 36),
  ('legal_details', 'legal_details.ind_personal_number', 'Личный номер', 'text', 37),
  ('legal_details', 'legal_details.ind_address_index', 'Индекс', 'text', 38),
  ('legal_details', 'legal_details.ind_address_region', 'Область', 'text', 39),
  ('legal_details', 'legal_details.ind_address_district', 'Район', 'text', 40),
  ('legal_details', 'legal_details.ind_address_city', 'Город', 'text', 41),
  ('legal_details', 'legal_details.ind_address_street', 'Улица', 'text', 42),
  ('legal_details', 'legal_details.ind_address_house', 'Дом', 'text', 43),
  ('legal_details', 'legal_details.ind_address_apartment', 'Квартира', 'text', 44)
ON CONFLICT (entity_type, key) DO NOTHING;
