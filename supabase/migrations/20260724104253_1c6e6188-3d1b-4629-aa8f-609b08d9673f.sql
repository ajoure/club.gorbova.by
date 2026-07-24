-- Admin/Superadmin safe deletion of client_legal_details with FK-aware detachment
CREATE OR REPLACE FUNCTION public.client_legal_details_admin_delete(_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _is_admin boolean;
  _target record;
  _detached_contacts int := 0;
  _removed_maps int := 0;
  _detached_order_links int := 0;
  _detached_documents int := 0;
  _detached_drafts int := 0;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no auth context' USING ERRCODE = '42501';
  END IF;

  _is_admin := public.has_role(_caller, 'admin'::public.app_role)
            OR public.has_role(_caller, 'superadmin'::public.app_role);

  IF NOT _is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin or superadmin role required' USING ERRCODE = '42501';
  END IF;

  SELECT id, profile_id, client_type, is_default, leg_name, ent_name, ind_full_name
    INTO _target
  FROM public.client_legal_details
  WHERE id = _target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legal details % not found', _target_id USING ERRCODE = 'P0002';
  END IF;

  -- 1) Detach billing/company contacts sourced from this legal-details map (keep CRM data)
  WITH upd AS (
    UPDATE public.company_contacts
       SET source_client_legal_details_map_id = NULL,
           updated_at = now(),
           updated_by = _caller
     WHERE source_client_legal_details_map_id IN (
       SELECT id FROM public.client_legal_details_company_map
        WHERE client_legal_details_id = _target_id
     )
    RETURNING 1
  )
  SELECT count(*) INTO _detached_contacts FROM upd;

  -- 2) Remove the CLD -> company map rows (company row itself is preserved)
  WITH del AS (
    DELETE FROM public.client_legal_details_company_map
     WHERE client_legal_details_id = _target_id
    RETURNING 1
  )
  SELECT count(*) INTO _removed_maps FROM del;

  -- 3) Detach historical references (snapshots stay intact; only FK links become NULL)
  WITH upd AS (
    UPDATE public.company_order_links
       SET source_client_legal_details_id = NULL
     WHERE source_client_legal_details_id = _target_id
    RETURNING 1
  )
  SELECT count(*) INTO _detached_order_links FROM upd;

  WITH upd AS (
    UPDATE public.generated_documents
       SET client_details_id = NULL
     WHERE client_details_id = _target_id
    RETURNING 1
  )
  SELECT count(*) INTO _detached_documents FROM upd;

  WITH upd AS (
    UPDATE public.corporate_draft_sessions
       SET legal_details_id = NULL
     WHERE legal_details_id = _target_id
    RETURNING 1
  )
  SELECT count(*) INTO _detached_drafts FROM upd;

  -- 4) Finally delete the legal-details row itself
  -- Remaining FKs cascade automatically:
  --   legal_details_entity_person_links (CASCADE)
  --   document_package_session_participants (CASCADE)
  --   document_package_sessions.selected_legal_entity_id (SET NULL)
  DELETE FROM public.client_legal_details WHERE id = _target_id;

  RETURN jsonb_build_object(
    'ok', true,
    'target_id', _target_id,
    'profile_id', _target.profile_id,
    'was_default', _target.is_default,
    'client_type', _target.client_type,
    'detached_contacts', _detached_contacts,
    'removed_maps', _removed_maps,
    'detached_order_links', _detached_order_links,
    'detached_documents', _detached_documents,
    'detached_drafts', _detached_drafts,
    'deleted_by', _caller,
    'deleted_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.client_legal_details_admin_delete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_legal_details_admin_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_legal_details_admin_delete(uuid) TO service_role;

COMMENT ON FUNCTION public.client_legal_details_admin_delete(uuid) IS
'Admin/superadmin-only atomic delete of client_legal_details. Detaches company_contacts and historical order/document/draft references (snapshots preserved), removes CLD<->company map rows, then deletes the target. Does NOT delete CRM companies or contacts.';