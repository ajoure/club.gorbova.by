-- Extend the existing scoped assignment action. No customer rows are repaired
-- by this migration. The five-argument writer retains its original guard.

CREATE OR REPLACE FUNCTION public.support_bot_assign_v1(
  p_user_id uuid,p_bot_id uuid,p_observed_incoming_id uuid,p_assignee_user_id uuid,
  p_observed_assignment_id uuid,p_observed_assignment_version text,
  p_observed_telegram_user_id bigint,p_request_id uuid,p_note text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid(); v_latest public.telegram_messages%ROWTYPE;
  v_existing public.contact_center_message_assignments%ROWTYPE;
  v_version text; v_observed_version text; v_snapshot_at timestamptz; v_snapshot jsonb;
  v_recipient bigint; v_count integer; v_changed integer;
  v_note text := NULLIF(left(trim(p_note),1000),''); v_request jsonb; v_receipt public.audit_logs%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT COALESCE(public.has_admin_section_access(v_actor,'communication','manage'),false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_user_id IS NULL OR p_bot_id IS NULL OR p_observed_incoming_id IS NULL
    OR p_assignee_user_id IS NULL OR p_request_id IS NULL OR p_observed_telegram_user_id IS NULL
    OR p_observed_assignment_version IS NULL
    OR NOT public.support_bot_allowed_v1(p_bot_id)
    OR NOT COALESCE(public.has_admin_section_access(p_assignee_user_id,'communication','view'),false) THEN
    RAISE EXCEPTION 'invalid_support_assignment' USING ERRCODE='22023';
  END IF;
  v_request := jsonb_build_object('actor_id',v_actor,'user_id',p_user_id,'bot_id',p_bot_id,
    'incoming_id',p_observed_incoming_id,'old_assignment_id',p_observed_assignment_id,
    'old_assignment_version',p_observed_assignment_version,'new_assignee_id',p_assignee_user_id,
    'binding_hash',encode(sha256(convert_to(p_observed_telegram_user_id::text,'UTF8')),'hex'),
    'note_hash',encode(sha256(convert_to(COALESCE(v_note,''),'UTF8')),'hex'));
  -- Serialize reuse of the same request even across different dialog scopes.
  -- No row lock precedes the binding/dialog advisory locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('support-assignment-request:'||p_request_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('support-binding:'||p_user_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('support-bot:'||p_user_id::text||':'||p_bot_id::text,0));
  SELECT * INTO v_receipt FROM public.audit_logs WHERE id=p_request_id;
  IF FOUND THEN
    IF v_receipt.action='support_bot_assignment_cas' AND v_receipt.actor_user_id=v_actor
      AND v_receipt.entity_type='contact_center_message_assignment' AND v_receipt.entity_id=p_request_id::text
      AND v_receipt.meta=v_request
      AND EXISTS(SELECT 1 FROM public.contact_center_message_assignments WHERE id=p_request_id) THEN
      RETURN jsonb_build_object('assignment_id',p_request_id,'created',false);
    END IF;
    RAISE EXCEPTION 'support_request_id_conflict' USING ERRCODE='40001';
  END IF;
  BEGIN
    v_snapshot := p_observed_assignment_version::jsonb;
    v_observed_version := v_snapshot->>'row';
    v_snapshot_at := (v_snapshot->>'observed_at')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid_support_assignment' USING ERRCODE='22023';
  END;
  IF v_snapshot_at IS NULL OR (p_observed_assignment_id IS NULL) <> (v_observed_version IS NULL) THEN
    RAISE EXCEPTION 'invalid_support_assignment' USING ERRCODE='22023';
  END IF;
  IF v_snapshot_at < clock_timestamp()-interval '2 minutes' OR v_snapshot_at > clock_timestamp()+interval '5 seconds' THEN
    RAISE EXCEPTION 'support_assignment_snapshot_expired' USING ERRCODE='40001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.contact_center_message_assignments WHERE id=p_request_id) THEN
    RAISE EXCEPTION 'support_request_id_conflict' USING ERRCODE='40001';
  END IF;
  -- Expired/uncertain sending is not proof of non-delivery. Reconcile first.
  IF EXISTS(SELECT 1 FROM public.support_bot_send_claims WHERE user_id=p_user_id AND bot_id=p_bot_id
    AND status IN('sending','uncertain')) THEN
    RAISE EXCEPTION 'support_previous_send_delivery_unknown' USING ERRCODE='40001';
  END IF;
  PERFORM 1 FROM public.telegram_bots WHERE id=p_bot_id AND status='active' AND support_enabled FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'support_channel_not_allowed' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_latest FROM public.telegram_messages m WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id
    AND m.transport='bot' AND m.business_account_id IS NULL AND m.business_connection_id IS NULL
    AND m.direction='incoming' ORDER BY m.created_at DESC,m.id DESC LIMIT 1 FOR SHARE NOWAIT;
  IF v_latest.id IS DISTINCT FROM p_observed_incoming_id THEN
    RAISE EXCEPTION 'support_new_incoming_refresh_required' USING ERRCODE='40001';
  END IF;
  SELECT telegram_user_id INTO v_recipient FROM public.profiles WHERE user_id=p_user_id;
  IF v_recipient IS NULL OR v_recipient IS DISTINCT FROM p_observed_telegram_user_id
    OR v_recipient IS DISTINCT FROM v_latest.telegram_user_id THEN
    RAISE EXCEPTION 'support_recipient_not_verified' USING ERRCODE='40001';
  END IF;
  SELECT count(*) INTO v_count FROM public.contact_center_message_assignments a
    JOIN public.telegram_messages m ON m.id=a.source_message_id
    WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id AND m.transport='bot'
      AND m.business_account_id IS NULL AND m.business_connection_id IS NULL AND a.source='telegram' AND a.resolved_at IS NULL;
  IF v_count>1 THEN RAISE EXCEPTION 'support_multiple_active_assignments_anomaly' USING ERRCODE='40001'; END IF;
  SELECT a.* INTO v_existing FROM public.contact_center_message_assignments a
    JOIN public.telegram_messages m ON m.id=a.source_message_id
    WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id AND m.transport='bot'
      AND m.business_account_id IS NULL AND m.business_connection_id IS NULL AND a.source='telegram' AND a.resolved_at IS NULL
    FOR UPDATE OF a NOWAIT FOR SHARE OF m NOWAIT;
  SELECT xmin::text INTO v_version FROM public.contact_center_message_assignments WHERE id=v_existing.id;
  IF v_existing.id IS DISTINCT FROM p_observed_assignment_id OR v_version IS DISTINCT FROM v_observed_version THEN
    RAISE EXCEPTION 'support_assignment_stale_refresh_required' USING ERRCODE='40001';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.assignee_user_id=p_assignee_user_id THEN
      RETURN jsonb_build_object('assignment_id',v_existing.id,'created',false);
    END IF;
    UPDATE public.contact_center_message_assignments SET resolved_at=clock_timestamp(),
      resolved_by_user_id=v_actor,updated_at=clock_timestamp()
      WHERE id=v_existing.id AND resolved_at IS NULL AND xmin::text=v_observed_version;
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed<>1 THEN RAISE EXCEPTION 'support_assignment_stale_refresh_required' USING ERRCODE='40001'; END IF;
  END IF;
  INSERT INTO public.contact_center_message_assignments(id,source,source_message_id,assignee_user_id,assigned_by_user_id,note)
    VALUES(p_request_id,'telegram',v_latest.id,p_assignee_user_id,v_actor,v_note);
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed<>1 THEN RAISE EXCEPTION 'support_assignment_rowcount_mismatch'; END IF;
  INSERT INTO public.audit_logs(id,action,actor_type,actor_user_id,entity_type,entity_id,meta)
    VALUES(p_request_id,'support_bot_assignment_cas','user',v_actor,'contact_center_message_assignment',p_request_id::text,v_request);
  RETURN jsonb_build_object('assignment_id',p_request_id,'created',true);
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'support_assignment_busy_retry' USING ERRCODE='40001';
END $$;
REVOKE ALL ON FUNCTION public.support_bot_assign_v1(uuid,uuid,uuid,uuid,uuid,text,bigint,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.support_bot_assign_v1(uuid,uuid,uuid,uuid,uuid,text,bigint,uuid,text) TO authenticated;

--> statement-breakpoint

-- The existing reader returns SETOF jsonb: additive snapshot, no DROP.
CREATE OR REPLACE FUNCTION public.support_bot_dialogs_v1(
  p_bot_id uuid,p_search text DEFAULT NULL,p_unread_only boolean DEFAULT false,
  p_limit integer DEFAULT 50,p_offset integer DEFAULT 0
)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','view'),false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT public.support_bot_allowed_v1(p_bot_id) THEN
    RAISE EXCEPTION 'support_channel_not_allowed' USING ERRCODE='22023';
  END IF;
  RETURN QUERY WITH scoped AS MATERIALIZED (
    SELECT m.id,m.user_id,m.telegram_user_id,m.direction,m.created_at,m.message_text,m.is_read,m.requires_reply
    FROM public.telegram_messages m WHERE m.bot_id=p_bot_id AND m.transport='bot'
      AND m.business_account_id IS NULL AND m.business_connection_id IS NULL AND m.user_id IS NOT NULL
  ), latest AS (SELECT DISTINCT ON (user_id) * FROM scoped ORDER BY user_id,created_at DESC,id DESC),
  incoming AS (SELECT DISTINCT ON (user_id) * FROM scoped WHERE direction='incoming' ORDER BY user_id,created_at DESC,id DESC),
  counts AS (SELECT user_id,count(*) FILTER(WHERE direction='incoming' AND (requires_reply OR NOT is_read)) AS unread_count FROM scoped GROUP BY user_id)
  SELECT jsonb_build_object('user_id',l.user_id,'bot_id',p_bot_id,
    'display_name',COALESCE(p.full_name,'Клиент'),'telegram_user_id',p.telegram_user_id,'telegram_username',p.telegram_username,
    'can_reply',p.telegram_user_id IS NOT NULL AND p.telegram_user_id=i.telegram_user_id,
    'last_message_at',l.created_at,'last_message_preview',left(l.message_text,240),'unread_count',c.unread_count,
    'latest_incoming_id',i.id,'latest_incoming_at',i.created_at,
    'assignment_id',a.id,'assignment_version',jsonb_build_object('row',a.version,'observed_at',statement_timestamp())::text,'assignee_user_id',a.assignee_user_id,'assignee_name',ap.full_name)
  FROM latest l JOIN incoming i USING(user_id) JOIN counts c USING(user_id)
  JOIN public.profiles p ON p.user_id=l.user_id
  LEFT JOIN LATERAL (
    SELECT x.id,x.assignee_user_id,x.xmin::text AS version FROM public.contact_center_message_assignments x
    JOIN scoped sm ON sm.id=x.source_message_id
    WHERE sm.user_id=l.user_id AND x.source='telegram' AND x.resolved_at IS NULL ORDER BY x.assigned_at DESC,x.id DESC LIMIT 1
  ) a ON true LEFT JOIN public.profiles ap ON ap.user_id=a.assignee_user_id
  WHERE (NOT p_unread_only OR c.unread_count>0)
    AND (NULLIF(trim(p_search),'') IS NULL OR p.full_name ILIKE '%'||p_search||'%'
      OR p.telegram_username ILIKE '%'||p_search||'%' OR l.user_id::text=p_search)
  ORDER BY l.created_at DESC,l.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),100) OFFSET GREATEST(COALESCE(p_offset,0),0);
END $$;