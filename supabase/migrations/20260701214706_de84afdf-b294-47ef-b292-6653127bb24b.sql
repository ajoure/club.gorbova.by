
-- Step 1: audit and replace UNIQUE constraint so re-assignment can queue a new notification.
DO $$
DECLARE
  conname_v text;
BEGIN
  SELECT conname INTO conname_v
  FROM pg_constraint
  WHERE conrelid = 'public.crm_task_notifications'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%(task_id, notification_type)%';
  IF conname_v IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.crm_task_notifications DROP CONSTRAINT %I', conname_v);
  END IF;
END $$;

-- Drop any matching unique index if it exists standalone.
DROP INDEX IF EXISTS public.crm_task_notifications_task_type_uniq;

-- New unique: same (task, type) may exist per recipient (safe for reassignment).
CREATE UNIQUE INDEX IF NOT EXISTS crm_task_notifications_task_type_recipient_uniq
  ON public.crm_task_notifications (task_id, notification_type, recipient_user_id);

-- Step 2: trigger function — enqueue an "assigned" notification.
CREATE OR REPLACE FUNCTION public.crm_tasks_enqueue_assigned_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
BEGIN
  IF NEW.assignee_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('done','canceled') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_source := 'task_created';
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.assignee_user_id IS NOT DISTINCT FROM NEW.assignee_user_id THEN
      RETURN NEW;
    END IF;
    v_source := 'assignee_changed';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.crm_task_notifications
    (task_id, notification_type, channel, recipient_user_id, scheduled_at, status, metadata)
  VALUES
    (NEW.id, 'assigned', 'telegram', NEW.assignee_user_id, now(), 'pending',
      jsonb_build_object(
        'source', v_source,
        'previous_assignee', CASE WHEN TG_OP = 'UPDATE' THEN OLD.assignee_user_id::text ELSE NULL END
      ))
  ON CONFLICT (task_id, notification_type, recipient_user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_tasks_notify_assigned_ins ON public.crm_tasks;
CREATE TRIGGER trg_crm_tasks_notify_assigned_ins
  AFTER INSERT ON public.crm_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_tasks_enqueue_assigned_notification();

DROP TRIGGER IF EXISTS trg_crm_tasks_notify_assigned_upd ON public.crm_tasks;
CREATE TRIGGER trg_crm_tasks_notify_assigned_upd
  AFTER UPDATE OF assignee_user_id ON public.crm_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_tasks_enqueue_assigned_notification();

REVOKE EXECUTE ON FUNCTION public.crm_tasks_enqueue_assigned_notification() FROM PUBLIC, anon;
