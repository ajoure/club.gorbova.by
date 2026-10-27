export const RENEWAL_AUDIT_RELEASE =
  "provider-managed-cardless-guard-20261027-v1";

// A provider mandate does not require a locally stored card. Apply the same
// eligibility predicates when selecting candidates and atomically updating them.
const eligibleInternalRenewals = (query: any) =>
  query
    .in("status", ["active", "trial", "past_due"])
    .eq("auto_renew", true)
    .is("payment_method_id", null)
    .or("billing_type.is.null,billing_type.neq.provider_managed");

export async function disableCardlessInternalRenewals(
  db: { from: (table: string) => any },
) {
  const candidates = await eligibleInternalRenewals(
    db.from("subscriptions_v2").select("id"),
  );
  if (candidates.error) {
    throw new Error("local_renewal_audit_candidates_failed");
  }
  const ids = [
    ...new Set<string>(
      (candidates.data ?? []).map((row: { id: string }) => row.id),
    ),
  ];
  if (ids.length === 0) return { found: 0, changedIds: [] as string[] };

  // A card, mandate, opt-out or status can change after the initial SELECT.
  // Recheck eligibility in the UPDATE and audit only rows actually returned.
  const changed = await eligibleInternalRenewals(
    db.from("subscriptions_v2")
      .update({ auto_renew: false }).in("id", ids),
  ).select("id");
  if (changed.error) throw new Error("local_renewal_audit_update_failed");
  return {
    found: ids.length,
    changedIds: (changed.data ?? []).map((row: { id: string }) =>
      row.id
    ) as string[],
  };
}
