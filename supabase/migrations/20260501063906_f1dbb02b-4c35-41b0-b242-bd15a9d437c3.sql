
-- =========================================================================
-- 1) Trigger: BEFORE INSERT OR UPDATE OF parent_module_id ON training_modules
--    Если у модуля задан parent_module_id и product_id IS NULL —
--    унаследовать product_id от ближайшего родителя.
--    Никогда не перезаписываем уже заполненный product_id.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tg_training_module_inherit_product_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_product_id uuid;
BEGIN
  -- Применяем только если есть parent и product_id ещё не задан
  IF NEW.parent_module_id IS NOT NULL AND NEW.product_id IS NULL THEN
    SELECT product_id
      INTO v_parent_product_id
      FROM public.training_modules
     WHERE id = NEW.parent_module_id;

    IF v_parent_product_id IS NOT NULL THEN
      NEW.product_id := v_parent_product_id;

      -- Audit (best-effort, не блокируем insert/update)
      BEGIN
        INSERT INTO public.audit_logs (action, actor_type, meta)
        VALUES (
          'training_module.product_id_inherited',
          'system',
          jsonb_build_object(
            'module_id', NEW.id,
            'parent_module_id', NEW.parent_module_id,
            'inherited_product_id', v_parent_product_id,
            'op', TG_OP
          )
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_training_module_inherit_product_id ON public.training_modules;

CREATE TRIGGER tg_training_module_inherit_product_id
BEFORE INSERT OR UPDATE OF parent_module_id, product_id
ON public.training_modules
FOR EACH ROW
EXECUTE FUNCTION public.tg_training_module_inherit_product_id();


-- =========================================================================
-- 2) One-shot backfill: для модулей с product_id IS NULL,
--    у которых корень поддерева имеет ненулевой product_id —
--    унаследовать product_id корня.
--    Свободные поддеревья (root.product_id IS NULL) НЕ трогаем.
-- =========================================================================

DO $$
DECLARE
  v_affected_count int := 0;
  v_sample jsonb;
BEGIN
  WITH RECURSIVE roots AS (
    SELECT id AS root_id, product_id AS root_product_id
    FROM public.training_modules
    WHERE parent_module_id IS NULL
  ),
  tree AS (
    SELECT tm.id, tm.product_id, r.root_id, r.root_product_id, 1 AS depth
    FROM public.training_modules tm
    JOIN roots r ON tm.parent_module_id = r.root_id
    UNION ALL
    SELECT tm.id, tm.product_id, t.root_id, t.root_product_id, t.depth + 1
    FROM public.training_modules tm
    JOIN tree t ON tm.parent_module_id = t.id
    WHERE t.depth < 20
  ),
  to_fix AS (
    SELECT id, root_product_id
    FROM tree
    WHERE product_id IS NULL
      AND root_product_id IS NOT NULL
  ),
  upd AS (
    UPDATE public.training_modules tm
       SET product_id = tf.root_product_id
      FROM to_fix tf
     WHERE tm.id = tf.id
       AND tm.product_id IS NULL  -- защита от гонок
    RETURNING tm.id, tm.title, tm.product_id
  )
  SELECT
    COUNT(*),
    COALESCE(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'product_id', product_id)
                       ORDER BY title) FILTER (WHERE id IS NOT NULL), '[]'::jsonb)
  INTO v_affected_count, v_sample
  FROM (SELECT * FROM upd LIMIT 50) u;

  INSERT INTO public.audit_logs (action, actor_type, meta)
  VALUES (
    'training_modules.product_id_inherited_backfill',
    'system',
    jsonb_build_object(
      'affected_count', v_affected_count,
      'sample_first_50', v_sample,
      'note', 'one-shot backfill: inherit product_id from subtree root where root.product_id IS NOT NULL'
    )
  );
END $$;
