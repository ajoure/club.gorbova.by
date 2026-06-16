
DO $$
DECLARE
  fn text;
  trigger_fns text[] := ARRAY[
    'ai_generated_documents_immutable_number',
    'assert_global_package_admin_only',
    'audit_package_field_catalog_change',
    'audit_package_item_field_assignment_change',
    'audit_package_role_catalog_change',
    'audit_package_session_field_value_change',
    'audit_package_template_items_change',
    'auto_link_email_to_profile',
    'document_package_sessions_lock_guard',
    'dpti_auto_assign_package_fields',
    'emit_webinar_domain_event',
    'enforce_autoweb_session_id_on_comment',
    'enforce_autoweb_session_id_on_question',
    'ensure_billing_alignment',
    'ensure_single_default_integration',
    'guard_active_session_color',
    'guard_live_events_status_downgrade',
    'guard_package_role_catalog_mutations',
    'guard_participant_prefs_color',
    'guard_room_state_transition',
    'handle_new_user',
    'link_profile_by_telegram',
    'normalize_order_user_id',
    'orders_v2_autofill_deal_month',
    'prevent_section_delete_with_modules',
    'prevent_self_product_relation',
    'set_ai_user_prompts_updated_by',
    'set_corporate_draft_public_id',
    'set_field_registry_public_id',
    'set_product_public_id',
    'set_site_domain_binding_public_id',
    'set_site_page_public_id',
    'set_site_page_tag_public_id',
    'set_tariff_public_id',
    'shdf_enforce_super_admin_context',
    'shdf_guard_delete',
    'shdf_guard_update',
    'shdf_normalize_insert',
    'shdf_write_history',
    'shdfh_block_direct_insert',
    'shdfh_block_mutation',
    'shds_block_mutation',
    'sync_payment_method_revocation',
    'sync_product_club_mapping',
    'tariff_offers_acquiring_audit',
    'tariff_offers_acquiring_validate',
    'tg_training_module_inherit_product_id',
    'tg_training_module_propagate_to_partial_rules',
    'update_ai_batches_updated_at',
    'update_document_package_templates_updated_at',
    'update_telegram_link_status',
    'validate_ai_user_prompt_launcher',
    'validate_deal_pipeline_stage'
  ];
  r record;
BEGIN
  FOREACH fn IN ARRAY trigger_fns LOOP
    FOR r IN
      SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=fn
    LOOP
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
        fn, r.args
      );
    END LOOP;
  END LOOP;
END$$;
