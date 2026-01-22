-- VIEW: v_club_members_enriched
-- Вычисляет все флаги A-G для участников клуба
CREATE OR REPLACE VIEW v_club_members_enriched AS
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
  
  -- (A) has_active_access: активный доступ сейчас
  (
    EXISTS (SELECT 1 FROM telegram_access ta 
            WHERE ta.user_id = p.user_id AND ta.club_id = tcm.club_id
              AND (ta.active_until IS NULL OR ta.active_until > NOW()))
    OR EXISTS (SELECT 1 FROM telegram_access_grants tag 
               WHERE tag.user_id = p.user_id AND tag.club_id = tcm.club_id
                 AND tag.status = 'active' 
                 AND (tag.end_at IS NULL OR tag.end_at > NOW()))
    OR EXISTS (SELECT 1 FROM telegram_manual_access tma 
               WHERE tma.user_id = p.user_id AND tma.club_id = tcm.club_id
                 AND tma.is_active = true 
                 AND (tma.valid_until IS NULL OR tma.valid_until > NOW()))
  ) AS has_active_access,
  
  -- (B) has_any_access_history: любая история доступа
  (
    EXISTS (SELECT 1 FROM telegram_access ta WHERE ta.user_id = p.user_id AND ta.club_id = tcm.club_id)
    OR EXISTS (SELECT 1 FROM telegram_access_grants tag WHERE tag.user_id = p.user_id AND tag.club_id = tcm.club_id)
    OR EXISTS (SELECT 1 FROM telegram_manual_access tma WHERE tma.user_id = p.user_id AND tma.club_id = tcm.club_id)
  ) AS has_any_access_history,
  
  -- (C) in_any: фактически в чате/канале
  (COALESCE(tcm.in_chat, false) = true OR COALESCE(tcm.in_channel, false) = true) AS in_any,
  
  -- (G) is_orphaned: нет связи с profile
  (tcm.profile_id IS NULL OR p.id IS NULL) AS is_orphaned

FROM telegram_club_members tcm
LEFT JOIN profiles p ON p.id = tcm.profile_id;

-- RPC: get_club_members_enriched
-- Возвращает участников с вычисленными флагами и scope-фильтрацией
CREATE OR REPLACE FUNCTION get_club_members_enriched(
  p_club_id UUID,
  p_scope TEXT DEFAULT 'relevant'
)
RETURNS TABLE (
  id UUID,
  club_id UUID,
  telegram_user_id BIGINT,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  in_chat BOOLEAN,
  in_channel BOOLEAN,
  profile_id UUID,
  link_status TEXT,
  access_status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  auth_user_id UUID,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  has_active_access BOOLEAN,
  has_any_access_history BOOLEAN,
  in_any BOOLEAN,
  is_orphaned BOOLEAN,
  is_violator BOOLEAN,
  is_bought_not_joined BOOLEAN,
  is_relevant BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.club_id,
    v.telegram_user_id,
    v.telegram_username,
    v.telegram_first_name,
    v.telegram_last_name,
    v.in_chat,
    v.in_channel,
    v.profile_id,
    v.link_status,
    v.access_status,
    v.created_at,
    v.updated_at,
    v.auth_user_id,
    v.email,
    v.full_name,
    v.phone,
    v.has_active_access,
    v.has_any_access_history,
    v.in_any,
    v.is_orphaned,
    -- (E) is_violator: в клубе без active access
    (v.in_any AND NOT COALESCE(v.has_active_access, false)) AS is_violator,
    -- (F) is_bought_not_joined: есть access, но не в клубе
    (COALESCE(v.has_active_access, false) AND NOT v.in_any) AS is_bought_not_joined,
    -- (D) is_relevant: для scope фильтра
    (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)) AS is_relevant
  FROM v_club_members_enriched v
  WHERE v.club_id = p_club_id
    AND (
      p_scope = 'all' 
      OR (
        p_scope = 'relevant' 
        AND NOT COALESCE(v.is_orphaned, false)
        AND (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false))
      )
    )
  ORDER BY 
    v.access_status ASC,
    v.email ASC NULLS LAST,
    v.telegram_username ASC NULLS LAST;
END;
$$;