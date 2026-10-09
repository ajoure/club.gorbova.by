-- A bonus channel is independent of every commercial club. Configuration is
-- initially empty; the guarded cutover is a separate managed operation.
CREATE TABLE public.site_questionnaire_bonus_channels (
  page_id uuid NOT NULL REFERENCES public.site_pages(id),
  block_id uuid NOT NULL,
  bot_id uuid NOT NULL REFERENCES public.telegram_bots(id),
  channel_id bigint NOT NULL CHECK(channel_id<0),
  is_enabled boolean NOT NULL DEFAULT false,
  legacy_club_id uuid REFERENCES public.telegram_clubs(id),
  legacy_channel_snapshot jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY(page_id,block_id), UNIQUE(bot_id,channel_id)
);
ALTER TABLE public.site_questionnaire_bonus_channels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_questionnaire_bonus_channels FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.site_questionnaire_bonus_channels TO service_role;
GRANT SELECT ON public.site_questionnaire_bonus_channels TO authenticated;
CREATE POLICY bonus_channel_owner_read ON public.site_questionnaire_bonus_channels FOR SELECT TO authenticated
USING(public.has_role_v2(auth.uid(),'super_admin'));

-- A submitted questionnaire creates a permanent free right, independently of
-- club subscriptions, commercial entitlements and the future page status.
CREATE TABLE public.site_questionnaire_bonus_channel_grants (
  bot_id uuid NOT NULL,
  channel_id bigint NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES public.site_form_submissions(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(bot_id,channel_id,user_id),
  FOREIGN KEY(bot_id,channel_id) REFERENCES public.site_questionnaire_bonus_channels(bot_id,channel_id)
);
ALTER TABLE public.site_questionnaire_bonus_channel_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_questionnaire_bonus_channel_grants FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.site_questionnaire_bonus_channel_grants TO service_role;

CREATE OR REPLACE FUNCTION public.record_site_questionnaire_bonus_channel_grant(p_submission_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO site_questionnaire_bonus_channel_grants(bot_id,channel_id,user_id,submission_id)
  SELECT c.bot_id,c.channel_id,p.user_id,s.id
  FROM site_form_submissions s JOIN profiles p ON p.id=s.profile_id
  JOIN auth.users u ON u.id=p.user_id
  JOIN site_questionnaire_bonus_channels c ON c.page_id=s.page_id AND c.block_id::text=s.metadata->>'block_id'
  WHERE s.id=p_submission_id AND s.status='processed' AND s.metadata->>'questionnaire_first'='true'
    AND s.metadata->>'user_id'=p.user_id::text AND c.is_enabled
    AND p.status='active' AND NOT coalesce(p.is_archived,false) AND p.merged_to_profile_id IS NULL
    AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
  ON CONFLICT(bot_id,channel_id,user_id) DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.record_site_questionnaire_bonus_channel_grant(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_site_questionnaire_bonus_channel_grant(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.site_questionnaire_bonus_channel_grant_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM record_site_questionnaire_bonus_channel_grant(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.site_questionnaire_bonus_channel_grant_trigger() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER site_questionnaire_bonus_channel_grant
AFTER INSERT ON public.site_form_submissions FOR EACH ROW
EXECUTE FUNCTION public.site_questionnaire_bonus_channel_grant_trigger();

CREATE OR REPLACE FUNCTION public.resolve_site_questionnaire_bonus_join(p_bot_id uuid,p_channel_id bigint,p_telegram_user_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_config public.site_questionnaire_bonus_channels%ROWTYPE; v_user uuid; v_profile uuid;
BEGIN
  SELECT * INTO v_config FROM site_questionnaire_bonus_channels WHERE bot_id=p_bot_id AND channel_id=p_channel_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('configured',false,'eligible',false); END IF;
  -- Even a paused route remains reserved, preventing automatic commercial rebind.
  IF v_config.is_enabled AND NOT EXISTS(SELECT 1 FROM telegram_clubs WHERE chat_id=p_channel_id OR channel_id=p_channel_id)
    AND EXISTS(SELECT 1 FROM telegram_bots WHERE id=p_bot_id AND status='active' AND is_primary) THEN
    SELECT p.user_id,p.id INTO v_user,v_profile FROM profiles p JOIN auth.users u ON u.id=p.user_id
    WHERE p.telegram_user_id=p_telegram_user_id AND p.telegram_link_bot_id=p_bot_id AND p.telegram_link_status='active'
      AND p.status='active' AND NOT coalesce(p.is_archived,false) AND p.merged_to_profile_id IS NULL
      AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
      AND EXISTS(SELECT 1 FROM telegram_access_audit a WHERE a.user_id=p.user_id AND a.telegram_user_id=p.telegram_user_id
        AND a.event_type IN ('telegram_link_confirmed','telegram_relink') AND a.meta->>'bot_id'=p_bot_id::text
        AND a.created_at>=p.telegram_linked_at-interval '5 seconds')
      AND EXISTS(SELECT 1 FROM site_questionnaire_bonus_channel_grants g WHERE g.user_id=p.user_id
        AND g.bot_id=p_bot_id AND g.channel_id=p_channel_id);
  END IF;
  RETURN jsonb_build_object('configured',true,'eligible',v_user IS NOT NULL,'page_id',v_config.page_id,
    'block_id',v_config.block_id,'bot_id',v_config.bot_id,'channel_id',v_config.channel_id,'user_id',v_user);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_site_questionnaire_bonus_join(uuid,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_site_questionnaire_bonus_join(uuid,bigint,bigint) TO service_role;

-- This function does not call Telegram or grant any membership. It moves one
-- confirmed, disabled commercial mapping into its independent questionnaire route.
CREATE OR REPLACE FUNCTION public.configure_cb21_bonus_channel(p_expected_grants integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_club public.telegram_clubs%ROWTYPE; v_count integer; v_existing public.site_questionnaire_bonus_channels%ROWTYPE;
  v_submission uuid; v_grants integer := 0;
BEGIN
  IF p_expected_grants IS NULL OR p_expected_grants<0 THEN RAISE EXCEPTION 'bonus_channel_expected_count_required' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('configure_cb21_bonus_channel',0));
  SELECT * INTO v_club FROM telegram_clubs WHERE id='4f8f9d8f-07ce-4898-8012-39f1035c1456' FOR UPDATE;
  IF NOT FOUND OR v_club.bot_id IS DISTINCT FROM '1a560e98-574e-4fd9-82ab-4b7bbdc300b4'::uuid
    OR v_club.channel_grant_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'bonus_channel_source_changed' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM site_questionnaire_bonus_channels
    WHERE page_id='c8c5c19a-a10d-4f6b-8049-449f37230ed0' AND block_id='7f144dcc-1a71-4225-8399-efd4d91502cd' FOR UPDATE;
  IF FOUND THEN
    IF v_club.channel_id IS NOT NULL OR v_existing.channel_id IS DISTINCT FROM -1002091043395::bigint
      OR v_existing.bot_id IS DISTINCT FROM v_club.bot_id OR v_existing.legacy_club_id IS DISTINCT FROM v_club.id
      OR EXISTS(SELECT 1 FROM telegram_clubs WHERE channel_id=-1002091043395 OR chat_id=-1002091043395) THEN
      RAISE EXCEPTION 'bonus_channel_cutover_conflict' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('changed_clubs',0,'changed_routes',0,'replayed',true);
  END IF;
  SELECT count(*) INTO v_count FROM telegram_clubs WHERE channel_id=-1002091043395 OR chat_id=-1002091043395;
  IF v_count<>1 OR v_club.channel_id IS DISTINCT FROM -1002091043395::bigint THEN
    RAISE EXCEPTION 'bonus_channel_mapping_ambiguous' USING ERRCODE='22023';
  END IF;
  INSERT INTO site_questionnaire_bonus_channels(page_id,block_id,bot_id,channel_id,is_enabled,legacy_club_id,legacy_channel_snapshot)
  VALUES('c8c5c19a-a10d-4f6b-8049-449f37230ed0','7f144dcc-1a71-4225-8399-efd4d91502cd',v_club.bot_id,-1002091043395,true,v_club.id,
    jsonb_build_object('channel_id',v_club.channel_id,'channel_invite_link',v_club.channel_invite_link,'channel_grant_enabled',v_club.channel_grant_enabled));
  UPDATE telegram_clubs SET channel_id=NULL,channel_invite_link=NULL WHERE id=v_club.id AND channel_id=-1002091043395 AND channel_grant_enabled=false;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION 'bonus_channel_cutover_rowcount' USING ERRCODE='22023'; END IF;
  FOR v_submission IN SELECT id FROM site_form_submissions
    WHERE page_id='c8c5c19a-a10d-4f6b-8049-449f37230ed0' AND status='processed'
      AND metadata->>'block_id'='7f144dcc-1a71-4225-8399-efd4d91502cd' AND metadata->>'questionnaire_first'='true' LOOP
    v_grants := v_grants+record_site_questionnaire_bonus_channel_grant(v_submission);
  END LOOP;
  IF v_grants<>p_expected_grants THEN RAISE EXCEPTION 'bonus_channel_grant_rowcount' USING ERRCODE='22023'; END IF;
  INSERT INTO audit_logs(action,actor_type,actor_label,entity_type,entity_id,meta)
  VALUES('site_questionnaire.bonus_channel_detached','system','managed-deployment','telegram_club',v_club.id::text,
    jsonb_build_object('changed_clubs',1,'changed_routes',1,'channel_id',-1002091043395,'purchases_changed',0,'members_changed',0));
  RETURN jsonb_build_object('changed_clubs',1,'changed_routes',1,'granted_users',v_grants,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.configure_cb21_bonus_channel(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_cb21_bonus_channel(integer) TO service_role;
