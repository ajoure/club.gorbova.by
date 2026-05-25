INSERT INTO public.app_sections
  (code, label, icon, route, is_public, sort_order, is_active, short_description, features_json, cta_label)
VALUES
  ('document_generation', 'Генерация документов', 'FileSignature',
   '/document-generation', false, 45, true,
   'Реквизиты ЮЛ/ИП и физлиц для генерации документов',
   '["Юрлица и ИП", "Физлица", "Подстановка в шаблоны документов"]'::jsonb,
   'Получить доступ')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      icon = EXCLUDED.icon,
      route = EXCLUDED.route,
      short_description = EXCLUDED.short_description,
      features_json = EXCLUDED.features_json,
      cta_label = EXCLUDED.cta_label,
      updated_at = now();