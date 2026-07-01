-- 1) Разблокировать гостевой профиль Пряжко Николаевны (освободить telegram_user_id)
UPDATE public.profiles
SET telegram_user_id = NULL,
    telegram_username = NULL,
    telegram_linked_at = NULL,
    telegram_link_status = 'unlinked',
    telegram_last_error = 'released_for_real_account_link'
WHERE id = 'ea652f46-75e0-4bad-abe3-493a2634c0d9'
  AND user_id IS NULL;

-- 2) Админский RPC: сбросить Telegram-привязку у профиля контакта.
--    Работает и для гостевых (user_id IS NULL) и для настоящих аккаунтов.
CREATE OR REPLACE FUNCTION public.admin_reset_user_telegram(_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_tg_id bigint;
  v_prev_username text;
  v_user_id uuid;
BEGIN
  -- Только staff. Используем существующий has_role_v2 если есть, иначе has_role.
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'employee')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT telegram_user_id, telegram_username, user_id
    INTO v_prev_tg_id, v_prev_username, v_user_id
  FROM public.profiles
  WHERE id = _profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.profiles
  SET telegram_user_id = NULL,
      telegram_username = NULL,
      telegram_linked_at = NULL,
      telegram_link_status = 'unlinked',
      telegram_last_error = 'admin_reset'
  WHERE id = _profile_id;

  BEGIN
    INSERT INTO public.telegram_logs(user_id, action, target, status, meta)
    VALUES (
      v_user_id,
      'ADMIN_TG_RESET',
      'profile',
      'ok',
      jsonb_build_object(
        'profile_id', _profile_id,
        'previous_telegram_user_id', v_prev_tg_id,
        'previous_telegram_username', v_prev_username,
        'actor', auth.uid()
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- лог не критичен
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'profile_id', _profile_id,
    'previous_telegram_user_id', v_prev_tg_id,
    'previous_telegram_username', v_prev_username
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_user_telegram(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_telegram(uuid) TO authenticated, service_role;