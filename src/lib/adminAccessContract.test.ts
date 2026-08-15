import { describe, expect, it } from "vitest";
import {
  ADMIN_SECTIONS,
  resolveAdminSectionForPath,
} from "./adminMenuRegistry";
import {
  CATEGORY_TO_ADMIN_SECTION,
  permissionGrantedByAdminSections,
  type AccessLevel,
} from "./rbacPermissionFallback";
import migrationSource from "../../supabase/migrations/20260815181904_align_all_admin_access_contract.sql?raw";
import referralsPageSource from "../pages/admin/AdminReferrals.tsx?raw";
import paymentsHubSource from "../pages/admin/AdminPaymentsHub.tsx?raw";
import formsHubSource from "../pages/admin/AdminFormsHub.tsx?raw";
import communicationSource from "../pages/admin/AdminCommunication.tsx?raw";
import appSource from "../App.tsx?raw";

describe("complete admin access contract", () => {
  it("assigns every declared admin route to a section or an explicit open path", () => {
    const declaredRoutes = Array.from(
      appSource.matchAll(/<Route\s+path="(\/admin[^"]*)"/g),
      (match) => match[1].replace(/:[^/]+/g, "sample"),
    );

    expect(declaredRoutes.length).toBeGreaterThan(20);
    const unknownRoutes = declaredRoutes.filter(
      (route) => resolveAdminSectionForPath(route).kind === "unknown",
    );
    expect(unknownRoutes).toEqual([]);
  });

  it("resolves every configured resource route to its exact section and resource", () => {
    for (const section of ADMIN_SECTIONS) {
      for (const resource of section.resources ?? []) {
        expect(resolveAdminSectionForPath(resource.route)).toEqual({
          kind: "section",
          sectionCode: section.code,
          resourceCode: resource.code,
        });
      }
    }
  });

  it("keeps query tabs distinct instead of borrowing the first resource", () => {
    expect(resolveAdminSectionForPath("/admin/communication?tab=broadcasts").resourceCode)
      .toBe("broadcasts");
    expect(resolveAdminSectionForPath("/admin/communication?tab=settings").resourceCode)
      .toBe("settings");
    expect(resolveAdminSectionForPath("/admin/forms?tab=export").resourceCode)
      .toBe("export");
    expect(resolveAdminSectionForPath("/admin/forms?tab=unknown").resourceCode)
      .toBeUndefined();
  });

  it("maps every visible legacy route to the section that owns its data", () => {
    expect(resolveAdminSectionForPath("/admin/tasks").sectionCode).toBe("deals");
    expect(resolveAdminSectionForPath("/admin/entitlements").sectionCode).toBe("payments");
    expect(resolveAdminSectionForPath("/admin/orders-v2").sectionCode).toBe("payments");
    expect(resolveAdminSectionForPath("/admin/users").sectionCode).toBe("contacts");
    expect(resolveAdminSectionForPath("/admin/club-members").sectionCode).toBe("club-members");
    expect(resolveAdminSectionForPath("/admin/integrations/telegram/clubs/id/members").sectionCode)
      .toBe("club-members");
  });

  it("resolves view/edit/manage for every legacy UI category", () => {
    for (const [category, section] of Object.entries(CATEGORY_TO_ADMIN_SECTION)) {
      const levels = new Map<string, AccessLevel>([[section, "manage"]]);
      expect(permissionGrantedByAdminSections(`${category}.view`, levels)).toBe(true);
      expect(permissionGrantedByAdminSections(`${category}.edit`, levels)).toBe(true);
      expect(permissionGrantedByAdminSections(`${category}.manage`, levels)).toBe(true);
    }
    const viewOnly = new Map<string, AccessLevel>([["payments", "view"]]);
    expect(permissionGrantedByAdminSections("payments.read", viewOnly)).toBe(true);
    expect(permissionGrantedByAdminSections("subscriptions.edit", viewOnly)).toBe(false);
  });

  it("filters page tabs with the same resource grants as the route guard", () => {
    expect(communicationSource).toContain('canAccessResource("communication", tab.id)');
    expect(paymentsHubSource).toContain('canAccessResource("payments", tab.resource)');
    expect(formsHubSource).toContain('canAccessResource("forms-hub", tab.id)');
  });

  it("makes referral view historical and keeps money/settings manage-only", () => {
    expect(migrationSource).toContain("'referrals', 'view'");
    expect(migrationSource).toContain("'referrals', 'edit'");
    expect(migrationSource).toContain("'referrals', 'manage'");
    expect(migrationSource).toContain("referral_relationships_rbac_view");
    expect(migrationSource).toContain("referral_sales_rbac_view");
    expect(migrationSource).toContain("referral_entries_rbac_view");
    expect(referralsPageSource).toContain('canAccessSection("referrals", "manage")');
    expect(referralsPageSource).not.toContain("isSuperAdmin");
  });

  it("aligns historical CRM, payment, product and club data with section grants", () => {
    for (const policy of [
      "companies_rbac_section_view",
      "subscriptions_v2_rbac_history_view",
      "entitlements_rbac_history_view",
      "provider_subscriptions_rbac_view",
      "products_v2_rbac_history_view",
      "telegram_access_grants_club_members_rbac_view",
    ]) {
      expect(migrationSource).toContain(policy);
    }
    expect(migrationSource).toContain("club_members_rpc_guard_not_found");
    expect(migrationSource).toContain("has_admin_resource_access");
  });
});
