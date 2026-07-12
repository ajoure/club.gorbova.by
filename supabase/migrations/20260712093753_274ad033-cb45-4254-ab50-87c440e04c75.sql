
-- =========================================================================
-- Sprint C2 / Этап B: entitlement_sources (add-only) + atomic recalculation
-- =========================================================================

-- 1. Table --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entitlement_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type       text NOT NULL,
  source_ref        text NOT NULL,
  user_id           uuid NOT NULL,
  profile_id        uuid,
  product_id        uuid NOT NULL,
  tariff_id         uuid,
  order_id          uuid,
  starts_at         timestamptz NOT NULL,
  expires_at        timestamptz,           -- NULL = бессрочный
  status            text NOT NULL DEFAULT 'active',
  revoked_at        timestamptz,
  revocation_reason text,
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entitlement_sources_source_uk UNIQUE (source_type, source_ref),

  CONSTRAINT entitlement_sources_type_chk
    CHECK (source_type IN ('order','manual_grant','subscription','upgrade','migration')),

  CONSTRAINT entitlement_sources_status_chk
    CHECK (status IN ('active','revoked','expired')),

  CONSTRAINT entitlement_sources_order_requires_order_id_chk
    CHECK (source_type <> 'order' OR order_id IS NOT NULL),

  CONSTRAINT entitlement_sources_order_ref_matches_order_id_chk
    CHECK (source_type <> 'order' OR source_ref = order_id::text),

  CONSTRAINT entitlement_sources_revoked_requires_revoked_at_chk
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL),

  CONSTRAINT entitlement_sources_expires_ge_starts_chk
    CHECK (expires_at IS NULL OR expires_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS entitlement_sources_user_product_status_idx
  ON public.entitlement_sources (user_id, product_id, status);

CREATE INDEX IF NOT EXISTS entitlement_sources_order_id_idx
  ON public.entitlement_sources (order_id) WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS entitlement_sources_active_expires_idx
  ON public.entitlement_sources (user_id, product_id, expires_at)
  WHERE status = 'active';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.entitlement_sources_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entitlement_sources_updated_at ON public.entitlement_sources;
CREATE TRIGGER entitlement_sources_updated_at
  BEFORE UPDATE ON public.entitlement_sources
  FOR EACH ROW EXECUTE FUNCTION public.entitlement_sources_touch_updated_at();

-- 2. GRANTs --------------------------------------------------------------
GRANT SELECT ON public.entitlement_sources TO authenticated;
GRANT ALL    ON public.entitlement_sources TO service_role;

-- 3. RLS -----------------------------------------------------------------
ALTER TABLE public.entitlement_sources ENABLE ROW LEVEL SECURITY;

-- Владелец видит свои основания (та же identity-модель, что и entitlements)
CREATE POLICY "Users view own entitlement_sources"
  ON public.entitlement_sources
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_permission(auth.uid(), 'entitlements.view'));

-- Staff с доступом к contacts — только чтение (аналог существующей политики entitlements)
CREATE POLICY "Staff with contacts access can view entitlement_sources"
  ON public.entitlement_sources
  FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'contacts', 'view'));

-- Управление — только через 'entitlements.manage' permission (та же, что для entitlements)
-- Прямых INSERT/UPDATE/DELETE от клиента не даём: только service_role и SECURITY DEFINER RPC.
CREATE POLICY "Entitlement_sources manage via permission"
  ON public.entitlement_sources
  FOR ALL
  TO authenticated
  USING (public.has_permission(auth.uid(), 'entitlements.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'entitlements.manage'));

-- 4. Atomic recalculation RPC -------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_entitlement_aggregate(
  p_user_id     uuid,
  p_product_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_perpetual   boolean;
  v_max_expires     timestamptz;
  v_max_historical  timestamptz;
  v_effective_src   uuid;
  v_active_count    integer;
  v_ent_id          uuid;
  v_prev_expires    timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'recalculate_entitlement_aggregate: user_id and product_id required';
  END IF;

  -- Блокируем агрегированный entitlement на время расчёта (row-level lock).
  SELECT id, expires_at INTO v_ent_id, v_prev_expires
  FROM public.entitlements
  WHERE user_id = p_user_id AND product_id = p_product_id
  FOR UPDATE;

  -- Расчёт по действующим (active + не истёкшие по времени) источникам.
  SELECT
    bool_or(expires_at IS NULL),
    MAX(expires_at),
    COUNT(*)
  INTO v_has_perpetual, v_max_expires, v_active_count
  FROM public.entitlement_sources
  WHERE user_id = p_user_id
    AND product_id = p_product_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  IF v_active_count > 0 THEN
    -- Diagnostic effective_source: строка, задающая максимальный срок (или бессрочная).
    IF v_has_perpetual THEN
      SELECT id INTO v_effective_src
      FROM public.entitlement_sources
      WHERE user_id = p_user_id AND product_id = p_product_id
        AND status = 'active' AND expires_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1;
    ELSE
      SELECT id INTO v_effective_src
      FROM public.entitlement_sources
      WHERE user_id = p_user_id AND product_id = p_product_id
        AND status = 'active'
        AND expires_at = v_max_expires
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    IF v_ent_id IS NULL THEN
      -- Не создаём entitlement из recalculation, только логируем и выходим.
      -- Создание entitlement — обязанность вышестоящего grant-flow.
      RETURN jsonb_build_object(
        'status', 'no_entitlement_row',
        'active_count', v_active_count,
        'effective_expires_at', CASE WHEN v_has_perpetual THEN NULL ELSE v_max_expires END,
        'effective_source_id', v_effective_src
      );
    END IF;

    UPDATE public.entitlements
    SET status     = 'active',
        expires_at = CASE WHEN v_has_perpetual THEN NULL ELSE v_max_expires END,
        meta       = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
                       'effective_source_id', v_effective_src,
                       'perpetual', v_has_perpetual,
                       'active_sources', v_active_count,
                       'recalculated_at', now()
                     ),
        updated_at = now()
    WHERE id = v_ent_id;

    RETURN jsonb_build_object(
      'status', 'active',
      'active_count', v_active_count,
      'effective_expires_at', CASE WHEN v_has_perpetual THEN NULL ELSE v_max_expires END,
      'effective_source_id', v_effective_src,
      'perpetual', v_has_perpetual
    );
  ELSE
    -- Действующих источников нет — закрыть entitlement, но не искажать историю датой now().
    -- Берём MAX(expires_at) всех завершённых источников; если нет — оставляем предыдущий expires_at.
    SELECT MAX(expires_at) INTO v_max_historical
    FROM public.entitlement_sources
    WHERE user_id = p_user_id AND product_id = p_product_id
      AND expires_at IS NOT NULL;

    IF v_ent_id IS NULL THEN
      RETURN jsonb_build_object(
        'status','no_entitlement_row',
        'active_count', 0,
        'historical_expires_at', v_max_historical
      );
    END IF;

    UPDATE public.entitlements
    SET status     = 'expired',
        expires_at = COALESCE(v_max_historical, v_prev_expires),
        meta       = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
                       'effective_source_id', NULL,
                       'perpetual', false,
                       'active_sources', 0,
                       'recalculated_at', now(),
                       'closed_reason', 'no_active_sources'
                     ),
        updated_at = now()
    WHERE id = v_ent_id;

    RETURN jsonb_build_object(
      'status','expired',
      'active_count', 0,
      'effective_expires_at', COALESCE(v_max_historical, v_prev_expires)
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_entitlement_aggregate(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_entitlement_aggregate(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_entitlement_aggregate(uuid, uuid) TO authenticated;
