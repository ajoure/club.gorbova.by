-- Seed automation rule for offer T-000074 (Хочу премиальные условия / Индивидуальный договор)
-- Creates a "Прозвон менеджером" call task with 24h due and 1h reminder
INSERT INTO public.crm_task_automation_rules (
  offer_id,
  task_type_id,
  title_template,
  description_template,
  assignee_strategy,
  assignee_user_id,
  due_offset_minutes,
  reminder_offset_minutes,
  is_active,
  metadata
)
SELECT
  '7b939741-e941-4dbc-b820-803cd7f307bc'::uuid,
  (SELECT id FROM public.crm_task_types WHERE key = 'call' LIMIT 1),
  'Прозвон менеджером — индивидуальный договор',
  'Связаться с клиентом по заявке на индивидуальный договор (оффер T-000074). Обсудить условия и согласовать индивидуальный график.',
  'fixed_user',
  '05cd3754-d589-4d90-97d1-89ba2bee610b'::uuid,
  1440,
  60,
  true,
  jsonb_build_object('seed', 'T-000074', 'source', 'roadmap_fc0f938b')
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_task_automation_rules
  WHERE offer_id = '7b939741-e941-4dbc-b820-803cd7f307bc'::uuid
    AND (metadata->>'seed') = 'T-000074'
);

-- Enable feature flag so create_preorder_deal_atomic hook actually fires automation
UPDATE public.app_settings
   SET value = to_jsonb(true)
 WHERE key = 'feature_crm_tasks_enabled';