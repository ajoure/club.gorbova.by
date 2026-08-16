export type AccessLevel = "none" | "view" | "edit" | "manage";

const LEVEL_RANK: Record<AccessLevel, number> = {
  none: 0,
  view: 1,
  edit: 2,
  manage: 3,
};

/** Legacy category names used by pages/buttons -> canonical RBAC v3 section. */
export const CATEGORY_TO_ADMIN_SECTION: Readonly<Record<string, string>> = {
  users: "contacts",
  contacts: "contacts",
  companies: "companies",
  deals: "deals",
  tasks: "deals",
  payments: "payments",
  subscriptions: "payments",
  entitlements: "payments",
  forms: "forms-hub",
  referrals: "referrals",
  support: "support",
  telegram: "communication",
  communication: "communication",
  integrations: "integrations",
  news: "editorial",
  editorial: "editorial",
  content: "editorial",
  roles: "roles",
  admins: "roles",
  audit: "roles",
  products: "products",
  executors: "documents",
  documents: "documents",
  training: "training",
  consents: "consents",
  sites: "sites",
  marketing: "marketing",
  ai: "ai",
  sections: "sections",
  legislation: "legislation",
  "live-events": "live-events",
  calls: "calls",
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
  "payments.read": { section: "payments", min: "view" },
  "subscriptions.edit": { section: "payments", min: "edit" },
  "entitlements.view": { section: "payments", min: "view" },
  "entitlements.manage": { section: "payments", min: "manage" },
  "support.view": { section: "support", min: "view" },
  "support.manage": { section: "support", min: "edit" },
  "telegram.view": { section: "communication", min: "view" },
  "telegram.manage": { section: "communication", min: "manage" },
  "telegram.clubs.view": { section: "club-members", min: "view" },
  "telegram.clubs.edit": { section: "club-members", min: "edit" },
  "telegram.clubs.manage": { section: "club-members", min: "manage" },
  "roles.view": { section: "roles", min: "view" },
  "roles.manage": { section: "roles", min: "manage" },
  "admins.manage": { section: "roles", min: "manage" },
  "news.view": { section: "editorial", min: "view" },
  "news.edit": { section: "editorial", min: "edit" },
  "content.edit": { section: "editorial", min: "edit" },
  "content.publish": { section: "editorial", min: "manage" },
  "contacts.create": { section: "contacts", min: "edit" },
  "contacts.manage": { section: "contacts", min: "manage" },
  "companies.view": { section: "companies", min: "view" },
  "companies.edit": { section: "companies", min: "edit" },
  "companies.manage": { section: "companies", min: "manage" },
  "executors.view": { section: "documents", min: "view" },
  "executors.manage": { section: "documents", min: "manage" },
  "integrations.view": { section: "integrations", min: "view" },
  "integrations.edit": { section: "integrations", min: "edit" },
  "integrations.manage": { section: "integrations", min: "manage" },
  "audit.view": { section: "roles", min: "view" },
};

export function permissionGrantedByAdminSections(
  permissionCode: string,
  sectionLevels: ReadonlyMap<string, AccessLevel>,
): boolean {
  const explicit = PERMISSION_TO_SECTION_ACCESS[permissionCode];
  const [category, action] = permissionCode.split(".");
  const inferredMin: AccessLevel | undefined =
    action === "view" || action === "read" ? "view" :
    action === "create" || action === "edit" || action === "update" ? "edit" :
    action === "manage" || action === "delete" || action === "publish" ? "manage" :
    undefined;
  const inferredSection = CATEGORY_TO_ADMIN_SECTION[category];
  const requirement = explicit ?? (
    inferredSection && inferredMin
      ? { section: inferredSection, min: inferredMin }
      : undefined
  );
  if (!requirement) return false;

  const actual = sectionLevels.get(requirement.section) ?? "none";
  return LEVEL_RANK[actual] >= LEVEL_RANK[requirement.min];
}
