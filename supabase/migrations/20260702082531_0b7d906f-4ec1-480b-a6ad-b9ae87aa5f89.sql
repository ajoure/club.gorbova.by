-- Allow re-notification on reassignment: if a notification already exists for
-- the (task, 'assigned', recipient), reset it to pending so the worker resends.
CREATE OR REPLACE FUNCTION public.crm_tasks_enqueue_assigned_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  ON CONFLICT (task_id, notification_type, recipient_user_id) DO UPDATE
    SET status = 'pending',
        scheduled_at = now(),
        sent_at = NULL,
        error = NULL,
        attempts = 0,
        metadata = EXCLUDED.metadata;

  RETURN NEW;
END;
$function$;