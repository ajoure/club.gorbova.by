-- Private invite journal. Links are returned only to the verified owner of a
-- permanent bonus right; a link alone cannot approve another Telegram identity.
CREATE TABLE public.site_questionnaire_bonus_invites (
  bot_id uuid NOT NULL, channel_id bigint NOT NULL, user_id uuid NOT NULL, telegram_user_id bigint NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK(status IN ('creating','ready','failed')),
  invite_link text UNIQUE, expires_at timestamptz CHECK(expires_at IS NULL), lease_until timestamptz NOT NULL,
  PRIMARY KEY(bot_id,channel_id,user_id),
  FOREIGN KEY(bot_id,channel_id,user_id) REFERENCES public.site_questionnaire_bonus_channel_grants(bot_id,channel_id,user_id) ON DELETE CASCADE
);
ALTER TABLE public.site_questionnaire_bonus_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_questionnaire_bonus_invites FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.prepare_site_questionnaire_bonus_invite(p_page_id uuid,p_block_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_config public.site_questionnaire_bonus_channels%ROWTYPE; v_telegram bigint; v_context jsonb;
  v_invite public.site_questionnaire_bonus_invites%ROWTYPE; v_request uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('site_questionnaire_bonus_invite:'||p_user_id::text,0));
  SELECT * INTO v_config FROM site_questionnaire_bonus_channels WHERE page_id=p_page_id AND block_id=p_block_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT telegram_user_id INTO v_telegram FROM profiles WHERE user_id=p_user_id AND status='active'
    AND NOT coalesce(is_archived,false) AND merged_to_profile_id IS NULL;
  v_context := resolve_site_questionnaire_bonus_join(v_config.bot_id,v_config.channel_id,v_telegram);
  IF v_context->>'eligible' IS DISTINCT FROM 'true' OR v_context->>'user_id' IS DISTINCT FROM p_user_id::text THEN
    RETURN jsonb_build_object('status','ineligible');
  END IF;
  SELECT * INTO v_invite FROM site_questionnaire_bonus_invites
    WHERE bot_id=v_config.bot_id AND channel_id=v_config.channel_id AND user_id=p_user_id FOR UPDATE;
  IF FOUND THEN
    IF v_invite.status='ready' AND v_invite.expires_at IS NULL AND v_invite.telegram_user_id=v_telegram THEN
      RETURN jsonb_build_object('status','ready','invite_link',v_invite.invite_link);
    END IF;
    IF v_invite.status IN ('creating','failed') AND v_invite.lease_until>now() THEN RETURN jsonb_build_object('status','busy'); END IF;
  END IF;
  v_request := gen_random_uuid();
  INSERT INTO site_questionnaire_bonus_invites(bot_id,channel_id,user_id,telegram_user_id,request_id,status,lease_until)
  VALUES(v_config.bot_id,v_config.channel_id,p_user_id,v_telegram,v_request,'creating',now()+interval '90 seconds')
  ON CONFLICT(bot_id,channel_id,user_id) DO UPDATE SET request_id=EXCLUDED.request_id,status='creating',
    telegram_user_id=EXCLUDED.telegram_user_id,invite_link=NULL,expires_at=NULL,lease_until=EXCLUDED.lease_until;
  RETURN jsonb_build_object('status','create','request_id',v_request,'bot_id',v_config.bot_id,'channel_id',v_config.channel_id);
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_site_questionnaire_bonus_invite(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_site_questionnaire_bonus_invite(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_site_questionnaire_bonus_invite(p_request_id uuid,p_user_id uuid,p_invite_link text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer;
BEGIN
  IF p_invite_link IS NOT NULL AND p_invite_link !~ '^https://t[.]me/(\+|joinchat/)[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'bonus_invite_invalid' USING ERRCODE='22023';
  END IF;
  UPDATE site_questionnaire_bonus_invites SET status=CASE WHEN p_invite_link IS NULL THEN 'failed' ELSE 'ready' END,
    invite_link=p_invite_link,expires_at=NULL
    WHERE request_id=p_request_id AND user_id=p_user_id AND status='creating' AND lease_until>now();
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count=1;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_site_questionnaire_bonus_invite(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_site_questionnaire_bonus_invite(uuid,uuid,text) TO service_role;

-- The webhook must check both the applicant identity and the exact invitation.
-- Another eligible questionnaire participant still cannot use this person's link.
CREATE OR REPLACE FUNCTION public.resolve_site_questionnaire_bonus_invite_join(p_bot_id uuid,p_channel_id bigint,p_telegram_user_id bigint,p_invite_link text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_context jsonb;
BEGIN
  v_context := resolve_site_questionnaire_bonus_join(p_bot_id,p_channel_id,p_telegram_user_id);
  IF v_context->>'configured'='true' THEN
    v_context := jsonb_set(v_context,'{eligible}',to_jsonb(
      v_context->>'eligible'='true' AND EXISTS(SELECT 1 FROM site_questionnaire_bonus_invites i
        WHERE i.bot_id=p_bot_id AND i.channel_id=p_channel_id AND i.telegram_user_id=p_telegram_user_id
          AND i.user_id::text=v_context->>'user_id' AND i.status='ready' AND i.expires_at IS NULL
          AND i.invite_link=p_invite_link)));
  END IF;
  RETURN v_context;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_site_questionnaire_bonus_invite_join(uuid,bigint,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_site_questionnaire_bonus_invite_join(uuid,bigint,bigint,text) TO service_role;
