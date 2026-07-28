-- Phase profile-backfill v1: идемпотентно.
-- 1) Backfill отсутствующих profiles для существующих auth.users.
INSERT INTO public.profiles (user_id, email)
SELECT u.id, u.email
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id = u.id
);

-- 2) Убедиться, что триггер on_auth_user_created существует; если нет — восстановить,
--    используя уже существующую public.handle_new_user (функцию не переписываем).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_auth_user_created'
      AND tgrelid = 'auth.users'::regclass
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'CREATE TRIGGER on_auth_user_created
             AFTER INSERT ON auth.users
             FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()';
  END IF;
END $$;