UPDATE public.document_package_item_role_assignments
   SET metadata = jsonb_build_object('position', 'юрисконсульт')
 WHERE id = '8a6302c8-8a5a-4e40-b88e-37be0c7ab4ca';