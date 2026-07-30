/**
 * Combines the two canonical paths by which a profile can be connected to a
 * company.  A direct CRM link is preferred, while a requisites map is kept as
 * a read fallback for records whose asynchronous billing sync has not yet
 * produced the `company_contacts` row.
 */
export function mergeLinkedCompanyIds(
  directCompanyIds: readonly (string | null | undefined)[],
  requisitesCompanyIds: readonly (string | null | undefined)[],
): string[] {
  const uniqueIds = new Set<string>();

  for (const companyId of [...directCompanyIds, ...requisitesCompanyIds]) {
    if (companyId) uniqueIds.add(companyId);
  }

  return [...uniqueIds];
}

/**
 * A frontend rollout may briefly precede the Companies migrations.  In that
 * case the optional requisites map must not hide already available direct CRM
 * links.  Other errors (RLS, network, malformed query) stay visible to the
 * caller instead of being silently swallowed.
 */
export function isMissingCompanyRequisitesRelation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";

  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /could not find the table .*client_legal_details_company_map|relation .*client_legal_details_company_map.* does not exist/i.test(message)
  );
}
