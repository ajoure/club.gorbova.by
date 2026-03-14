
-- PHASE 9: Fix v_club_members_enriched to be resource-mode aware
-- in_any must respect club's resource config (chat-only, channel-only, chat+channel)

CREATE OR REPLACE VIEW public.v_club_members_enriched AS
SELECT 
    tcm.id,
    tcm.club_id,
    tcm.telegram_user_id,
    tcm.telegram_username,
    tcm.telegram_first_name,
    tcm.telegram_last_name,
    tcm.in_chat,
    tcm.in_channel,
    tcm.profile_id,
    tcm.link_status,
    tcm.access_status,
    tcm.created_at,
    tcm.updated_at,
    p.user_id AS auth_user_id,
    p.email,
    p.full_name,
    p.phone,
    p.external_id_amo,
    CASE
        WHEN p.user_id IS NULL THEN false
        ELSE has_valid_access_for_club(p.user_id, tcm.club_id)
    END AS has_active_access,
    CASE
        WHEN p.user_id IS NULL THEN false
        ELSE (EXISTS ( SELECT 1
           FROM telegram_access ta
          WHERE ta.user_id = p.user_id AND ta.club_id = tcm.club_id)) OR (EXISTS ( SELECT 1
           FROM telegram_manual_access tma
          WHERE tma.user_id = p.user_id AND tma.club_id = tcm.club_id)) OR (EXISTS ( SELECT 1
           FROM telegram_access_grants tag
          WHERE tag.user_id = p.user_id AND tag.club_id = tcm.club_id))
    END AS has_any_access_history,
    -- PHASE 9: Resource-mode aware in_any
    -- chat-only club (channel_id IS NULL): only in_chat matters
    -- channel-only club (chat_id IS NULL): only in_channel matters  
    -- chat+channel: either one
    CASE
        WHEN tc.channel_id IS NULL THEN COALESCE(tcm.in_chat, false)
        WHEN tc.chat_id IS NULL THEN COALESCE(tcm.in_channel, false)
        ELSE COALESCE(tcm.in_chat, false) OR COALESCE(tcm.in_channel, false)
    END AS in_any,
    tcm.telegram_user_id IS NULL OR tcm.telegram_user_id < 100 AS is_orphaned
FROM telegram_club_members tcm
LEFT JOIN profiles p ON p.id = tcm.profile_id
LEFT JOIN telegram_clubs tc ON tc.id = tcm.club_id;
