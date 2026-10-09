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

-- Free channel membership is open through the two shared invitation links.
-- A forwarded link does not require an account or questionnaire. Commercial
-- subscriptions and Telegram linking are intentionally not eligibility gates.
CREATE OR REPLACE FUNCTION public.resolve_site_questionnaire_bonus_join(p_bot_id uuid,p_channel_id bigint,p_telegram_user_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_config public.site_questionnaire_bonus_channels%ROWTYPE;
BEGIN
  SELECT * INTO v_config FROM site_questionnaire_bonus_channels WHERE bot_id=p_bot_id AND channel_id=p_channel_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('configured',false,'eligible',false); END IF;
  RETURN jsonb_build_object('configured',true,'eligible',v_config.is_enabled
    AND NOT EXISTS(SELECT 1 FROM telegram_clubs WHERE chat_id=p_channel_id OR channel_id=p_channel_id)
    AND EXISTS(SELECT 1 FROM telegram_bots WHERE id=p_bot_id AND status='active' AND is_primary),
    'page_id',v_config.page_id,'block_id',v_config.block_id,'bot_id',v_config.bot_id,'channel_id',v_config.channel_id);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_site_questionnaire_bonus_join(uuid,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_site_questionnaire_bonus_join(uuid,bigint,bigint) TO service_role;

-- This function does not call Telegram or grant any membership. It moves one
-- confirmed, disabled commercial mapping into its independent questionnaire route.
CREATE OR REPLACE FUNCTION public.configure_cb21_bonus_channel(p_expected_mappings integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_club public.telegram_clubs%ROWTYPE; v_count integer; v_existing public.site_questionnaire_bonus_channels%ROWTYPE;
BEGIN
  IF p_expected_mappings IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'bonus_channel_expected_count_required' USING ERRCODE='22023'; END IF;
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
  INSERT INTO audit_logs(action,actor_type,actor_label,entity_type,entity_id,meta)
  VALUES('site_questionnaire.bonus_channel_detached','system','managed-deployment','telegram_club',v_club.id::text,
    jsonb_build_object('changed_clubs',1,'changed_routes',1,'channel_id',-1002091043395,'purchases_changed',0,'members_changed',0));
  RETURN jsonb_build_object('changed_clubs',1,'changed_routes',1,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.configure_cb21_bonus_channel(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_cb21_bonus_channel(integer) TO service_role;
