// The canonical audience RPC already accepts product rules and UUID snapshots.
// Validate both without treating a malformed snapshot as an unfiltered audience.
export function isValidAudienceRule(rule: unknown): boolean {
  if (typeof rule === 'string') {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rule);
  }
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
  const value = rule as { product_id?: unknown; tariff_ids?: unknown };
  return (typeof value.product_id === 'string' && value.product_id.trim().length > 0)
    || (Array.isArray(value.tariff_ids) && value.tariff_ids.length > 0);
}

export function shouldAppendAdministrators(
  canonicalAudience: boolean,
  directAudience: boolean,
  education: unknown,
  webinarRegistration: unknown,
): boolean {
  // A resolved include/exclude/club audience is an upper bound, not a seed to
  // extend with administrative copies outside the operator's chosen audience.
  return !canonicalAudience && !directAudience && !education && webinarRegistration === undefined;
}
