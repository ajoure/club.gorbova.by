INSERT INTO public.fields_registry (public_id, entity_type, key, label, data_type, options, description, display_order)
VALUES
  ('FLD-000268', 'system', 'system.tomorrow',    'Система: завтра',          'string', '{}'::jsonb, 'Завтрашняя календарная дата (Europe/Minsk), dd.MM.yyyy', 268),
  ('FLD-000269', 'system', 'system.yesterday',   'Система: вчера',           'string', '{}'::jsonb, 'Вчерашняя календарная дата (Europe/Minsk), dd.MM.yyyy', 269),
  ('FLD-000270', 'system', 'system.month_name',  'Система: месяц (название)','string', '{}'::jsonb, 'Месяц по-русски: январь..декабрь',                       270),
  ('FLD-000271', 'system', 'system.day',         'Система: день месяца',     'string', '{}'::jsonb, 'Текущий день месяца (01-31)',                            271),
  ('FLD-000272', 'system', 'system.weekday',     'Система: день недели',     'string', '{}'::jsonb, 'День недели по-русски (понедельник..воскресенье)',       272)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.audit_logs (actor_type, actor_label, action, meta)
VALUES (
  'system',
  'migration',
  'fields_registry.seed_system_datetime_tokens',
  jsonb_build_object(
    'entity_type', 'fields_registry',
    'seeded_public_ids', ARRAY['FLD-000268','FLD-000269','FLD-000270','FLD-000271','FLD-000272'],
    'seeded_keys', ARRAY['system.tomorrow','system.yesterday','system.month_name','system.day','system.weekday'],
    'reason', 'datetime_system_tokens_phase',
    'idempotent', true,
    'note', 'pre-existing system tokens NOT touched (system.today/today_long/today_ru/now/year/month)'
  )
);