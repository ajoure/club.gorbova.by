-- CRM RBAC v3 alignment: unify write access via admin_section_access
-- Idempotent: drops legacy role-hardcoded write policies and recreates them
-- with (super_admin OR admin OR has_admin_section_access(uid, section, 'edit')).
-- SELECT extended to include section 'view'. Author/uploader ownership preserved
-- for notes/files. crm_tasks and crm_activity_log gated by 'deals' section.

------------------------------------------------------------
-- 1. companies
------------------------------------------------------------
DROP POLICY IF EXISTS "companies insert for admin+manager" ON public.companies;
DROP POLICY IF EXISTS "companies update for admin+manager" ON public.companies;
DROP POLICY IF EXISTS "companies delete for super_admin"   ON public.companies;
DROP POLICY IF EXISTS "companies read for CRM staff"       ON public.companies;

CREATE POLICY "companies_read_rbac" ON public.companies FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'menedzher')
  OR public.has_role_v2(auth.uid(),'support')
  OR public.has_admin_section_access(auth.uid(),'companies','view')
);

CREATE POLICY "companies_insert_rbac" ON public.companies FOR INSERT TO authenticated
WITH CHECK (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','edit')
);

CREATE POLICY "companies_update_rbac" ON public.companies FOR UPDATE TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','edit')
) WITH CHECK (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','edit')
);

CREATE POLICY "companies_delete_rbac" ON public.companies FOR DELETE TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','edit')
);

------------------------------------------------------------
-- 2. company_contacts
------------------------------------------------------------
DROP POLICY IF EXISTS "company_contacts insert for admin+manager" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts update for admin+manager" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts delete for super_admin"   ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts read for CRM staff"       ON public.company_contacts;

CREATE POLICY "company_contacts_read_rbac" ON public.company_contacts FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'menedzher')
  OR public.has_role_v2(auth.uid(),'support')
  OR public.has_admin_section_access(auth.uid(),'companies','view')
);

CREATE POLICY "company_contacts_insert_rbac" ON public.company_contacts FOR INSERT TO authenticated
WITH CHECK (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','edit')
);

CREATE POLICY "company_contacts_update_rbac" ON public.company_contacts FOR UPDATE TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','edit')
) WITH CHECK (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','edit')
);

CREATE POLICY "company_contacts_delete_rbac" ON public.company_contacts FOR DELETE TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','edit')
);

------------------------------------------------------------
-- 3. orders_v2 (deals) — extend RBAC v3 down to 'edit'
------------------------------------------------------------
DROP POLICY IF EXISTS "RBAC v3: manage orders by deals section" ON public.orders_v2;
DROP POLICY IF EXISTS "RBAC v3: view orders by deals section"   ON public.orders_v2;

CREATE POLICY "orders_v2_view_rbac" ON public.orders_v2 FOR SELECT
USING (
  public.has_admin_section_access(auth.uid(),'deals','view')
);

CREATE POLICY "orders_v2_write_rbac" ON public.orders_v2 FOR ALL
USING (
  public.has_admin_section_access(auth.uid(),'deals','edit')
) WITH CHECK (
  public.has_admin_section_access(auth.uid(),'deals','edit')
);

------------------------------------------------------------
-- 4. company_notes — author owns own; section-edit allowed
------------------------------------------------------------
DROP POLICY IF EXISTS "company_notes_staff_read"            ON public.company_notes;
DROP POLICY IF EXISTS "company_notes_staff_insert"          ON public.company_notes;
DROP POLICY IF EXISTS "company_notes_owner_or_admin_update" ON public.company_notes;
DROP POLICY IF EXISTS "company_notes_owner_or_admin_delete" ON public.company_notes;

CREATE POLICY "company_notes_read_rbac" ON public.company_notes FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'employee')
  OR public.has_admin_section_access(auth.uid(),'companies','view')
);

CREATE POLICY "company_notes_insert_rbac" ON public.company_notes FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid() AND (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'employee')
    OR public.has_admin_section_access(auth.uid(),'companies','edit')
  )
);

CREATE POLICY "company_notes_update_rbac" ON public.company_notes FOR UPDATE TO authenticated
USING (
  author_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','manage')
) WITH CHECK (
  author_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','manage')
);

CREATE POLICY "company_notes_delete_rbac" ON public.company_notes FOR DELETE TO authenticated
USING (
  author_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','manage')
);

------------------------------------------------------------
-- 5. contact_notes
------------------------------------------------------------
DROP POLICY IF EXISTS "contact_notes_staff_read"            ON public.contact_notes;
DROP POLICY IF EXISTS "contact_notes_staff_insert"          ON public.contact_notes;
DROP POLICY IF EXISTS "contact_notes_owner_update"          ON public.contact_notes;
DROP POLICY IF EXISTS "contact_notes_owner_or_admin_delete" ON public.contact_notes;

CREATE POLICY "contact_notes_read_rbac" ON public.contact_notes FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'employee')
  OR public.has_admin_section_access(auth.uid(),'contacts','view')
);

CREATE POLICY "contact_notes_insert_rbac" ON public.contact_notes FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid() AND (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'employee')
    OR public.has_admin_section_access(auth.uid(),'contacts','edit')
  )
);

CREATE POLICY "contact_notes_update_rbac" ON public.contact_notes FOR UPDATE TO authenticated
USING (
  author_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'contacts','manage')
) WITH CHECK (
  author_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'contacts','manage')
);

CREATE POLICY "contact_notes_delete_rbac" ON public.contact_notes FOR DELETE TO authenticated
USING (
  author_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'contacts','manage')
);

------------------------------------------------------------
-- 6. crm_tasks — deals section
------------------------------------------------------------
DROP POLICY IF EXISTS "crm_tasks_staff_read"   ON public.crm_tasks;
DROP POLICY IF EXISTS "crm_tasks_staff_insert" ON public.crm_tasks;
DROP POLICY IF EXISTS "crm_tasks_staff_update" ON public.crm_tasks;

CREATE POLICY "crm_tasks_read_rbac" ON public.crm_tasks FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'employee')
  OR public.has_admin_section_access(auth.uid(),'deals','view')
);

CREATE POLICY "crm_tasks_insert_rbac" ON public.crm_tasks FOR INSERT TO authenticated
WITH CHECK (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'employee')
  OR public.has_admin_section_access(auth.uid(),'deals','edit')
);

CREATE POLICY "crm_tasks_update_rbac" ON public.crm_tasks FOR UPDATE TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'employee')
  OR public.has_admin_section_access(auth.uid(),'deals','edit')
) WITH CHECK (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'employee')
  OR public.has_admin_section_access(auth.uid(),'deals','edit')
);

------------------------------------------------------------
-- 7. company_files / contact_files — insert: uploader owns; delete: uploader or manage
------------------------------------------------------------
DROP POLICY IF EXISTS "company_files_staff_read"            ON public.company_files;
DROP POLICY IF EXISTS "company_files_staff_insert"          ON public.company_files;
DROP POLICY IF EXISTS "company_files_owner_or_admin_delete" ON public.company_files;

CREATE POLICY "company_files_read_rbac" ON public.company_files FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'employee')
  OR public.has_admin_section_access(auth.uid(),'companies','view')
);

CREATE POLICY "company_files_insert_rbac" ON public.company_files FOR INSERT TO authenticated
WITH CHECK (
  uploader_id = auth.uid() AND (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'employee')
    OR public.has_admin_section_access(auth.uid(),'companies','edit')
  )
);

CREATE POLICY "company_files_delete_rbac" ON public.company_files FOR DELETE TO authenticated
USING (
  uploader_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'companies','manage')
);

DROP POLICY IF EXISTS "contact_files_staff_read"            ON public.contact_files;
DROP POLICY IF EXISTS "contact_files_staff_insert"          ON public.contact_files;
DROP POLICY IF EXISTS "contact_files_owner_or_admin_delete" ON public.contact_files;

CREATE POLICY "contact_files_read_rbac" ON public.contact_files FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_role_v2(auth.uid(),'employee')
  OR public.has_admin_section_access(auth.uid(),'contacts','view')
);

CREATE POLICY "contact_files_insert_rbac" ON public.contact_files FOR INSERT TO authenticated
WITH CHECK (
  uploader_id = auth.uid() AND (
    public.has_role_v2(auth.uid(),'super_admin')
    OR public.has_role_v2(auth.uid(),'admin')
    OR public.has_role_v2(auth.uid(),'employee')
    OR public.has_admin_section_access(auth.uid(),'contacts','edit')
  )
);

CREATE POLICY "contact_files_delete_rbac" ON public.contact_files FOR DELETE TO authenticated
USING (
  uploader_id = auth.uid()
  OR public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'contacts','manage')
);

------------------------------------------------------------
-- 8. crm_activity_log — extend to section 'deals'
------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage CRM activity" ON public.crm_activity_log;

CREATE POLICY "crm_activity_log_read_rbac" ON public.crm_activity_log FOR SELECT TO authenticated
USING (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'deals','view')
  OR public.has_admin_section_access(auth.uid(),'companies','view')
  OR public.has_admin_section_access(auth.uid(),'contacts','view')
);

CREATE POLICY "crm_activity_log_insert_rbac" ON public.crm_activity_log FOR INSERT TO authenticated
WITH CHECK (
  public.has_role_v2(auth.uid(),'super_admin')
  OR public.has_role_v2(auth.uid(),'admin')
  OR public.has_admin_section_access(auth.uid(),'deals','edit')
  OR public.has_admin_section_access(auth.uid(),'companies','edit')
  OR public.has_admin_section_access(auth.uid(),'contacts','edit')
);

NOTIFY pgrst, 'reload schema';