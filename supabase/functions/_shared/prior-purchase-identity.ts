export interface PriorPurchaseIdentityRow {
  user_id?: string | null;
  profile_id?: string | null;
}

/** Resolve a paid order to the auth user used by access/entitlement records. */
export function resolvePriorPurchaseOwner(
  row: PriorPurchaseIdentityRow,
  allowedUserIds: ReadonlySet<string>,
  profileToUserId: ReadonlyMap<string, string>,
): string | null {
  if (row.user_id && allowedUserIds.has(row.user_id)) return row.user_id;
  if (row.profile_id) return profileToUserId.get(row.profile_id) || null;
  return null;
}
