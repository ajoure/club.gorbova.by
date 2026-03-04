
-- ===========================================
-- Sprint 4: public_id system + bulk delete RPCs
-- ===========================================

-- 1) public_id_sequences table
CREATE TABLE public.public_id_sequences (
  entity_type text PRIMARY KEY,
  prefix text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0
);

ALTER TABLE public.public_id_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read public_id_sequences"
  ON public.public_id_sequences FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

-- Seed product sequence
INSERT INTO public.public_id_sequences(entity_type, prefix, last_value)
VALUES ('product', 'PRD', 0)
ON CONFLICT (entity_type) DO NOTHING;

-- 2) next_public_id function (SECURITY DEFINER, atomic)
CREATE OR REPLACE FUNCTION public.next_public_id(p_entity_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_next bigint;
BEGIN
  UPDATE public.public_id_sequences
  SET last_value = last_value + 1
  WHERE entity_type = p_entity_type
  RETURNING prefix, last_value INTO v_prefix, v_next;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown entity_type: %', p_entity_type;
  END IF;

  RETURN v_prefix || '-' || lpad(v_next::text, 6, '0');
END;
$$;

-- 3) Add public_id column to products_v2
ALTER TABLE public.products_v2 ADD COLUMN IF NOT EXISTS public_id text;
CREATE UNIQUE INDEX IF NOT EXISTS products_v2_public_id_key ON public.products_v2(public_id) WHERE public_id IS NOT NULL;

-- 4) Trigger BEFORE INSERT to auto-set public_id
CREATE OR REPLACE FUNCTION public.set_product_public_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.public_id IS NULL THEN
    NEW.public_id := public.next_public_id('product');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_product_public_id
  BEFORE INSERT ON public.products_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.set_product_public_id();

-- 5) Backfill existing products (deterministic order)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.products_v2 WHERE public_id IS NULL ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE public.products_v2
    SET public_id = public.next_public_id('product')
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- 6) RPC: products_bulk_delete_dryrun
CREATE OR REPLACE FUNCTION public.products_bulk_delete_dryrun(product_ids uuid[])
RETURNS TABLE(product_id uuid, can_delete boolean, reasons text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS product_id,
    (
      NOT EXISTS (SELECT 1 FROM public.tariffs t WHERE t.product_id = p.id) AND
      NOT EXISTS (SELECT 1 FROM public.orders_v2 o WHERE o.product_id = p.id) AND
      NOT EXISTS (SELECT 1 FROM public.subscriptions_v2 s WHERE s.product_id = p.id) AND
      NOT EXISTS (SELECT 1 FROM public.entitlements e WHERE e.product_code = p.code) AND
      NOT EXISTS (SELECT 1 FROM public.product_relations pr WHERE pr.parent_product_id = p.id OR pr.child_product_id = p.id)
    ) AS can_delete,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN EXISTS (SELECT 1 FROM public.tariffs t WHERE t.product_id = p.id) THEN 'Есть тарифы' END,
      CASE WHEN EXISTS (SELECT 1 FROM public.orders_v2 o WHERE o.product_id = p.id) THEN 'Есть заказы' END,
      CASE WHEN EXISTS (SELECT 1 FROM public.subscriptions_v2 s WHERE s.product_id = p.id) THEN 'Есть подписки' END,
      CASE WHEN EXISTS (SELECT 1 FROM public.entitlements e WHERE e.product_code = p.code) THEN 'Есть доступы (entitlements)' END,
      CASE WHEN EXISTS (SELECT 1 FROM public.product_relations pr WHERE pr.parent_product_id = p.id OR pr.child_product_id = p.id) THEN 'Есть связи с другими продуктами' END
    ], NULL) AS reasons
  FROM public.products_v2 p
  WHERE p.id = ANY(product_ids);
END;
$$;

-- 7) RPC: products_bulk_delete_execute
CREATE OR REPLACE FUNCTION public.products_bulk_delete_execute(product_ids uuid[], actor_label text DEFAULT 'bulk_delete_products')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_safe_ids uuid[];
  v_deleted int;
  v_requested int;
BEGIN
  v_requested := array_length(product_ids, 1);
  IF v_requested IS NULL OR v_requested = 0 THEN
    RETURN jsonb_build_object('requested', 0, 'deleted', 0);
  END IF;
  IF v_requested > 50 THEN
    RAISE EXCEPTION 'Batch limit exceeded: max 50, got %', v_requested;
  END IF;

  -- Collect safe IDs
  SELECT array_agg(dr.product_id) INTO v_safe_ids
  FROM public.products_bulk_delete_dryrun(product_ids) dr
  WHERE dr.can_delete = true;

  IF v_safe_ids IS NULL THEN
    v_safe_ids := '{}';
  END IF;

  -- Delete safe products
  DELETE FROM public.products_v2 WHERE id = ANY(v_safe_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Audit log (SYSTEM ACTOR)
  INSERT INTO public.audit_logs (action, actor_type, actor_user_id, actor_label, meta)
  VALUES (
    'bulk_delete_products',
    'system',
    NULL,
    actor_label,
    jsonb_build_object('count_requested', v_requested, 'count_deleted', v_deleted, 'deleted_ids', to_jsonb(v_safe_ids))
  );

  RETURN jsonb_build_object('requested', v_requested, 'deleted', v_deleted, 'deleted_ids', to_jsonb(v_safe_ids));
END;
$$;
