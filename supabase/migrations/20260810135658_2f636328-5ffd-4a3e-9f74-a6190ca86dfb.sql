-- Harden the Club bonus helper functions against project-wide default EXECUTE
-- grants.  REVOKE FROM PUBLIC alone is not sufficient in this project because
-- anon/authenticated also receive explicit default privileges.

REVOKE ALL ON FUNCTION public.tariff_access_rank(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tariff_access_rank(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.recalculate_entitlement_aggregate(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_entitlement_aggregate(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.upsert_club_bonus_entitlement_source(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_club_bonus_entitlement_source(uuid, uuid)
  TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.tariff_access_rank(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.tariff_access_rank(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.tariff_access_rank(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'club_bonus_acl_tariff_access_rank_mismatch';
  END IF;

  IF has_function_privilege('anon', 'public.recalculate_entitlement_aggregate(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.recalculate_entitlement_aggregate(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.recalculate_entitlement_aggregate(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'club_bonus_acl_recalculate_entitlement_aggregate_mismatch';
  END IF;

  IF has_function_privilege('anon', 'public.upsert_club_bonus_entitlement_source(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.upsert_club_bonus_entitlement_source(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.upsert_club_bonus_entitlement_source(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'club_bonus_acl_upsert_club_bonus_entitlement_source_mismatch';
  END IF;
END;
$$;