-- Fix: payment_links_enriched_v возвращал 0 строк через PostgREST,
-- потому что у view не было GRANT SELECT для роли authenticated.
-- RLS на базовой payment_links и security_invoker=on на view — корректны и НЕ меняются.
-- anon намеренно не получает доступ: журнал ссылок не публичный.

GRANT SELECT ON public.payment_links_enriched_v TO authenticated;

-- Подстраховка: если в будущем view пересоздадут, owner и security_invoker должны сохраниться.
-- Здесь только фиксируем текущее состояние, ничего не пересоздаём.
DO $$
DECLARE
  v_opts text;
BEGIN
  SELECT array_to_string(reloptions, ',') INTO v_opts
  FROM pg_class
  WHERE relname = 'payment_links_enriched_v'
    AND relnamespace = 'public'::regnamespace;

  IF v_opts IS NULL OR position('security_invoker=on' in v_opts) = 0 THEN
    RAISE EXCEPTION 'payment_links_enriched_v must have security_invoker=on (current: %)', v_opts;
  END IF;
END $$;