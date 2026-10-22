-- Support is an explicit opt-in, never inferred from primary/active or a name.
ALTER TABLE public.telegram_bots ADD COLUMN IF NOT EXISTS support_enabled boolean NOT NULL DEFAULT false;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.telegram_bots WHERE status='active' AND id IN (
    '1a560e98-574e-4fd9-82ab-4b7bbdc300b4','6d967844-eebf-4788-9f00-8655297fe9bb',
    'f20fbca1-7833-4e92-923d-2712d2ad3d3c','2a676ae6-71f1-49f6-9fe4-f7ec7ce46c01')) <> 4 THEN
    RAISE EXCEPTION 'support_allowlist_preflight_expected_four_active_bots';
  END IF;
  UPDATE public.telegram_bots SET support_enabled=true WHERE id IN (
    '1a560e98-574e-4fd9-82ab-4b7bbdc300b4','6d967844-eebf-4788-9f00-8655297fe9bb',
    'f20fbca1-7833-4e92-923d-2712d2ad3d3c','2a676ae6-71f1-49f6-9fe4-f7ec7ce46c01');
END $$;

CREATE OR REPLACE FUNCTION public.support_bot_allowed_v1(p_bot_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.telegram_bots WHERE id=p_bot_id AND status='active' AND support_enabled);
$$;
REVOKE ALL ON FUNCTION public.support_bot_allowed_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.support_bot_allowed_v1(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.support_bot_allowed_v1(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.support_bot_channels_v1()
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','view'),false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT jsonb_build_object('id',b.id,'label',b.bot_name,'username',b.bot_username)
    FROM public.telegram_bots b WHERE b.support_enabled AND b.status='active' ORDER BY b.bot_name,b.id;
END $$;

CREATE OR REPLACE FUNCTION public.support_bot_messages_v1(
  p_user_id uuid,p_bot_id uuid,p_limit integer DEFAULT 100,
  p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,
  p_text_limit integer DEFAULT NULL,p_unanswered_only boolean DEFAULT false
)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','view'),false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_user_id IS NULL OR NOT public.support_bot_allowed_v1(p_bot_id) THEN
    RAISE EXCEPTION 'support_channel_not_allowed' USING ERRCODE='22023';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'both_cursor_fields_required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT to_jsonb(m) || jsonb_build_object(
    'message_text',CASE WHEN p_text_limit IS NULL THEN m.message_text ELSE left(m.message_text,LEAST(GREATEST(p_text_limit,1),4096)) END,
    'is_truncated',p_text_limit IS NOT NULL AND length(m.message_text)>LEAST(GREATEST(p_text_limit,1),4096),
    'meta',CASE WHEN p_text_limit IS NULL THEN m.meta ELSE m.meta-'raw'-'reply_markup' END,
    'bot_name',b.bot_name,'bot_username',b.bot_username,'admin_full_name',ap.full_name,'admin_avatar_url',ap.avatar_url)
  FROM public.telegram_messages m JOIN public.telegram_bots b ON b.id=m.bot_id
  LEFT JOIN public.profiles ap ON ap.user_id=m.sent_by_admin
  WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id AND m.transport='bot'
    AND m.business_account_id IS NULL AND m.business_connection_id IS NULL
    AND (NOT p_unanswered_only OR (m.direction='incoming' AND (m.requires_reply OR NOT m.is_read)))
    AND (p_before_created_at IS NULL OR (m.created_at,m.id)<(p_before_created_at,p_before_id))
  ORDER BY CASE WHEN p_unanswered_only THEN m.created_at END ASC,
    CASE WHEN p_unanswered_only THEN m.id END ASC,m.created_at DESC,m.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),200);
END $$;

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
    'assignment_id',a.id,'assignee_user_id',a.assignee_user_id,'assignee_name',ap.full_name)
  FROM latest l JOIN incoming i USING(user_id) JOIN counts c USING(user_id)
  JOIN public.profiles p ON p.user_id=l.user_id
  LEFT JOIN LATERAL (
    SELECT x.id,x.assignee_user_id FROM public.contact_center_message_assignments x
    JOIN scoped sm ON sm.id=x.source_message_id
    WHERE sm.user_id=l.user_id AND x.resolved_at IS NULL ORDER BY x.assigned_at DESC,x.id DESC LIMIT 1
  ) a ON true LEFT JOIN public.profiles ap ON ap.user_id=a.assignee_user_id
  WHERE (NOT p_unread_only OR c.unread_count>0)
    AND (NULLIF(trim(p_search),'') IS NULL OR p.full_name ILIKE '%'||p_search||'%'
      OR p.telegram_username ILIKE '%'||p_search||'%' OR l.user_id::text=p_search)
  ORDER BY l.created_at DESC,l.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),100) OFFSET GREATEST(COALESCE(p_offset,0),0);
END $$;

-- The same lock is taken BEFORE insertion and by explicit state/assignment actions.
-- An incoming after resolution commits will start a new unanswered work item.
CREATE OR REPLACE FUNCTION public.support_bot_incoming_lock_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.direction='incoming' AND NEW.transport='bot' AND NEW.user_id IS NOT NULL
    AND NEW.business_account_id IS NULL AND NEW.business_connection_id IS NULL
    AND public.support_bot_allowed_v1(NEW.bot_id) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('support-bot:'||NEW.user_id::text||':'||NEW.bot_id::text,0));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS support_bot_incoming_lock ON public.telegram_messages;
CREATE TRIGGER support_bot_incoming_lock BEFORE INSERT ON public.telegram_messages
FOR EACH ROW EXECUTE FUNCTION public.support_bot_incoming_lock_v1();

CREATE OR REPLACE FUNCTION public.support_bot_set_state_v1(
  p_user_id uuid,p_bot_id uuid,p_observed_incoming_id uuid,p_action text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_latest public.telegram_messages%ROWTYPE; v_count integer; v_remaining integer; v_assignments integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','manage'),false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_user_id IS NULL OR p_observed_incoming_id IS NULL OR p_action IS NULL
    OR p_action NOT IN ('resolve','reopen') OR NOT public.support_bot_allowed_v1(p_bot_id) THEN
    RAISE EXCEPTION 'invalid_support_scope' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('support-bot:'||p_user_id::text||':'||p_bot_id::text,0));
  SELECT * INTO v_latest FROM public.telegram_messages m
    WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id AND m.transport='bot'
      AND m.business_account_id IS NULL AND m.business_connection_id IS NULL AND m.direction='incoming'
    ORDER BY m.created_at DESC,m.id DESC LIMIT 1 FOR UPDATE;
  IF v_latest.id IS DISTINCT FROM p_observed_incoming_id THEN
    RAISE EXCEPTION 'support_new_incoming_refresh_required' USING ERRCODE='40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.contact_center_message_assignments a
    JOIN public.telegram_messages m ON m.id=a.source_message_id
    WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id AND m.transport='bot'
      AND m.business_account_id IS NULL AND m.business_connection_id IS NULL
      AND a.resolved_at IS NULL AND a.assignee_user_id<>auth.uid()) THEN
    RAISE EXCEPTION 'support_assigned_to_another_employee' USING ERRCODE='40001';
  END IF;
  IF p_action='resolve' THEN
    UPDATE public.telegram_messages m SET is_read=true,requires_reply=false
    WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id AND m.transport='bot'
      AND m.business_account_id IS NULL AND m.business_connection_id IS NULL AND m.direction='incoming'
      AND (m.created_at,m.id)<=(v_latest.created_at,v_latest.id) AND (m.requires_reply OR NOT m.is_read);
  ELSE
    UPDATE public.telegram_messages SET is_read=false,requires_reply=true WHERE id=v_latest.id AND (is_read OR NOT requires_reply);
  END IF;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF p_action='resolve' THEN
    UPDATE public.contact_center_message_assignments a SET resolved_at=now(),resolved_by_user_id=auth.uid(),updated_at=now()
      FROM public.telegram_messages m WHERE m.id=a.source_message_id AND a.resolved_at IS NULL
        AND m.user_id=p_user_id AND m.bot_id=p_bot_id AND m.transport='bot'
        AND m.business_account_id IS NULL AND m.business_connection_id IS NULL
        AND (m.created_at,m.id)<=(v_latest.created_at,v_latest.id);
    GET DIAGNOSTICS v_assignments=ROW_COUNT;
  END IF;
  SELECT count(*) INTO v_remaining FROM public.telegram_messages m
    WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id AND m.transport='bot'
      AND m.business_account_id IS NULL AND m.business_connection_id IS NULL AND m.direction='incoming'
      AND (m.requires_reply OR NOT m.is_read);
  IF v_count+v_assignments>0 THEN
    INSERT INTO public.audit_logs(action,actor_type,actor_user_id,entity_type,entity_id,meta)
      VALUES('support.bot.'||p_action,'user',auth.uid(),'telegram_message',v_latest.id,
        jsonb_build_object('bot_id',p_bot_id,'observed_incoming_id',v_latest.id,'changed',v_count,'assignments_resolved',v_assignments));
  END IF;
  RETURN jsonb_build_object('changed',v_count,'remaining_unread',v_remaining,'observed_incoming_id',v_latest.id);
END $$;

REVOKE ALL ON FUNCTION public.support_bot_channels_v1() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.support_bot_dialogs_v1(uuid,text,boolean,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.support_bot_messages_v1(uuid,uuid,integer,timestamptz,uuid,integer,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.support_bot_set_state_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.support_bot_incoming_lock_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_bot_channels_v1(),
  public.support_bot_dialogs_v1(uuid,text,boolean,integer,integer),
  public.support_bot_messages_v1(uuid,uuid,integer,timestamptz,uuid,integer,boolean),
  public.support_bot_set_state_v1(uuid,uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.support_bot_assignment_lock_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_user uuid; v_bot uuid; v_source uuid;
BEGIN
  IF TG_OP='DELETE' THEN v_source:=OLD.source_message_id; ELSE v_source:=NEW.source_message_id; END IF;
  IF TG_OP='UPDATE' AND NEW.source_message_id IS DISTINCT FROM OLD.source_message_id THEN
    IF EXISTS(SELECT 1 FROM public.telegram_messages m WHERE m.id IN(OLD.source_message_id,NEW.source_message_id)
      AND m.transport='bot' AND m.business_account_id IS NULL AND m.business_connection_id IS NULL AND public.support_bot_allowed_v1(m.bot_id)) THEN
      RAISE EXCEPTION 'support_assignment_source_immutable';
    END IF;
  END IF;
  SELECT user_id,bot_id INTO v_user,v_bot FROM public.telegram_messages
    WHERE id=v_source AND transport='bot'
      AND business_account_id IS NULL AND business_connection_id IS NULL;
  IF v_user IS NOT NULL AND public.support_bot_allowed_v1(v_bot) THEN
    -- Direct UPDATE/DELETE already owns an assignment row. Never wait on the
    -- advisory lock here: resolve owns advisory first and may need that row.
    IF NOT pg_try_advisory_xact_lock(hashtextextended('support-bot:'||v_user::text||':'||v_bot::text,0)) THEN
      RAISE EXCEPTION 'support_assignment_busy_retry' USING ERRCODE='40001';
    END IF;
    IF EXISTS(SELECT 1 FROM public.support_bot_send_claims WHERE user_id=v_user AND bot_id=v_bot AND status='sending' AND lease_until>clock_timestamp()) THEN
      RAISE EXCEPTION 'support_send_in_progress_retry' USING ERRCODE='40001';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS support_bot_assignment_lock ON public.contact_center_message_assignments;
CREATE TRIGGER support_bot_assignment_lock BEFORE INSERT OR UPDATE OR DELETE ON public.contact_center_message_assignments
FOR EACH ROW EXECUTE FUNCTION public.support_bot_assignment_lock_v1();

CREATE OR REPLACE FUNCTION public.support_bot_assign_v1(
  p_user_id uuid,p_bot_id uuid,p_observed_incoming_id uuid,p_assignee_user_id uuid,p_note text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_latest uuid; v_existing public.contact_center_message_assignments%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','manage'),false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_user_id IS NULL OR p_observed_incoming_id IS NULL OR NOT public.support_bot_allowed_v1(p_bot_id)
    OR NOT COALESCE(public.has_admin_section_access(p_assignee_user_id,'communication','view'),false) THEN
    RAISE EXCEPTION 'invalid_support_assignment' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('support-bot:'||p_user_id::text||':'||p_bot_id::text,0));
  SELECT id INTO v_latest FROM public.telegram_messages m WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id
    AND m.transport='bot' AND m.business_account_id IS NULL AND m.business_connection_id IS NULL AND m.direction='incoming'
    ORDER BY m.created_at DESC,m.id DESC LIMIT 1;
  IF v_latest IS DISTINCT FROM p_observed_incoming_id THEN
    RAISE EXCEPTION 'support_new_incoming_refresh_required' USING ERRCODE='40001';
  END IF;
  SELECT a.* INTO v_existing FROM public.contact_center_message_assignments a
    JOIN public.telegram_messages m ON m.id=a.source_message_id
    WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id AND m.transport='bot'
      AND m.business_account_id IS NULL AND m.business_connection_id IS NULL AND a.resolved_at IS NULL
    ORDER BY a.assigned_at DESC,a.id DESC LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.assignee_user_id IS DISTINCT FROM p_assignee_user_id THEN
      RAISE EXCEPTION 'support_already_assigned' USING ERRCODE='40001';
    END IF;
    RETURN jsonb_build_object('assignment_id',v_existing.id,'created',false);
  END IF;
  INSERT INTO public.contact_center_message_assignments(source,source_message_id,assignee_user_id,assigned_by_user_id,note)
    VALUES('telegram',v_latest,p_assignee_user_id,auth.uid(),NULLIF(left(trim(p_note),1000),'')) RETURNING id INTO v_id;
  RETURN jsonb_build_object('assignment_id',v_id,'created',true);
END $$;

CREATE OR REPLACE FUNCTION public.support_bot_set_reaction_v1(p_bot_id uuid,p_message_id uuid,p_emoji text,p_present boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_user uuid; v_changed integer;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','manage'),false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT public.support_bot_allowed_v1(p_bot_id) OR p_present IS NULL OR p_emoji IS NULL OR length(p_emoji)>20 OR length(p_emoji)=0 THEN
    RAISE EXCEPTION 'invalid_support_reaction' USING ERRCODE='22023';
  END IF;
  SELECT user_id INTO v_user FROM public.telegram_messages WHERE id=p_message_id AND bot_id=p_bot_id
    AND transport='bot' AND business_account_id IS NULL AND business_connection_id IS NULL;
  IF v_user IS NULL THEN RAISE EXCEPTION 'support_message_scope_mismatch' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('support-bot:'||v_user::text||':'||p_bot_id::text,0));
  IF EXISTS(SELECT 1 FROM public.contact_center_message_assignments a JOIN public.telegram_messages m ON m.id=a.source_message_id
    WHERE m.user_id=v_user AND m.bot_id=p_bot_id AND m.transport='bot' AND m.business_account_id IS NULL AND m.business_connection_id IS NULL
      AND a.resolved_at IS NULL AND a.assignee_user_id<>auth.uid()) THEN
    RAISE EXCEPTION 'support_assigned_to_another_employee' USING ERRCODE='40001';
  END IF;
  SELECT id INTO v_id FROM public.telegram_messages WHERE id=p_message_id AND bot_id=p_bot_id
    AND transport='bot' AND business_account_id IS NULL AND business_connection_id IS NULL FOR UPDATE;
  IF v_id IS NULL THEN RAISE EXCEPTION 'support_message_scope_mismatch' USING ERRCODE='22023'; END IF;
  IF p_present THEN
    INSERT INTO public.telegram_message_reactions(message_id,user_id,emoji)
      VALUES(v_id,auth.uid(),p_emoji) ON CONFLICT(message_id,user_id,emoji) DO NOTHING;
  ELSE
    DELETE FROM public.telegram_message_reactions WHERE message_id=v_id AND user_id=auth.uid() AND emoji=p_emoji;
  END IF;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  RETURN jsonb_build_object('changed',v_changed,'present',p_present);
END $$;
REVOKE ALL ON FUNCTION public.support_bot_assignment_lock_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.support_bot_assign_v1(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.support_bot_set_reaction_v1(uuid,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.support_bot_assign_v1(uuid,uuid,uuid,uuid,text),
  public.support_bot_set_reaction_v1(uuid,uuid,text,boolean) TO authenticated;

-- Explicit resolution is independent of the legacy read flag.
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS support_resolved_incoming_id uuid;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS support_resolved_at timestamptz;

-- Web-only tickets must have no bridge configuration or historical Telegram
-- synchronization. Ambiguous tickets are excluded before any content is read.
CREATE OR REPLACE FUNCTION public.support_web_ticket_allowed_v1(p_ticket_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.support_tickets t WHERE t.id=p_ticket_id
   AND t.telegram_bridge_enabled IS FALSE AND t.telegram_user_id IS NULL
   AND t.merged_into_ticket_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM public.ticket_telegram_sync s WHERE s.ticket_id=t.id));
$$;
CREATE OR REPLACE FUNCTION public.support_web_tickets_v1(p_include_closed boolean DEFAULT false,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','view'),false) THEN
   RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT jsonb_build_object('id',t.id,'ticket_number',t.ticket_number,'subject',t.subject,
   'status',t.status,'has_unread_admin',t.has_unread_admin OR (t.status NOT IN('closed','resolved') AND t.support_resolved_at IS NULL),'assigned_to',t.assigned_to)
 FROM public.support_tickets t WHERE public.support_web_ticket_allowed_v1(t.id)
   AND (p_include_closed OR t.status NOT IN('closed','resolved'))
 ORDER BY t.updated_at DESC,t.id DESC LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),100) OFFSET GREATEST(COALESCE(p_offset,0),0);
END $$;
CREATE OR REPLACE FUNCTION public.support_web_messages_v1(p_ticket_id uuid)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','view'),false) THEN
   RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF NOT public.support_web_ticket_allowed_v1(p_ticket_id) THEN RAISE EXCEPTION 'web_ticket_scope_not_verified' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT to_jsonb(m) FROM public.ticket_messages m WHERE m.ticket_id=p_ticket_id ORDER BY m.created_at,m.id;
END $$;
-- Direct inserts and the existing send RPC share the ticket-row lock with
-- explicit state changes. A later incoming therefore reopens the work item.
CREATE OR REPLACE FUNCTION public.support_web_incoming_lock_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.author_type='user' THEN
   PERFORM 1 FROM public.support_tickets WHERE id=NEW.ticket_id FOR UPDATE;
   IF public.support_web_ticket_allowed_v1(NEW.ticket_id) THEN
     UPDATE public.support_tickets SET has_unread_admin=true,support_resolved_incoming_id=NULL,support_resolved_at=NULL,
       status=CASE WHEN status IN('closed','resolved') THEN 'open' ELSE status END,
       closed_at=NULL,resolved_at=NULL WHERE id=NEW.ticket_id;
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS support_web_incoming_lock ON public.ticket_messages;
CREATE TRIGGER support_web_incoming_lock BEFORE INSERT ON public.ticket_messages
FOR EACH ROW EXECUTE FUNCTION public.support_web_incoming_lock_v1();
CREATE OR REPLACE FUNCTION public.send_support_web_message_v1(
 p_ticket_id uuid,p_message text,p_attachments jsonb DEFAULT '[]'::jsonb,
 p_is_internal boolean DEFAULT false,p_display_user_id uuid DEFAULT NULL,p_observed_incoming_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_ticket public.support_tickets%ROWTYPE; v_latest uuid; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','manage'),false) THEN
   RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_ticket FROM public.support_tickets WHERE id=p_ticket_id FOR UPDATE;
 IF NOT public.support_web_ticket_allowed_v1(p_ticket_id) THEN RAISE EXCEPTION 'web_ticket_scope_not_verified' USING ERRCODE='22023'; END IF;
 IF v_ticket.assigned_to IS NOT NULL AND v_ticket.assigned_to<>auth.uid() THEN RAISE EXCEPTION 'support_assigned_to_another_employee' USING ERRCODE='40001'; END IF;
 IF v_ticket.status IN('closed','resolved') THEN RAISE EXCEPTION 'ticket_closed' USING ERRCODE='22023'; END IF;
 SELECT id INTO v_latest FROM public.ticket_messages WHERE ticket_id=p_ticket_id AND author_type='user' ORDER BY created_at DESC,id DESC LIMIT 1;
 IF v_latest IS DISTINCT FROM p_observed_incoming_id THEN RAISE EXCEPTION 'support_new_incoming_refresh_required' USING ERRCODE='40001'; END IF;
 v_result := public.send_ticket_message_v2(p_ticket_id,p_message,p_attachments,p_is_internal,p_display_user_id);
 UPDATE public.support_tickets SET has_unread_admin=(v_ticket.support_resolved_at IS NULL
   OR v_ticket.support_resolved_incoming_id IS DISTINCT FROM v_latest) WHERE id=p_ticket_id;
 RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.support_web_set_state_v1(p_ticket_id uuid,p_observed_incoming_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_ticket public.support_tickets%ROWTYPE; v_latest uuid; v_count integer;
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','manage'),false) THEN
   RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN('resolve','reopen','close') THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_ticket FROM public.support_tickets WHERE id=p_ticket_id FOR UPDATE;
 IF NOT public.support_web_ticket_allowed_v1(p_ticket_id) THEN RAISE EXCEPTION 'web_ticket_scope_not_verified' USING ERRCODE='22023'; END IF;
 IF v_ticket.assigned_to IS NOT NULL AND v_ticket.assigned_to<>auth.uid() THEN RAISE EXCEPTION 'support_assigned_to_another_employee' USING ERRCODE='40001'; END IF;
 SELECT id INTO v_latest FROM public.ticket_messages WHERE ticket_id=p_ticket_id AND author_type='user' ORDER BY created_at DESC,id DESC LIMIT 1;
 IF v_latest IS DISTINCT FROM p_observed_incoming_id THEN RAISE EXCEPTION 'support_new_incoming_refresh_required' USING ERRCODE='40001'; END IF;
 IF p_action='close' AND (v_ticket.support_resolved_at IS NULL OR v_ticket.support_resolved_incoming_id IS DISTINCT FROM v_latest) THEN
   RAISE EXCEPTION 'resolve_all_questions_before_close' USING ERRCODE='22023'; END IF;
 UPDATE public.support_tickets SET has_unread_admin=(p_action='reopen'),
   support_resolved_at=CASE WHEN p_action='resolve' THEN COALESCE(support_resolved_at,now()) WHEN p_action='reopen' THEN NULL ELSE support_resolved_at END,
   support_resolved_incoming_id=CASE WHEN p_action='resolve' THEN v_latest WHEN p_action='reopen' THEN NULL ELSE support_resolved_incoming_id END,
   status=CASE WHEN p_action='close' THEN 'closed' WHEN p_action='reopen' AND status IN('closed','resolved') THEN 'open' ELSE status END,
   closed_at=CASE WHEN p_action='close' THEN COALESCE(closed_at,now()) WHEN p_action='reopen' THEN NULL ELSE closed_at END
 WHERE id=p_ticket_id AND ((p_action='resolve' AND (support_resolved_at IS NULL OR support_resolved_incoming_id IS DISTINCT FROM v_latest)) OR (p_action='reopen' AND support_resolved_at IS NOT NULL) OR has_unread_admin IS DISTINCT FROM (p_action='reopen') OR (p_action='close' AND status<>'closed') OR (p_action='reopen' AND status IN('closed','resolved')));
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count>0 THEN INSERT INTO public.audit_logs(action,actor_type,actor_user_id,entity_type,entity_id,meta)
   VALUES('support.web.'||p_action,'user',auth.uid(),'support_ticket',p_ticket_id,jsonb_build_object('observed_incoming_id',v_latest)); END IF;
 RETURN jsonb_build_object('changed',v_count,'has_unread_admin',p_action='reopen');
END $$;
REVOKE ALL ON FUNCTION public.support_web_ticket_allowed_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.support_web_tickets_v1(boolean,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.support_web_messages_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.support_web_incoming_lock_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.send_support_web_message_v1(uuid,text,jsonb,boolean,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.support_web_set_state_v1(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.support_web_ticket_allowed_v1(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.support_web_tickets_v1(boolean,integer,integer),
 public.support_web_messages_v1(uuid),public.send_support_web_message_v1(uuid,text,jsonb,boolean,uuid,uuid),
 public.support_web_set_state_v1(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.support_bot_reactions_v1(p_bot_id uuid,p_message_ids uuid[])
RETURNS TABLE(message_id uuid,emoji text,user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','view'),false) THEN
   RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF NOT public.support_bot_allowed_v1(p_bot_id) OR p_message_ids IS NULL OR cardinality(p_message_ids) NOT BETWEEN 1 AND 200
   OR (SELECT count(*) FROM public.telegram_messages m WHERE m.id=ANY(p_message_ids) AND m.bot_id=p_bot_id
     AND m.transport='bot' AND m.business_account_id IS NULL AND m.business_connection_id IS NULL)<>cardinality(p_message_ids) THEN
   RAISE EXCEPTION 'support_message_scope_mismatch' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT r.message_id,r.emoji,r.user_id FROM public.telegram_message_reactions r WHERE r.message_id=ANY(p_message_ids);
END $$;
CREATE OR REPLACE FUNCTION public.support_web_reactions_v1(p_ticket_id uuid,p_message_ids uuid[])
RETURNS TABLE(message_id uuid,emoji text,user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','view'),false) THEN
   RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF NOT public.support_web_ticket_allowed_v1(p_ticket_id) OR p_message_ids IS NULL OR cardinality(p_message_ids) NOT BETWEEN 1 AND 200
   OR (SELECT count(*) FROM public.ticket_messages m WHERE m.id=ANY(p_message_ids) AND m.ticket_id=p_ticket_id)<>cardinality(p_message_ids) THEN
   RAISE EXCEPTION 'web_ticket_scope_not_verified' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT r.message_id,r.emoji,r.user_id FROM public.ticket_message_reactions r WHERE r.message_id=ANY(p_message_ids);
END $$;
REVOKE ALL ON FUNCTION public.support_bot_reactions_v1(uuid,uuid[]),public.support_web_reactions_v1(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.support_bot_reactions_v1(uuid,uuid[]),public.support_web_reactions_v1(uuid,uuid[]) TO authenticated;

-- A send is authorized once, immediately before the external request. Only the
-- Edge service can create/finish claims; no message body or file is retained here.
CREATE TABLE public.support_bot_send_claims (
  request_id uuid PRIMARY KEY, user_id uuid NOT NULL, bot_id uuid NOT NULL,
  actor_id uuid NOT NULL, observed_incoming_id uuid NOT NULL,
  telegram_user_id bigint NOT NULL, status text NOT NULL DEFAULT 'sending'
    CHECK(status IN ('sending','sent','rejected','uncertain')),
  lease_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz, telegram_message_id bigint
);
ALTER TABLE public.support_bot_send_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_bot_send_claims FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.support_bot_send_claims TO service_role;
CREATE POLICY support_claim_service_read ON public.support_bot_send_claims FOR SELECT TO service_role USING(true);
CREATE INDEX support_bot_send_claims_pending ON public.support_bot_send_claims(user_id,bot_id)
  WHERE status IN ('sending','uncertain');

CREATE OR REPLACE FUNCTION public.support_bot_begin_send_v1(
  p_actor uuid,p_user_id uuid,p_bot_id uuid,p_observed_incoming_id uuid,p_request_id uuid,p_reply_to bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_latest public.telegram_messages%ROWTYPE; v_recipient bigint; v_expiry timestamptz;
BEGIN
  IF p_actor IS NULL OR NOT COALESCE(public.has_admin_section_access(p_actor,'communication','manage'),false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_user_id IS NULL OR p_observed_incoming_id IS NULL OR p_request_id IS NULL OR NOT public.support_bot_allowed_v1(p_bot_id) THEN
    RAISE EXCEPTION 'invalid_support_scope';
  END IF;
  -- Profile changes take this separate binding lock, never the dialog lock.
  -- No profile row lock is taken here (including via outgoing FK insertion).
  PERFORM pg_advisory_xact_lock(hashtextextended('support-binding:'||p_user_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('support-bot:'||p_user_id::text||':'||p_bot_id::text,0));
  IF EXISTS(SELECT 1 FROM public.support_bot_send_claims WHERE request_id=p_request_id) THEN
    RAISE EXCEPTION 'support_send_already_attempted_check_delivery';
  END IF;
  -- Expiry is not proof that Telegram rejected an earlier request. Never retry
  -- an expired/uncertain send blindly; reconcile its delivery first.
  IF EXISTS(SELECT 1 FROM public.support_bot_send_claims WHERE user_id=p_user_id AND bot_id=p_bot_id AND status IN ('sending','uncertain')) THEN
    RAISE EXCEPTION 'support_previous_send_delivery_unknown';
  END IF;
  SELECT * INTO v_latest FROM public.telegram_messages m WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id
    AND m.transport='bot' AND m.business_account_id IS NULL AND m.business_connection_id IS NULL
    AND m.direction='incoming' ORDER BY created_at DESC,id DESC LIMIT 1;
  IF v_latest.id IS DISTINCT FROM p_observed_incoming_id THEN RAISE EXCEPTION 'support_new_incoming_refresh_required' USING ERRCODE='40001'; END IF;
  SELECT telegram_user_id INTO v_recipient FROM public.profiles WHERE user_id=p_user_id;
  IF v_recipient IS NULL OR v_recipient IS DISTINCT FROM v_latest.telegram_user_id THEN RAISE EXCEPTION 'support_recipient_not_verified'; END IF;
  IF EXISTS(SELECT 1 FROM public.contact_center_message_assignments a JOIN public.telegram_messages m ON m.id=a.source_message_id
    WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id AND m.transport='bot'
      AND m.business_account_id IS NULL AND m.business_connection_id IS NULL AND a.resolved_at IS NULL AND a.assignee_user_id<>p_actor) THEN
    RAISE EXCEPTION 'support_assigned_to_another_employee';
  END IF;
  IF p_reply_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.telegram_messages m
    WHERE m.user_id=p_user_id AND m.bot_id=p_bot_id AND m.transport='bot' AND m.telegram_user_id=v_recipient
      AND m.business_account_id IS NULL AND m.business_connection_id IS NULL AND m.message_id=p_reply_to) THEN
    RAISE EXCEPTION 'support_quote_scope_mismatch';
  END IF;
  v_expiry:=clock_timestamp()+interval '90 seconds';
  INSERT INTO public.support_bot_send_claims(request_id,user_id,bot_id,actor_id,observed_incoming_id,telegram_user_id,lease_until)
    VALUES(p_request_id,p_user_id,p_bot_id,p_actor,v_latest.id,v_recipient,v_expiry);
  RETURN jsonb_build_object('request_id',p_request_id,'telegram_user_id',v_recipient::text,'lease_until',v_expiry);
END $$;

CREATE OR REPLACE FUNCTION public.support_bot_finish_send_v1(p_request_id uuid,p_status text,p_telegram_message_id bigint DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_status NOT IN ('sent','rejected','uncertain') OR (p_status='sent' AND p_telegram_message_id IS NULL) THEN RAISE EXCEPTION 'invalid_send_result'; END IF;
  UPDATE public.support_bot_send_claims SET status=p_status,telegram_message_id=p_telegram_message_id,finished_at=clock_timestamp()
    WHERE request_id=p_request_id AND status IN ('sending','uncertain');
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM public.support_bot_send_claims WHERE request_id=p_request_id AND status=p_status
      AND telegram_message_id IS NOT DISTINCT FROM p_telegram_message_id) THEN RETURN; END IF;
    RAISE EXCEPTION 'support_send_claim_not_pending';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.support_bot_begin_send_v1(uuid,uuid,uuid,uuid,uuid,bigint),public.support_bot_finish_send_v1(uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_bot_begin_send_v1(uuid,uuid,uuid,uuid,uuid,bigint),public.support_bot_finish_send_v1(uuid,text,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.support_binding_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.telegram_user_id IS NOT DISTINCT FROM OLD.telegram_user_id AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
  END IF;
  IF OLD.user_id IS NOT NULL THEN
    -- Fail/retry rather than waiting while a profile merge holds other rows.
    IF NOT pg_try_advisory_xact_lock(hashtextextended('support-binding:'||OLD.user_id::text,0)) THEN RAISE EXCEPTION 'support_binding_busy_retry' USING ERRCODE='40001'; END IF;
    IF EXISTS(SELECT 1 FROM public.support_bot_send_claims WHERE user_id=OLD.user_id AND status='sending' AND lease_until>clock_timestamp()) THEN
      RAISE EXCEPTION 'support_send_in_progress_retry' USING ERRCODE='40001';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.support_binding_guard_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER aaa_support_binding_guard BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.support_binding_guard_v1();

CREATE OR REPLACE FUNCTION public.support_bot_upload_v1(p_user_id uuid,p_bot_id uuid,p_path text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_object storage.objects%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_admin_section_access(auth.uid(),'communication','manage'),false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_user_id IS NULL OR NOT public.support_bot_allowed_v1(p_bot_id) OR p_path IS NULL OR p_path NOT LIKE 'outbound/'||p_user_id::text||'/%'
    OR p_path ~ '(^|/)\.\.?(/|$)' OR p_path ~ '[%?#]' OR position(chr(92) in p_path)>0 OR position('//' in p_path)>0 THEN RAISE EXCEPTION 'support_upload_scope_mismatch'; END IF;
  SELECT * INTO v_object FROM storage.objects WHERE bucket_id='telegram-media' AND name=p_path AND archived_at IS NULL;
  IF v_object.id IS NULL OR v_object.owner_id IS DISTINCT FROM auth.uid()::text OR v_object.is_delete_marker THEN RAISE EXCEPTION 'support_upload_owner_not_verified'; END IF;
  RETURN jsonb_build_object('id',v_object.id,'bucket_id',v_object.bucket_id,'name',v_object.name,
    'version',v_object.version,'updated_at',v_object.updated_at,'is_versioned',v_object.is_versioned);
END $$;
REVOKE ALL ON FUNCTION public.support_bot_upload_v1(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.support_bot_upload_v1(uuid,uuid,text) TO authenticated;
