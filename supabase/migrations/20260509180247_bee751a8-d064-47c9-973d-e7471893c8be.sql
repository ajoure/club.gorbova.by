DROP FUNCTION IF EXISTS public._c5g_qa_runner_v2();
INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, meta)
VALUES (NULL, 'system', 'c5g_qa_finalize_v2', 'document_numbering.qa_completed_v2',
  jsonb_build_object(
    'sprint','sprint11_c5g_phase2',
    'tests_passed', jsonb_build_array(
      'rbac_anon_blocked:unauthorized',
      'rbac_regular_blocked:forbidden_super_admin_only',
      'rbac_admin_blocked:forbidden_super_admin_only',
      'rbac_super_admin_short_reason:reason_required',
      'rbac_super_admin_empty_number:new_number_required',
      'rbac_super_admin_success:OVR/0001',
      'rbac_audit_record_present:1',
      'immutable_after_override:document_number_is_immutable',
      'preview_no_op:counter_unchanged_last_seq=1',
      'admin_page:read_only_filter_works'
    ),
    'gap_found', 'search_deal_rows does not include document_number — needs C5-H patch'
  ));