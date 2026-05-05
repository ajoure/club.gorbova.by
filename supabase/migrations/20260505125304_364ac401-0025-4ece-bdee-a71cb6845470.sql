DROP FUNCTION IF EXISTS public.admin_get_club_memberships_all(uuid);

CREATE OR REPLACE FUNCTION public.admin_get_club_memberships_all(p_profile_id uuid)
 RETURNS TABLE(
   club_id uuid,
   club_name text,
   is_active_club boolean,
   club_has_chat boolean,
   club_has_channel boolean,
   in_chat boolean,
   in_channel boolean,
   telegram_access_status text,
   effective_access_status text,
   linked_product_id uuid,
   linked_product_name text,
   entitlement_id uuid,
   entitlement_status text,
   entitlement_expires_at timestamp with time zone,
   link_status text,
   invite_status text,
   invite_sent_at timestamp with time zone,
   last_telegram_check_at timestamp with time zone,
   last_verified_at timestamp with time zone,
   member_updated_at timestamp with time zone,
   club_last_status_check_at timestamp with time zone,
   club_last_members_sync_at timestamp with time zone
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'entitlements.manage') THEN
    RAISE EXCEPTION 'access denied: entitlements.manage permission required';
  END IF;

  SELECT p.user_id INTO v_user_id FROM public.profiles p WHERE p.id = p_profile_id;

  RETURN QUERY
  WITH club_products AS (
    SELECT
      tcm.club_id      AS cp_club_id,
      ar.product_id    AS cp_product_id
    FROM public.telegram_club_members tcm
    JOIN public.telegram_clubs tc ON tc.id = tcm.club_id
    LEFT JOIN public.access_rules ar
      ON ar.is_active = true
     AND ar.grant_target_type = 'club'
     AND ar.product_id IS NOT NULL
     AND (
       CASE
         WHEN ar.target_ref ~ '^[0-9a-fA-F-]{36}$' THEN ar.target_ref::uuid = tcm.club_id
         ELSE false
       END
     )
    WHERE tcm.profile_id = p_profile_id
      AND tc.is_active = true
  ),
  cp_with_ent AS (
    SELECT
      cp.cp_club_id,
      cp.cp_product_id,
      e.id          AS cp_ent_id,
      e.status      AS cp_ent_status,
      e.expires_at  AS cp_ent_expires_at,
      CASE
        WHEN e.id IS NULL THEN 'missing'
        WHEN COALESCE(e.status::text,'') = 'active' AND (e.expires_at IS NULL OR e.expires_at > now()) THEN 'active'
        WHEN e.expires_at IS NOT NULL AND e.expires_at <= now() THEN 'expired'
        ELSE COALESCE(e.status::text, 'missing')
      END AS cp_effective_status
    FROM club_products cp
    LEFT JOIN public.entitlements e
      ON e.product_id = cp.cp_product_id
     AND v_user_id IS NOT NULL
     AND e.user_id = v_user_id
  ),
  cp_ranked AS (
    SELECT
      cwe.cp_club_id,
      cwe.cp_product_id,
      cwe.cp_ent_id,
      cwe.cp_ent_status,
      cwe.cp_ent_expires_at,
      cwe.cp_effective_status,
      ROW_NUMBER() OVER (
        PARTITION BY cwe.cp_club_id
        ORDER BY
          CASE cwe.cp_effective_status
            WHEN 'active' THEN 0
            WHEN 'expired' THEN 1
            WHEN 'missing' THEN 2
            ELSE 3
          END,
          cwe.cp_ent_expires_at DESC NULLS LAST
      ) AS cp_rn
    FROM cp_with_ent cwe
  ),
  cp_best AS (
    SELECT
      cr.cp_club_id,
      cr.cp_product_id,
      cr.cp_ent_id,
      cr.cp_ent_status,
      cr.cp_ent_expires_at,
      cr.cp_effective_status
    FROM cp_ranked cr
    WHERE cr.cp_rn = 1
  )
  SELECT
    tcm.club_id                                        AS club_id,
    tc.club_name                                       AS club_name,
    tc.is_active                                       AS is_active_club,
    (tc.chat_id IS NOT NULL)                           AS club_has_chat,
    (tc.channel_id IS NOT NULL)                        AS club_has_channel,
    tcm.in_chat                                        AS in_chat,
    tcm.in_channel                                     AS in_channel,
    tcm.access_status::text                            AS telegram_access_status,
    COALESCE(cb.cp_effective_status, 'unknown_product') AS effective_access_status,
    cb.cp_product_id                                   AS linked_product_id,
    pr.name                                            AS linked_product_name,
    cb.cp_ent_id                                       AS entitlement_id,
    cb.cp_ent_status::text                             AS entitlement_status,
    cb.cp_ent_expires_at                               AS entitlement_expires_at,
    tcm.link_status::text                              AS link_status,
    tcm.invite_status::text                            AS invite_status,
    tcm.invite_sent_at                                 AS invite_sent_at,
    tcm.last_telegram_check_at                         AS last_telegram_check_at,
    tcm.last_verified_at                               AS last_verified_at,
    tcm.updated_at                                     AS member_updated_at,
    tc.last_status_check_at                            AS club_last_status_check_at,
    tc.last_members_sync_at                            AS club_last_members_sync_at
  FROM public.telegram_club_members tcm
  JOIN public.telegram_clubs tc ON tc.id = tcm.club_id
  LEFT JOIN cp_best cb ON cb.cp_club_id = tcm.club_id
  LEFT JOIN public.products_v2 pr ON pr.id = cb.cp_product_id
  WHERE tcm.profile_id = p_profile_id
    AND tc.is_active = true
  ORDER BY
    (CASE WHEN tcm.in_chat = TRUE OR tcm.in_channel = TRUE THEN 0 ELSE 1 END) ASC,
    tc.club_name ASC;
END;
$function$;