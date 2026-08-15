export type AccessLevel = "none" | "view" | "edit" | "manage";

const LEVEL_RANK: Record<AccessLevel, number> = {
  none: 0,
  view: 1,
  edit: 2,
  manage: 3,
};

/**
 * Legacy permission codes still used by individual buttons and pages.
 *
 * The server-side public.has_permission() function resolves these codes through
 * RBAC v3 section grants. Keep this resolver in sync so a custom role does not
 * enter a section successfully and then lose actions granted by its configured
 * access level.
 */
export const PERMISSION_TO_SECTION_ACCESS: Readonly<
  Record<string, { section: string; min: AccessLevel }>
> = {
  "users.view": { section: "contacts", min: "view" },
  "users.update": { section: "contacts", min: "edit" },
  "users.block": { section: "contacts", min: "manage" },
  "users.delete": { section: "contacts", min: "manage" },
  "users.reset_password": { section: "contacts", min: "manage" },
  "users.impersonate": { section: "contacts", min: "manage" },
  "deals.view": { section: "deals", min: "view" },
  "deals.edit": { section: "deals", min: "edit" },
  "deals.manage": { section: "deals", min: "manage" },
  "deals.delete": { section: "deals", min: "manage" },
  "deals.create": { section: "deals", min: "edit" },
  "payments.view": { section: "payments", min: "view" },
  "payments.manage": { section: "payments", min: "manage" },
  "entitlements.view": { section: "payments", min: "view" },
  "entitlements.manage": { section: "payments", min: "manage" },
  "support.view": { section: "support", min: "view" },
  "support.manage": { section: "support", min: "edit" },
  "telegram.view": { section: "communication", min: "view" },
  "telegram.manage": { section: "communication", min: "manage" },
  "roles.view": { section: "roles", min: "view" },
  "roles.manage": { section: "roles", min: "manage" },
  "admins.manage": { section: "roles", min: "manage" },
  "news.view": { section: "editorial", min: "view" },
  "news.edit": { section: "editorial", min: "edit" },
  "content.edit": { section: "editorial", min: "edit" },
  "audit.view": { section: "roles", min: "view" },
};

export function permissionGrantedByAdminSections(
  permissionCode: string,
  sectionLevels: ReadonlyMap<string, AccessLevel>,
): boolean {
  const requirement = PERMISSION_TO_SECTION_ACCESS[permissionCode];
  if (!requirement) return false;

  const actual = sectionLevels.get(requirement.section) ?? "none";
  return LEVEL_RANK[actual] >= LEVEL_RANK[requirement.min];
}
