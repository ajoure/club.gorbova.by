
CREATE OR REPLACE FUNCTION public.approve_broadcast_template(_template_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_has_perm BOOLEAN;
  v_tpl RECORD;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT public.has_permission(v_actor, 'entitlements.manage') INTO v_has_perm;
  IF NOT COALESCE(v_has_perm, FALSE) THEN
    RAISE EXCEPTION 'forbidden_missing_entitlements_manage' USING ERRCODE = '42501';
  END IF;

  SELECT id, name, status, approval_status
    INTO v_tpl
    FROM public.broadcast_templates
   WHERE id = _template_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_tpl.approval_status = 'approved' THEN
    RETURN jsonb_build_object('ok', true, 'already_approved', true, 'template_id', _template_id);
  END IF;

  IF v_tpl.approval_status = 'rejected' THEN
    RAISE EXCEPTION 'template_rejected_cannot_approve' USING ERRCODE = '22023';
  END IF;

  UPDATE public.broadcast_templates
     SET approval_status = 'approved',
         approved_by = v_actor,
         approved_at = now(),
         rejected_reason = NULL
   WHERE id = _template_id;

  INSERT INTO public.audit_logs (action, actor_type, actor_label, actor_user_id, meta)
  VALUES (
    'broadcast_template_approved',
    'user',
    'admin_ui',
    v_actor,
    jsonb_build_object(
      'entity_type','broadcast_template',
      'entity_id', _template_id,
      'template_name', v_tpl.name,
      'previous_approval_status', v_tpl.approval_status
    )
  );

  RETURN jsonb_build_object('ok', true, 'approved', true, 'template_id', _template_id);
END;
$function$;
