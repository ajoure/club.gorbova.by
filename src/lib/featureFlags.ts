/**
 * Centralized feature flags.
 *
 * REQUISITES_V2_UI_ENABLED — controls switching of system requisites
 * and user requisites forms to the new tenant-based model
 * (legal_entities_requisites, individual_requisites, tenants, tenant_memberships).
 *
 * When false (default) — old UI is used as-is. No data is touched.
 * When true — new V2 forms read/write only new tables.
 *
 * Source: VITE_REQUISITES_V2_UI ("1" | "true" | "on" enables).
 */

function readBool(name: string): boolean {
  const raw = (import.meta as any)?.env?.[name];
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export const REQUISITES_V2_UI_ENABLED: boolean = readBool("VITE_REQUISITES_V2_UI");

export const featureFlags = {
  REQUISITES_V2_UI_ENABLED,
} as const;
