-- SECURITY DEFINER RPC для безопасной записи training-событий в audit_logs.
-- Доступно любому authenticated, но строго ограничено action LIKE 'training.%'.
-- Это закрывает RLS-блок для INSERT из клиента (insert требует audit.view или service_role).
CREATE OR REPLACE FUNCTION public.log_training_event(
  _action text,
  _target_user_id uuid,
  _meta jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'log_training_event: not authenticated';
  END IF;

  IF _action IS NULL OR _action NOT LIKE 'training.%' THEN
    RAISE EXCEPTION 'log_training_event: action must start with training.';
  END IF;

  INSERT INTO public.audit_logs (
    actor_user_id, actor_type, action, target_user_id, meta
  ) VALUES (
    _actor, 'user', _action, COALESCE(_target_user_id, _actor),
    COALESCE(_meta, '{}'::jsonb)
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_training_event(text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.log_training_event(text, uuid, jsonb) TO authenticated;
