UPDATE public.document_package_role_catalog
   SET metadata = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object('enable_person_subfields', true)
 WHERE id = 'c8fc4200-75c0-4c24-8eea-112c4e468aeb'
   AND label = 'Участник'
   AND package_template_id = '21764469-1ba9-49b3-90d9-5349bcbcd531';