-- Stage 6.G: whitelist trigger on payments_v2.provider
-- BEFORE INSERT OR UPDATE OF provider; исторические строки не трогаются.

CREATE OR REPLACE FUNCTION public.tg_payments_v2_provider_whitelist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed constant text[] := ARRAY['bepaid','stripe','rr','bank'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.provider IS NULL OR NOT (NEW.provider = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'stage6g_provider_not_allowed: provider=% (allowed: %)',
        NEW.provider, v_allowed
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: срабатывает только при изменении столбца provider (WHEN OF provider).
  -- Разрешаем менять provider ТОЛЬКО в whitelist. NULL явно запрещаем,
  -- чтобы избежать ловушки трёхзначной логики: NOT (NULL = ANY(arr)) → NULL.
  IF NEW.provider IS DISTINCT FROM OLD.provider THEN
    IF NEW.provider IS NULL OR NOT (NEW.provider = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'stage6g_provider_update_not_allowed: %->% (allowed: %)',
        OLD.provider, NEW.provider, v_allowed
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payments_v2_provider_whitelist ON public.payments_v2;
CREATE TRIGGER trg_payments_v2_provider_whitelist
  BEFORE INSERT OR UPDATE OF provider ON public.payments_v2
  FOR EACH ROW EXECUTE FUNCTION public.tg_payments_v2_provider_whitelist();

COMMENT ON FUNCTION public.tg_payments_v2_provider_whitelist() IS
  'Stage 6.G (2026-07-15): запрещает новые INSERT и UPDATE провайдера вне '
  'canonical whitelist bepaid|stripe|rr|bank. Исторические строки '
  '(admin/admin_test/admin_grant/admin_from_payment/bank_transfer) не '
  'изменяются и остаются доступны для UPDATE других полей.';