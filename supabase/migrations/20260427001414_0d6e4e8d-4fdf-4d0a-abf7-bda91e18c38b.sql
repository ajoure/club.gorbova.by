-- =========================================================
-- v5.1 — Resolver of final_status + verified-guard for Telegram clubs
-- Add-only. No existing functions/policies modified.
-- =========================================================

-- 1) Enum для итогового статуса проверки доступа
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'club_member_final_status') THEN
    CREATE TYPE public.club_member_final_status AS ENUM (
      'verified_paid',
      'verified_staff',
      'pending_review',
      'no_valid_access',
      'mismatch',
      'duplicate_tg',
      'orphan',
      'removed'
    );
  END IF;
END$$;

-- 2) Резолвер: для пары (club_id, tg_id) возвращает один final_status
--    и подробности (для UI/CSV/audit).
CREATE OR REPLACE FUNCTION public.compute_club_member_final_status(
  _club_id uuid,
  _tg_id   bigint
)
RETURNS TABLE (
  final_status        public.club_member_final_status,
  reason              text,
  profile_id          uuid,
  user_id             uuid,
  email               text,
  full_name           text,
  telegram_username   text,
  tg_id_in_chat       bigint,
  tg_id_in_profile    bigint,
  link_check          text,
  entitlement_status  text,
  subscription_status text,
  manual_access       boolean,
  staff_role          text,
  in_chat             boolean,
  access_status       text,
  product_id          uuid,
  club_id             uuid,
  telegram_chat_id    bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member       record;
  v_club         record;
  v_profile      record;
  v_product_id   uuid;
  v_ent_status   text;
  v_sub_status   text;
  v_staff_role   text;
  v_manual       boolean := false;
  v_dup_count    int := 0;
BEGIN
  -- Клуб + связанный продукт через product_club_mappings (Club-as-SoT)
  SELECT c.id, c.chat_id
    INTO v_club
  FROM public.telegram_clubs c
  WHERE c.id = _club_id;

  IF v_club.id IS NULL THEN
    final_status := 'orphan';
    reason       := 'unknown_club';
    club_id      := _club_id;
    tg_id_in_chat:= _tg_id;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT pcm.product_id
    INTO v_product_id
  FROM public.product_club_mappings pcm
  WHERE pcm.club_id = _club_id
    AND pcm.is_active = true
  ORDER BY pcm.created_at ASC
  LIMIT 1;

  -- Запись участника в клубе
  SELECT m.*
    INTO v_member
  FROM public.telegram_club_members m
  WHERE m.club_id = _club_id
    AND m.telegram_user_id = _tg_id
  LIMIT 1;

  IF v_member.id IS NULL THEN
    final_status   := 'orphan';
    reason         := 'not_in_member_table';
    club_id        := _club_id;
    tg_id_in_chat  := _tg_id;
    telegram_chat_id := v_club.chat_id;
    product_id     := v_product_id;
    RETURN NEXT;
    RETURN;
  END IF;

  in_chat        := v_member.in_chat;
  access_status  := v_member.access_status;
  tg_id_in_chat  := v_member.telegram_user_id;
  telegram_username := v_member.telegram_username;
  full_name := COALESCE(v_member.telegram_first_name,'')
            || CASE WHEN v_member.telegram_last_name IS NOT NULL
                    THEN ' '||v_member.telegram_last_name ELSE '' END;
  club_id          := _club_id;
  telegram_chat_id := v_club.chat_id;
  product_id       := v_product_id;

  -- removed — особый случай
  IF v_member.access_status = 'removed' THEN
    final_status := 'removed';
    reason       := 'access_status_removed';
    profile_id   := v_member.profile_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Профиль
  IF v_member.profile_id IS NULL THEN
    final_status := 'orphan';
    reason       := 'no_profile_link';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT p.id, p.user_id, p.email, p.telegram_user_id, p.full_name
    INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_member.profile_id;

  profile_id        := v_profile.id;
  user_id           := v_profile.user_id;
  email             := v_profile.email;
  tg_id_in_profile  := v_profile.telegram_user_id;
  IF v_profile.full_name IS NOT NULL AND v_profile.full_name <> '' THEN
    full_name := v_profile.full_name;
  END IF;

  -- link_check
  IF v_profile.telegram_user_id IS NULL THEN
    link_check := 'profile_no_tg';
  ELSIF v_profile.telegram_user_id = v_member.telegram_user_id THEN
    link_check := 'match';
  ELSE
    link_check := 'mismatch';
  END IF;

  -- duplicate_tg: тот же profile_id привязан к другому tg_id, который тоже в чате
  SELECT COUNT(*) INTO v_dup_count
  FROM public.telegram_club_members m2
  WHERE m2.club_id = _club_id
    AND m2.profile_id = v_member.profile_id
    AND m2.in_chat = true
    AND m2.telegram_user_id <> v_member.telegram_user_id;

  -- staff role
  SELECT ur.role::text
    INTO v_staff_role
  FROM public.user_roles ur
  WHERE ur.user_id = v_profile.user_id
    AND ur.role IN ('admin','super_admin')
  LIMIT 1;

  -- manual access overlay (через entitlements.meta.source='staff_manual')
  IF v_product_id IS NOT NULL THEN
    SELECT true INTO v_manual
    FROM public.entitlements e
    WHERE e.user_id = v_profile.user_id
      AND e.product_id = v_product_id
      AND e.status = 'active'
      AND COALESCE(e.meta->>'source','') = 'staff_manual'
      AND (e.expires_at IS NULL OR e.expires_at > now())
    LIMIT 1;
    v_manual := COALESCE(v_manual, false);
  END IF;

  manual_access := v_manual;
  staff_role    := v_staff_role;

  -- entitlement / subscription для продукта клуба
  IF v_product_id IS NOT NULL THEN
    SELECT e.status::text INTO v_ent_status
    FROM public.entitlements e
    WHERE e.user_id = v_profile.user_id
      AND e.product_id = v_product_id
      AND (e.expires_at IS NULL OR e.expires_at > now())
    ORDER BY (e.status = 'active') DESC, e.expires_at DESC NULLS LAST
    LIMIT 1;

    SELECT s.status::text INTO v_sub_status
    FROM public.subscriptions_v2 s
    WHERE s.user_id = v_profile.user_id
      AND s.product_id = v_product_id
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
    ORDER BY (s.status::text = 'active') DESC, s.access_end_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  entitlement_status  := v_ent_status;
  subscription_status := v_sub_status;

  -- ====== классификация (порядок важен) ======

  -- 1) mismatch перевешивает всё, кроме removed/orphan
  IF link_check = 'mismatch' THEN
    final_status := 'mismatch';
    reason       := format('profile.tg_id=%s ≠ chat.tg_id=%s',
                           v_profile.telegram_user_id, v_member.telegram_user_id);
    RETURN NEXT;
    RETURN;
  END IF;

  -- 2) staff (роль или manual overlay)
  IF v_staff_role IS NOT NULL OR v_manual THEN
    final_status := 'verified_staff';
    reason       := COALESCE(v_staff_role, 'manual_staff_grant');
    RETURN NEXT;
    RETURN;
  END IF;

  -- 3) verified_paid: link match + (active ent ИЛИ active sub)
  IF link_check = 'match'
     AND (v_ent_status = 'active' OR v_sub_status = 'active') THEN

    -- duplicate перевешивает paid: второй tg того же профиля = кандидат на kick
    IF v_dup_count > 0 THEN
      final_status := 'duplicate_tg';
      reason       := format('profile_id=%s имеет %s других tg_id в чате', v_profile.id, v_dup_count);
      RETURN NEXT;
      RETURN;
    END IF;

    final_status := 'verified_paid';
    reason       := format('ent=%s sub=%s', COALESCE(v_ent_status,'-'), COALESCE(v_sub_status,'-'));
    RETURN NEXT;
    RETURN;
  END IF;

  -- 4) duplicate без paid
  IF v_dup_count > 0 THEN
    final_status := 'duplicate_tg';
    reason       := format('profile_id=%s имеет %s других tg_id в чате', v_profile.id, v_dup_count);
    RETURN NEXT;
    RETURN;
  END IF;

  -- 5) profile_no_tg → pending_review
  IF link_check = 'profile_no_tg' THEN
    final_status := 'pending_review';
    reason       := 'profile_has_no_tg_id_linked';
    RETURN NEXT;
    RETURN;
  END IF;

  -- 6) match, но нет валидного доступа
  final_status := 'no_valid_access';
  reason       := format('match, no active ent/sub (ent=%s, sub=%s)',
                         COALESCE(v_ent_status,'-'), COALESCE(v_sub_status,'-'));
  RETURN NEXT;
  RETURN;
END;
$$;

-- 3) Whitelist-guard
CREATE OR REPLACE FUNCTION public.is_verified_club_member(
  _club_id uuid,
  _tg_id   bigint
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.club_member_final_status;
BEGIN
  SELECT final_status INTO v_status
  FROM public.compute_club_member_final_status(_club_id, _tg_id)
  LIMIT 1;

  RETURN v_status IN ('verified_paid','verified_staff');
END;
$$;

-- 4) Права
GRANT EXECUTE ON FUNCTION public.compute_club_member_final_status(uuid, bigint)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_verified_club_member(uuid, bigint)
  TO authenticated, service_role;