UPDATE public.document_package_token_aliases
SET role_key = 'ideology_responsible',
    updated_at = now()
WHERE role_key = 'responsible_person'
  AND alias_token IN (
    'package.roles.responsible_person.full_name',
    'package.roles.responsible_person.position'
  );

INSERT INTO public.audit_logs(action, actor_type, actor_label, meta)
VALUES (
  'package_alias_role_key_realigned',
  'system',
  'sprint_3c_migration',
  jsonb_build_object(
    'sprint', '3C',
    'reason', 'role_key responsible_person отсутствовал в document_package_role_catalog; SOT = ideology_responsible',
    'affected_alias_tokens', jsonb_build_array(
      'package.roles.responsible_person.full_name',
      'package.roles.responsible_person.position'
    )
  )
);