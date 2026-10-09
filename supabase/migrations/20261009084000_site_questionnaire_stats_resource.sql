-- Seed the dedicated tab without changing any role grants or existing resources.
DO $$
DECLARE v_section uuid; v_count integer;
BEGIN
  SELECT count(*),min(id::text)::uuid INTO v_count,v_section FROM public.admin_section WHERE code='forms-hub' AND is_active;
  IF v_count<>1 THEN RAISE EXCEPTION 'questionnaire_stats_section_ambiguous'; END IF;
  IF EXISTS(SELECT 1 FROM public.admin_resource WHERE section_id=v_section AND code='preregistration-stats'
    AND (route IS DISTINCT FROM '/admin/forms?tab=preregistration-stats' OR NOT is_active)) THEN
    RAISE EXCEPTION 'questionnaire_stats_resource_changed'; END IF;
  INSERT INTO public.admin_resource(section_id,code,label,route,sort_order)
    VALUES(v_section,'preregistration-stats','Анкета предзаписи','/admin/forms?tab=preregistration-stats',35)
    ON CONFLICT(section_id,code) DO NOTHING;
END;
$$;
