
-- Product relations table (hierarchy)
CREATE TABLE public.product_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  child_product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  relation_type text NOT NULL DEFAULT 'includes',
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(parent_product_id, child_product_id, relation_type)
);

-- Prevent self-links
CREATE OR REPLACE FUNCTION public.prevent_self_product_relation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_product_id = NEW.child_product_id THEN
    RAISE EXCEPTION 'A product cannot be linked to itself';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_self_product_relation
  BEFORE INSERT OR UPDATE ON public.product_relations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_product_relation();

-- RLS
ALTER TABLE public.product_relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_select_product_relations" ON public.product_relations
  FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'superadmin'));

CREATE POLICY "admin_insert_product_relations" ON public.product_relations
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'superadmin'));

CREATE POLICY "admin_update_product_relations" ON public.product_relations
  FOR UPDATE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'superadmin'));

CREATE POLICY "admin_delete_product_relations" ON public.product_relations
  FOR DELETE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'superadmin'));
