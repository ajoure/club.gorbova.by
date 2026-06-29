-- ============================================================
-- CRM TASKS canonical schema (Step 2)
-- add-only; no changes to orders_v2/crm_pipelines/crm_activity_log/tariff_offers
-- ============================================================

-- 0. System workspace (singleton tenant placeholder)
INSERT INTO public.tenants (id, name, is_personal, owner_user_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  false,
  '05cd3754-d589-4d90-97d1-89ba2bee610b'
)
ON CONFLICT (id) DO NOTHING;

-- 0.1 public_id sequence row for tasks
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('crm_task', 'TASK', 0)
ON CONFLICT (entity_type) DO NOTHING;

-- =======================================
-- 1. crm_task_types
-- =======================================
CREATE TABLE IF NOT EXISTS public.crm_task_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  key text NOT NULL,
  label text NOT NULL,
  icon text,
  color text,
  default_due_offset_minutes integer,
  default_reminder_offset_minutes integer,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

GRANT SELECT, INSERT, UPDATE ON public.crm_task_types TO authenticated;
GRANT ALL ON public.crm_task_types TO service_role;
ALTER TABLE public.crm_task_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_task_types_staff_read ON public.crm_task_types
  FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'employee') OR public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY crm_task_types_admin_write ON public.crm_task_types
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY crm_task_types_admin_update ON public.crm_task_types
  FOR UPDATE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE TRIGGER update_crm_task_types_updated_at
  BEFORE UPDATE ON public.crm_task_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.crm_task_types (key, label, icon, color, default_due_offset_minutes, default_reminder_offset_minutes, sort_order) VALUES
  ('call',             'Звонок',            'Phone',          '#3B82F6', 1440, 60, 10),
  ('message',          'Сообщение',         'MessageCircle',  '#10B981', 1440, 60, 20),
  ('meeting',          'Встреча',           'Calendar',       '#8B5CF6', 1440, 60, 30),
  ('payment_control',  'Контроль оплаты',   'CreditCard',     '#F59E0B', 2880, 120, 40),
  ('service_delivery', 'Оказать услугу',    'Briefcase',      '#06B6D4', 1440, 60, 50),
  ('crm_fill',         'Заполнить CRM',     'Database',       '#64748B', 720,  60, 60),
  ('other',            'Другое',            'CircleDot',      '#94A3B8', 1440, 60, 99)
ON CONFLICT (workspace_id, key) DO NOTHING;

-- =======================================
-- 2. crm_tasks (canonical)
-- =======================================
CREATE TABLE IF NOT EXISTS public.crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE,
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  task_type_id uuid NOT NULL REFERENCES public.crm_task_types(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,

  contact_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES public.orders_v2(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders_v2(id) ON DELETE SET NULL,

  pipeline_id uuid,
  pipeline_stage_id uuid,
  offer_id uuid,
  product_id uuid,
  tariff_id uuid,

  assignee_user_id uuid,
  due_at timestamptz,
  remind_at timestamptz,

  status text NOT NULL DEFAULT 'open',
  CONSTRAINT crm_tasks_status_chk CHECK (status IN ('open','in_progress','done','canceled')),

  result_comment text,
  closed_at timestamptz,
  closed_by uuid,

  source text NOT NULL DEFAULT 'manual',
  CONSTRAINT crm_tasks_source_chk CHECK (source IN ('manual','auto','system')),
  automation_rule_id uuid,

  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_tasks_automation_uniq
  ON public.crm_tasks (automation_rule_id, deal_id)
  WHERE automation_rule_id IS NOT NULL AND deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_tasks_workspace_assignee_status_due_idx
  ON public.crm_tasks (workspace_id, assignee_user_id, status, due_at);
CREATE INDEX IF NOT EXISTS crm_tasks_deal_idx        ON public.crm_tasks (deal_id);
CREATE INDEX IF NOT EXISTS crm_tasks_contact_idx     ON public.crm_tasks (contact_id);
CREATE INDEX IF NOT EXISTS crm_tasks_status_due_idx  ON public.crm_tasks (status, due_at);
CREATE INDEX IF NOT EXISTS crm_tasks_meta_gin_idx    ON public.crm_tasks USING gin (meta);

GRANT SELECT, INSERT, UPDATE ON public.crm_tasks TO authenticated;
GRANT ALL ON public.crm_tasks TO service_role;

ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_tasks_staff_read ON public.crm_tasks
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'employee')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY crm_tasks_staff_insert ON public.crm_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'employee')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY crm_tasks_staff_update ON public.crm_tasks
  FOR UPDATE TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'employee')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'employee')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE OR REPLACE FUNCTION public.set_crm_task_public_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := public.next_public_id('crm_task');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_crm_task_public_id
  BEFORE INSERT ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_crm_task_public_id();

CREATE TRIGGER update_crm_tasks_updated_at
  BEFORE UPDATE ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =======================================
-- 3. crm_task_notifications (ledger)
-- =======================================
CREATE TABLE IF NOT EXISTS public.crm_task_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.crm_tasks(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  CONSTRAINT crm_task_notifications_type_chk CHECK (notification_type IN ('created','assigned','due_soon','overdue','reminder','status_changed')),
  channel text NOT NULL,
  CONSTRAINT crm_task_notifications_channel_chk CHECK (channel IN ('telegram','email','in_app')),
  recipient_user_id uuid,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  CONSTRAINT crm_task_notifications_status_chk CHECK (status IN ('pending','sent','failed','skipped')),
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_task_notifications_status_scheduled_idx
  ON public.crm_task_notifications (status, scheduled_at);
CREATE INDEX IF NOT EXISTS crm_task_notifications_task_idx
  ON public.crm_task_notifications (task_id);

GRANT SELECT ON public.crm_task_notifications TO authenticated;
GRANT ALL ON public.crm_task_notifications TO service_role;
ALTER TABLE public.crm_task_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_task_notifications_staff_read ON public.crm_task_notifications
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'employee')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE TRIGGER update_crm_task_notifications_updated_at
  BEFORE UPDATE ON public.crm_task_notifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =======================================
-- 4. crm_task_automation_rules
-- =======================================
CREATE TABLE IF NOT EXISTS public.crm_task_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL REFERENCES public.tariff_offers(id) ON DELETE CASCADE,
  task_type_id uuid NOT NULL REFERENCES public.crm_task_types(id) ON DELETE RESTRICT,
  title_template text NOT NULL,
  description_template text,
  assignee_strategy text NOT NULL DEFAULT 'fixed_user',
  CONSTRAINT crm_task_automation_rules_strategy_chk CHECK (assignee_strategy IN ('fixed_user','deal_owner','round_robin')),
  assignee_user_id uuid,
  due_offset_minutes integer NOT NULL DEFAULT 1440,
  reminder_offset_minutes integer,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_task_automation_rules_fixed_user_required CHECK (
    assignee_strategy <> 'fixed_user' OR assignee_user_id IS NOT NULL
  ),
  CONSTRAINT crm_task_automation_rules_reminder_window CHECK (
    reminder_offset_minutes IS NULL
    OR (reminder_offset_minutes >= 0 AND reminder_offset_minutes < due_offset_minutes)
  )
);

CREATE INDEX IF NOT EXISTS crm_task_automation_rules_offer_idx
  ON public.crm_task_automation_rules (offer_id) WHERE is_active = true;

GRANT SELECT, INSERT, UPDATE ON public.crm_task_automation_rules TO authenticated;
GRANT ALL ON public.crm_task_automation_rules TO service_role;

ALTER TABLE public.crm_tasks
  ADD CONSTRAINT crm_tasks_automation_rule_fk
  FOREIGN KEY (automation_rule_id) REFERENCES public.crm_task_automation_rules(id) ON DELETE SET NULL;

ALTER TABLE public.crm_task_automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_task_automation_rules_staff_read ON public.crm_task_automation_rules
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'employee')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY crm_task_automation_rules_admin_write ON public.crm_task_automation_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY crm_task_automation_rules_admin_update ON public.crm_task_automation_rules
  FOR UPDATE TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE TRIGGER update_crm_task_automation_rules_updated_at
  BEFORE UPDATE ON public.crm_task_automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
