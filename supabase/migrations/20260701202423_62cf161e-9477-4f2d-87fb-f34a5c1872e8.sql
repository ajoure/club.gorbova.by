-- Освободить Telegram-привязку у импортированной Марии Качуро,
-- чтобы после регистрации она могла привязать свой Telegram-аккаунт.
UPDATE public.profiles
SET telegram_user_id = NULL,
    telegram_username = NULL,
    updated_at = now()
WHERE id = '8ba0e69d-1c66-4b2b-91c4-f2a2898d12d8';