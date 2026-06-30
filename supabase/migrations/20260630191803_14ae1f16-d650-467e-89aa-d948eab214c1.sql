
-- Revoke anon EXECUTE on SECURITY DEFINER functions that are not intended for public/guest callers.
-- Keep anon access for explicitly public surfaces: get_kb_questions_public, create_preorder_deal_atomic (guest preorder).

REVOKE EXECUTE ON FUNCTION public._crm_tasks_assert_staff() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_task_apply_automation(uuid, uuid, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_task_bulk_status(uuid[], text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_task_bulk_update(uuid[], jsonb, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_task_create(jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_task_list(jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_task_reassign(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_task_update_status(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_tasks_schedule_due_notifications() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dpsfv_assert_package_match() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_club_members_enriched(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_admin_section_access(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.package_items_unbind_on_template_soft_delete() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_session_document_atomic(uuid, uuid, jsonb, jsonb, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_club_members_enriched(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_call_public_id() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_crm_task_public_id() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tariff_offers_force_disable_mandatory_internal_mit() FROM anon, PUBLIC;

-- Ensure authenticated and service_role retain EXECUTE on RPCs they call.
GRANT EXECUTE ON FUNCTION public.crm_task_apply_automation(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_task_bulk_status(uuid[], text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_task_bulk_update(uuid[], jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_task_create(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_task_list(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_task_reassign(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_task_update_status(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_club_members_enriched(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_admin_section_access(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_session_document_atomic(uuid, uuid, jsonb, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_club_members_enriched(uuid, text, text) TO authenticated, service_role;
