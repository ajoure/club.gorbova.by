import { describe, expect, it } from "vitest";
import permissionsSource from "../hooks/usePermissions.tsx?raw";
import contactSheetSource from "../components/admin/ContactDetailSheet.tsx?raw";
import usersAdminActionsSource from "../../supabase/functions/users-admin-actions/index.ts?raw";
import migrationSource from "../../supabase/migrations/20260815105418_restore_client_impersonation_for_contacts_manage.sql?raw";
import { permissionGrantedByAdminSections } from "./rbacPermissionFallback";

describe("client impersonation RBAC contract", () => {
  it("maps full Contacts access to the privileged account actions in the UI", () => {
    const fullContacts = new Map([["contacts", "manage"]] as const);

    expect(permissionGrantedByAdminSections("users.impersonate", fullContacts)).toBe(true);
    expect(permissionGrantedByAdminSections("users.reset_password", fullContacts)).toBe(true);
    expect(permissionsSource).toContain(
      "permissionGrantedByAdminSections(permissionCode, sectionLevels)",
    );
  });

  it("keeps read and edit access below the impersonation threshold", () => {
    const readContacts = new Map([["contacts", "view"]] as const);
    const editContacts = new Map([["contacts", "edit"]] as const);

    expect(permissionGrantedByAdminSections("users.impersonate", readContacts)).toBe(false);
    expect(permissionGrantedByAdminSections("users.impersonate", editContacts)).toBe(false);
    expect(permissionGrantedByAdminSections("users.reset_password", readContacts)).toBe(false);
    expect(permissionGrantedByAdminSections("users.reset_password", editContacts)).toBe(false);
  });

  it("keeps the contact-sheet action wired to the server-side permission gate", () => {
    expect(contactSheetSource).toContain('hasPermission("users.impersonate")');
    expect(contactSheetSource).toContain("onClick={handleImpersonate}");
    expect(usersAdminActionsSource).toContain('hasPermission("users.impersonate")');
    expect(usersAdminActionsSource).toContain('case "impersonate_start"');
  });

  it("authorizes manage Contacts roles in the canonical database check", () => {
    expect(migrationSource).toContain(
      "WHEN 'users.impersonate'   THEN v_section := 'contacts';      v_level := 'manage';",
    );
    expect(migrationSource).toContain(
      "WHEN 'users.reset_password' THEN v_section := 'contacts';     v_level := 'manage';",
    );
    expect(migrationSource).toContain(
      "RETURN public.has_admin_section_access(_user_id, v_section, v_level);",
    );
    expect(migrationSource).toContain(
      "REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;",
    );
  });
});
