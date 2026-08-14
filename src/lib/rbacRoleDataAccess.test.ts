import { describe, expect, it } from "vitest";
import migrationSource from "../../supabase/migrations/20260814134846_fix_role_data_access_contract.sql?raw";
import formsHubSource from "../hooks/useFormsHubData.ts?raw";
import formsBulkActionsSource from "../components/admin/forms/FormsBulkActionsBar.tsx?raw";
import formsLoadErrorSource from "../components/admin/forms/FormsHubLoadError.tsx?raw";
import formsDetailSource from "../components/admin/forms/FormsDetailOpener.tsx?raw";
import preregistrationDetailSource from "../components/admin/PreregistrationDetailSheet.tsx?raw";
import permissionsSource from "../hooks/usePermissions.tsx?raw";

describe("RBAC role-to-data access contract", () => {
  it("persists and resolves none/view/edit/manage without losing explicit denies", () => {
    expect(migrationSource).toContain(
      "CHECK (access_level IN ('none', 'view', 'edit', 'manage'))",
    );
    expect(migrationSource).toContain("WHEN 'manage' THEN 3");
    expect(migrationSource).toContain("WHEN 'edit' THEN 2");
    expect(migrationSource).toContain("WHEN 'view' THEN 1");
    expect(migrationSource).toContain("'resource_override'::text");
    expect(migrationSource).not.toContain("rg.level_rank > 0");
  });

  it("uses canonical role codes for administrator bypass", () => {
    expect(migrationSource).toContain(
      "public.has_role_v2(_user_id, 'super_admin')",
    );
    expect(migrationSource).toContain("public.has_role_v2(_user_id, 'admin')");
    expect(migrationSource).not.toContain(
      "public.has_role(_user_id, 'superadmin'::app_role)",
    );
  });

  it("maps forms-hub view/edit/manage to every source used by the page", () => {
    for (const table of [
      "site_form_submissions",
      "course_preregistrations",
      "lesson_progress_state",
      "training_modules",
      "training_lessons",
      "products_v2",
      "site_pages",
    ]) {
      expect(migrationSource).toContain(`ON public.${table}`);
    }
    expect(migrationSource).toContain("'forms-hub', 'view'");
    expect(migrationSource).toContain("'forms-hub', 'edit'");
    expect(migrationSource).toContain("'forms-hub', 'manage'");
  });

  it("keeps historical contacts and deals governed by their section grants", () => {
    expect(migrationSource).toContain(
      "'contacts', 'view'",
    );
    expect(migrationSource).toContain(
      "'deals', 'view'",
    );
    expect(migrationSource).toContain(
      "'deals', 'edit'",
    );
  });

  it("does not convert data-query failures into believable empty lists", () => {
    expect(formsHubSource.match(/throw [a-zA-Z]+Error|if \(error\) throw error;/g)?.length).toBeGreaterThanOrEqual(8);
    expect(formsLoadErrorSource).toContain("Это ошибка загрузки, а не отсутствие исторических записей");
  });

  it("lets custom manage roles use full forms actions and keeps view roles read-only", () => {
    expect(formsBulkActionsSource).toContain(
      'canAccessSection("forms-hub", "manage")',
    );
    expect(formsBulkActionsSource).not.toContain('role === "admin"');
    expect(migrationSource).toContain(
      'DROP POLICY IF EXISTS "Admins can manage preregistrations"',
    );
    expect(formsDetailSource).toContain('canAccessSection("forms-hub", "edit")');
    expect(formsDetailSource).toContain('readOnly={!canEdit}');
    expect(preregistrationDetailSource).toContain("!readOnly &&");
  });

  it("does not admit a role to the admin shell when every explicit grant is none", () => {
    expect(permissionsSource).toContain(
      "LEVEL_RANK[level] >= LEVEL_RANK.view",
    );
    expect(permissionsSource).not.toContain("return sectionLevels.size > 0");
  });
});
