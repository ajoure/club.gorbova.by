-- Broadcast builder: replace the obsolete entitlements.manage gate with the
-- contact-center RBAC section and allow all supported Telegram media types.

ALTER TABLE public.broadcast_templates
  DROP CONSTRAINT IF EXISTS broadcast_templates_media_type_check;

ALTER TABLE public.broadcast_templates
  ADD CONSTRAINT broadcast_templates_media_type_check
  CHECK (
    media_type IS NULL
    OR media_type = ANY (ARRAY['photo','animation','video','audio','video_note','document']::text[])
  );

DROP POLICY IF EXISTS "Admins can manage templates" ON public.broadcast_templates;
DROP POLICY IF EXISTS "Communication staff can view broadcast templates" ON public.broadcast_templates;
DROP POLICY IF EXISTS "Communication managers can insert broadcast templates" ON public.broadcast_templates;
DROP POLICY IF EXISTS "Communication managers can update broadcast templates" ON public.broadcast_templates;
DROP POLICY IF EXISTS "Communication managers can delete broadcast templates" ON public.broadcast_templates;

CREATE POLICY "Communication staff can view broadcast templates"
ON public.broadcast_templates FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(), 'super_admin')
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_admin_section_access(auth.uid(), 'communication', 'view')
);

CREATE POLICY "Communication managers can insert broadcast templates"
ON public.broadcast_templates FOR INSERT TO authenticated
WITH CHECK (
  public.has_role_v2(auth.uid(), 'super_admin')
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_admin_section_access(auth.uid(), 'communication', 'manage')
);

CREATE POLICY "Communication managers can update broadcast templates"
ON public.broadcast_templates FOR UPDATE TO authenticated
USING (
  public.has_role_v2(auth.uid(), 'super_admin')
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_admin_section_access(auth.uid(), 'communication', 'manage')
)
WITH CHECK (
  public.has_role_v2(auth.uid(), 'super_admin')
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_admin_section_access(auth.uid(), 'communication', 'manage')
);

CREATE POLICY "Communication managers can delete broadcast templates"
ON public.broadcast_templates FOR DELETE TO authenticated
USING (
  public.has_role_v2(auth.uid(), 'super_admin')
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_admin_section_access(auth.uid(), 'communication', 'manage')
);

DROP POLICY IF EXISTS "Staff can upload to telegram-media" ON storage.objects;
DROP POLICY IF EXISTS "Staff can read telegram-media" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update telegram-media" ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete telegram-media" ON storage.objects;

CREATE POLICY "Staff can upload to telegram-media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'menedzher')
    OR public.has_role_v2(auth.uid(), 'support')
    OR public.has_role_v2(auth.uid(), 'editor')
    OR public.has_role_v2(auth.uid(), 'admin_gost')
    OR public.has_admin_section_access(auth.uid(), 'communication', 'manage')
  )
);

CREATE POLICY "Staff can read telegram-media"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'menedzher')
    OR public.has_role_v2(auth.uid(), 'support')
    OR public.has_role_v2(auth.uid(), 'editor')
    OR public.has_role_v2(auth.uid(), 'admin_gost')
    OR public.has_admin_section_access(auth.uid(), 'communication', 'view')
  )
);

CREATE POLICY "Staff can update telegram-media"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'menedzher')
    OR public.has_role_v2(auth.uid(), 'support')
    OR public.has_role_v2(auth.uid(), 'editor')
    OR public.has_role_v2(auth.uid(), 'admin_gost')
    OR public.has_admin_section_access(auth.uid(), 'communication', 'manage')
  )
)
WITH CHECK (bucket_id = 'telegram-media');

CREATE POLICY "Staff can delete telegram-media"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'telegram-media'
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'menedzher')
    OR public.has_role_v2(auth.uid(), 'support')
    OR public.has_role_v2(auth.uid(), 'editor')
    OR public.has_role_v2(auth.uid(), 'admin_gost')
    OR public.has_admin_section_access(auth.uid(), 'communication', 'manage')
  )
);

DROP POLICY IF EXISTS "Admins can view broadcast_runs" ON public.broadcast_runs;
DROP POLICY IF EXISTS "Communication staff can view broadcast runs" ON public.broadcast_runs;
CREATE POLICY "Communication staff can view broadcast runs"
ON public.broadcast_runs FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(), 'super_admin')
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_admin_section_access(auth.uid(), 'communication', 'view')
);

-- The audience editor lists active lessons. Contact-center employees do not
-- need content-edit rights, but they do need read access to choose a condition.
DROP POLICY IF EXISTS "Communication staff can view active training lessons" ON public.training_lessons;
CREATE POLICY "Communication staff can view active training lessons"
ON public.training_lessons FOR SELECT TO authenticated
USING (
  is_active = true
  AND (
    public.has_role_v2(auth.uid(), 'super_admin')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_admin_section_access(auth.uid(), 'communication', 'view')
  )
);

CREATE OR REPLACE FUNCTION public.get_last_broadcast_audit_proof()
RETURNS TABLE (
  created_at timestamptz,
  action text,
  actor_type text,
  actor_label text,
  actor_user_id uuid,
  sent integer,
  failed integer,
  diagnostic jsonb,
  meta jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role_v2(auth.uid(), 'super_admin')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_admin_section_access(auth.uid(), 'communication', 'view')
  ) THEN
    RAISE EXCEPTION 'Недостаточно прав для просмотра истории рассылок' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    al.created_at,
    al.action,
    al.actor_type,
    al.actor_label,
    al.actor_user_id,
    COALESCE((al.meta->>'sent')::integer, 0),
    COALESCE((al.meta->>'failed')::integer, 0),
    COALESCE(al.meta->'diagnostic', '{}'::jsonb),
    al.meta
  FROM public.audit_logs al
  WHERE al.action IN ('email_mass_broadcast', 'telegram_mass_broadcast')
    AND al.actor_type = 'system'
    AND al.actor_user_id IS NULL
    AND al.actor_label = 'broadcast-dispatcher'
  ORDER BY al.created_at DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_last_broadcast_audit_proof() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_broadcast_audit_proof() TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_broadcast_template(_template_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tpl record;
BEGIN
  IF v_actor IS NULL OR NOT (
    public.has_role_v2(v_actor, 'super_admin')
    OR public.has_role_v2(v_actor, 'admin')
    OR public.has_admin_section_access(v_actor, 'communication', 'manage')
  ) THEN
    RAISE EXCEPTION 'Недостаточно прав для одобрения рассылки' USING ERRCODE = '42501';
  END IF;

  SELECT id, name, status, approval_status INTO v_tpl
  FROM public.broadcast_templates
  WHERE id = _template_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Рассылка не найдена' USING ERRCODE = 'P0002';
  END IF;
  IF v_tpl.approval_status = 'approved' THEN
    RETURN jsonb_build_object('ok', true, 'already_approved', true, 'template_id', _template_id);
  END IF;
  IF v_tpl.approval_status = 'rejected' THEN
    RAISE EXCEPTION 'Отклонённую рассылку нельзя одобрить без повторного редактирования' USING ERRCODE = '22023';
  END IF;

  UPDATE public.broadcast_templates
  SET approval_status = 'approved', approved_by = v_actor, approved_at = now(), rejected_reason = NULL
  WHERE id = _template_id;

  INSERT INTO public.audit_logs (action, actor_type, actor_label, actor_user_id, entity_type, entity_id, meta)
  VALUES (
    'broadcast_template_approved', 'user', 'admin_ui', v_actor, 'broadcast_template', _template_id::text,
    jsonb_build_object(
      'entity_type', 'broadcast_template',
      'entity_id', _template_id,
      'template_name', v_tpl.name,
      'previous_approval_status', v_tpl.approval_status
    )
  );

  RETURN jsonb_build_object('ok', true, 'approved', true, 'template_id', _template_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_broadcast_template(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_broadcast_template(uuid) TO authenticated;

-- Conditional education broadcasts extend the existing broadcast_templates
-- source of truth instead of creating a parallel campaign module.
ALTER TABLE public.broadcast_templates
  ADD COLUMN IF NOT EXISTS trigger_kind text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS education_condition jsonb;

ALTER TABLE public.broadcast_templates
  DROP CONSTRAINT IF EXISTS broadcast_templates_trigger_kind_check;
ALTER TABLE public.broadcast_templates
  ADD CONSTRAINT broadcast_templates_trigger_kind_check
  CHECK (trigger_kind IN ('manual', 'lesson_event', 'scheduled_condition'));

ALTER TABLE public.broadcast_templates
  DROP CONSTRAINT IF EXISTS broadcast_templates_send_mode_check;
ALTER TABLE public.broadcast_templates
  ADD CONSTRAINT broadcast_templates_send_mode_check
  CHECK (send_mode IN ('manual', 'scheduled', 'recurring', 'event'));

CREATE TABLE IF NOT EXISTS public.broadcast_automation_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.broadcast_templates(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  telegram_chat_id bigint,
  telegram_message_id bigint,
  attempted_at timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, user_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_automation_pending
  ON public.broadcast_automation_deliveries(created_at)
  WHERE status = 'pending';

ALTER TABLE public.broadcast_automation_deliveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.broadcast_automation_deliveries TO authenticated;
GRANT ALL ON public.broadcast_automation_deliveries TO service_role;
DROP POLICY IF EXISTS "Communication staff can view broadcast automation deliveries" ON public.broadcast_automation_deliveries;
CREATE POLICY "Communication staff can view broadcast automation deliveries"
ON public.broadcast_automation_deliveries FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(), 'super_admin')
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_admin_section_access(auth.uid(), 'communication', 'view')
);

CREATE OR REPLACE FUNCTION public.queue_lesson_completion_broadcasts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.broadcast_automation_deliveries(template_id, user_id, event_key)
  SELECT
    bt.id,
    NEW.user_id,
    'lesson_completed:' || NEW.lesson_id::text
  FROM public.broadcast_templates bt
  WHERE bt.trigger_kind = 'lesson_event'
    AND bt.status = 'recurring'
    AND bt.approval_status = 'approved'
    AND bt.education_condition->>'status' = 'lesson_completed'
    AND bt.education_condition->>'lesson_id' = NEW.lesson_id::text
  ON CONFLICT (template_id, user_id, event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_lesson_completion_broadcasts ON public.lesson_progress;
CREATE TRIGGER trg_queue_lesson_completion_broadcasts
AFTER INSERT ON public.lesson_progress
FOR EACH ROW EXECUTE FUNCTION public.queue_lesson_completion_broadcasts();

CREATE OR REPLACE FUNCTION public.queue_lesson_response_broadcasts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block_type text;
  v_event_status text;
  v_is_submitted boolean;
BEGIN
  v_is_submitted := NEW.completed_at IS NOT NULL
    OR (NEW.response IS NOT NULL AND NEW.response <> '{}'::jsonb);
  IF NOT v_is_submitted THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.completed_at IS NOT DISTINCT FROM NEW.completed_at
    AND OLD.response IS NOT DISTINCT FROM NEW.response THEN
    RETURN NEW;
  END IF;

  SELECT block_type INTO v_block_type FROM public.lesson_blocks WHERE id = NEW.block_id;
  IF v_block_type IN ('file_upload', 'input_long', 'table_input') THEN
    v_event_status := 'homework_submitted';
  ELSIF v_block_type IN (
    'quiz_survey','sequential_form','diagnostic_table','input_short','checklist','rating',
    'quiz_single','quiz_multiple','quiz_true_false','quiz_fill_blank','quiz_matching','quiz_sequence','quiz_hotspot'
  ) THEN
    v_event_status := 'form_answered';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.broadcast_automation_deliveries(template_id, user_id, event_key)
  SELECT
    bt.id,
    NEW.user_id,
    v_event_status || ':' || NEW.lesson_id::text
  FROM public.broadcast_templates bt
  WHERE bt.trigger_kind = 'lesson_event'
    AND bt.status = 'recurring'
    AND bt.approval_status = 'approved'
    AND bt.education_condition->>'status' = v_event_status
    AND bt.education_condition->>'lesson_id' = NEW.lesson_id::text
  ON CONFLICT (template_id, user_id, event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_lesson_response_broadcasts ON public.user_lesson_progress;
CREATE TRIGGER trg_queue_lesson_response_broadcasts
AFTER INSERT OR UPDATE OF completed_at, response ON public.user_lesson_progress
FOR EACH ROW EXECUTE FUNCTION public.queue_lesson_response_broadcasts();

CREATE OR REPLACE FUNCTION public.claim_broadcast_automation_deliveries(_limit integer DEFAULT 50)
RETURNS SETOF public.broadcast_automation_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.broadcast_automation_deliveries
    WHERE status = 'pending'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(_limit, 1), 100)
  )
  UPDATE public.broadcast_automation_deliveries d
  SET status = 'processing', attempted_at = now(), error = NULL
  FROM claimed
  WHERE d.id = claimed.id
  RETURNING d.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_broadcast_automation_deliveries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_automation_deliveries(integer) TO service_role;