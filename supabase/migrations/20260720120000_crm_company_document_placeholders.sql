-- Companies Phase 8B: canonical document placeholders.
-- Registry-only addition: values are resolved from the canonical company
-- snapshot/live row by the document renderer. Existing templates and snapshots
-- remain unchanged; tokens are opt-in through the registry.

INSERT INTO public.document_token_registry
  (token_key, ui_label, description, category, source_type, resolver_key, is_required, display_order)
VALUES
  ('company.full_name',        'Компания: полное название',   'Полное юридическое название компании', 'company', 'system', 'company.full_name', false, 60),
  ('company.short_name',       'Компания: краткое название',  'Краткое название компании',             'company', 'system', 'company.short_name', false, 61),
  ('company.unp',              'Компания: УНП',               'Нормализованный УНП компании',          'company', 'system', 'company.unp', false, 62),
  ('company.legal_address',    'Компания: юридический адрес', 'Юридический адрес компании',             'company', 'system', 'company.legal_address', false, 63),
  ('company.director.name',    'Компания: директор',          'ФИО руководителя компании',              'company', 'system', 'company.director.name', false, 64),
  ('company.director.position','Компания: должность директора','Должность руководителя компании',       'company', 'system', 'company.director.position', false, 65),
  ('company.bank.account',     'Компания: расчётный счёт',    'Расчётный счёт компании',                'company', 'system', 'company.bank.account', false, 66),
  ('company.bank.name',        'Компания: банк',              'Название банка компании',                'company', 'system', 'company.bank.name', false, 67),
  ('company.public_id',        'Компания: публичный ID',      'Стабильный CRM ID компании',             'company', 'system', 'company.public_id', false, 68)
ON CONFLICT (token_key) DO NOTHING;
