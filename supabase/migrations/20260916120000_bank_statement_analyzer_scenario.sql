-- A separately assignable AI tool. Product/tariff grants are intentionally
-- created through the existing admin "Access rules" UI, never hardcoded here.
INSERT INTO public.app_sections (
  code, label, icon, route, is_public, sort_order, is_active
)
VALUES (
  'ai_bank_statement_analysis',
  'AI: Анализ выписки',
  'Landmark',
  '/ai?sub=chat&scenario=bank_statement_analysis',
  false,
  46,
  true
)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  route = EXCLUDED.route,
  is_public = EXCLUDED.is_public,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

INSERT INTO public.ai_user_prompts (
  code, title, description, prompt_text, type, category, icon, input_hint,
  is_active, is_archived, sort_order, is_visible_in_chat, launcher_title,
  launcher_description, launcher_order
)
VALUES (
  'bank_statement_analysis',
  'Анализ выписки',
  'Сверка УНП и названия получателя платежа с реестром МНС.',
  'SYSTEM: dedicated bank statement analyzer; no generic chat routing.',
  'file_analysis',
  'Проверки',
  'Landmark',
  'Загрузите банковскую выписку. Сервис проверит, совпадает ли название получателя с официальным названием по УНП.',
  true,
  false,
  31,
  true,
  'Анализ выписки',
  'ИИ извлечёт платежи и сверит УНП получателя с официальным названием МНС.',
  31
)
ON CONFLICT (code) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  prompt_text = EXCLUDED.prompt_text,
  type = EXCLUDED.type,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  input_hint = EXCLUDED.input_hint,
  is_active = EXCLUDED.is_active,
  is_archived = EXCLUDED.is_archived,
  sort_order = EXCLUDED.sort_order,
  is_visible_in_chat = EXCLUDED.is_visible_in_chat,
  launcher_title = EXCLUDED.launcher_title,
  launcher_description = EXCLUDED.launcher_description,
  launcher_order = EXCLUDED.launcher_order;
