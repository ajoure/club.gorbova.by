-- Fix broken audit fn (used non-existent actor_id/payload cols) + extend audit to assignment + session value
CREATE OR REPLACE FUNCTION public.audit_package_field_catalog_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_before jsonb; v_after jsonb; v_pkg uuid; v_field uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'document_package_field.created'; v_before := NULL; v_after := to_jsonb(NEW);
    v_pkg := NEW.package_template_id; v_field := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_active = true AND NEW.is_active = false THEN v_action := 'document_package_field.archived';
    ELSIF OLD.is_active = false AND NEW.is_active = true THEN v_action := 'document_package_field.restored';
    ELSE v_action := 'document_package_field.updated';
    END IF;
    v_before := to_jsonb(OLD); v_after := to_jsonb(NEW);
    v_pkg := NEW.package_template_id; v_field := NEW.id;
  ELSE
    v_action := 'document_package_field.deleted'; v_before := to_jsonb(OLD); v_after := NULL;
    v_pkg := OLD.package_template_id; v_field := OLD.id;
  END IF;
  INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
          v_action, 'document_package_field', v_field::text,
          jsonb_build_object('public_id', COALESCE(NEW.public_id, OLD.public_id),
                             'package_template_id', v_pkg, 'before', v_before, 'after', v_after));
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION public.audit_package_item_field_assignment_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_before jsonb; v_after jsonb; v_id uuid; v_item uuid; v_field uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'document_package_assignment.created'; v_before := NULL; v_after := to_jsonb(NEW);
    v_id := NEW.id; v_item := NEW.package_template_item_id; v_field := NEW.field_catalog_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_active = true AND NEW.is_active = false THEN v_action := 'document_package_assignment.archived';
    ELSIF OLD.is_active = false AND NEW.is_active = true THEN v_action := 'document_package_assignment.restored';
    ELSE v_action := 'document_package_assignment.updated';
    END IF;
    v_before := to_jsonb(OLD); v_after := to_jsonb(NEW);
    v_id := NEW.id; v_item := NEW.package_template_item_id; v_field := NEW.field_catalog_id;
  ELSE
    v_action := 'document_package_assignment.deleted'; v_before := to_jsonb(OLD); v_after := NULL;
    v_id := OLD.id; v_item := OLD.package_template_item_id; v_field := OLD.field_catalog_id;
  END IF;
  INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
          v_action, 'document_package_assignment', v_id::text,
          jsonb_build_object('package_template_item_id', v_item, 'field_catalog_id', v_field,
                             'before', v_before, 'after', v_after));
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_audit_dpifa ON public.document_package_item_field_assignments;
CREATE TRIGGER trg_audit_dpifa AFTER INSERT OR UPDATE OR DELETE
ON public.document_package_item_field_assignments
FOR EACH ROW EXECUTE FUNCTION public.audit_package_item_field_assignment_change();

CREATE OR REPLACE FUNCTION public.audit_package_session_field_value_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_before jsonb; v_after jsonb; v_id uuid; v_sess uuid; v_field uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'pf_value.upserted'; v_before := NULL; v_after := to_jsonb(NEW);
    v_id := NEW.id; v_sess := NEW.session_id; v_field := NEW.field_catalog_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'pf_value.upserted'; v_before := to_jsonb(OLD); v_after := to_jsonb(NEW);
    v_id := NEW.id; v_sess := NEW.session_id; v_field := NEW.field_catalog_id;
  ELSE
    v_action := 'pf_value.deleted'; v_before := to_jsonb(OLD); v_after := NULL;
    v_id := OLD.id; v_sess := OLD.session_id; v_field := OLD.field_catalog_id;
  END IF;
  INSERT INTO public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
          v_action, 'document_package_session_field_value', v_id::text,
          jsonb_build_object('session_id', v_sess, 'field_catalog_id', v_field,
                             'before', v_before, 'after', v_after));
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_audit_dpsfv ON public.document_package_session_field_values;
CREATE TRIGGER trg_audit_dpsfv AFTER INSERT OR UPDATE OR DELETE
ON public.document_package_session_field_values
FOR EACH ROW EXECUTE FUNCTION public.audit_package_session_field_value_change();