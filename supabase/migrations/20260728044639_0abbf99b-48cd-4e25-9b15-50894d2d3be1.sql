DO $mig$
DECLARE
  v_tpl uuid := 'b5ad9e1f-266f-4fdf-ad51-7aeadbfbd0a0';
  v_item uuid := '08de6ac6-1cf9-4d68-9082-8922ad4ccee5';
  v_new_ver uuid := gen_random_uuid();
  v_tokens jsonb := jsonb_build_array(
    'package.ul.FLD-000345','package.ip.FLD-000017','package.ul.FLD-000009','package.ip.FLD-000016',
    'pf-000016','pf-000015','ln-000018|format=full','field:FLD-000069','pf-000032',
    'tableRepeat:TR-000001','pf-000025','pf-000017','pf-000026','pf-000018','pf-000019',
    'pf-000027','pf-000030','pf-000023','pf-000028','pf-000020','pf-000024','pf-000029',
    'pf-000021','tableTotal:TT-000001','tableTotal:TT-000001|format=words',
    'tableTotal:TT-000002','tableTotal:TT-000003','ln-000018|format=signature_short'
  );
  v_current_meta jsonb;
  v_new_meta jsonb;
BEGIN
  INSERT INTO public.document_template_versions
    (id, template_id, version_number, storage_bucket, storage_path, file_name,
     file_size_bytes, file_sha256, tokens, detected_tokens, token_manifest,
     validation_status, markup_status, is_current, notes)
  VALUES
    (v_new_ver, v_tpl, 9, 'documents',
     'templates/1785213900308-otchet-v9.docx',
     'otchet-v9.docx',
     39606,
     'a5dc6be1ba2135608317daa60b5a59d7687e85382e6ae58577d1f88e9ad4e830',
     v_tokens, v_tokens, v_tokens,
     'valid', 'marked', false,
     'v9: ddmm_slash_seq header format, TT-000002/003 restored, partial reimbursement long-line with right-aligned "белорусских рублей"');

  UPDATE public.document_template_versions SET is_current = false WHERE template_id = v_tpl;
  UPDATE public.document_template_versions SET is_current = true  WHERE id = v_new_ver;

  UPDATE public.document_templates
     SET current_version_id = v_new_ver,
         template_status = 'active',
         is_active = true,
         updated_at = now()
   WHERE id = v_tpl;

  SELECT metadata INTO v_current_meta FROM public.document_package_template_items WHERE id = v_item;

  v_new_meta := jsonb_set(
    v_current_meta,
    '{table_repeats,0,columns,3,source_key}',
    to_jsonb('{{pf-000023}}'::text),
    false
  );
  v_new_meta := jsonb_set(v_new_meta, '{number_display_format}', to_jsonb('ddmm_slash_seq'::text), true);

  UPDATE public.document_package_template_items
     SET metadata = v_new_meta
   WHERE id = v_item;

  INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
  VALUES (NULL, 'system', 'document.template_version_activated',
          jsonb_build_object(
            'template_id', v_tpl,
            'template_version_id', v_new_ver,
            'version_number', 9,
            'source', 'sprint_advance_report_v9',
            'display_format', 'ddmm_slash_seq'));
END
$mig$;