type JsonMap = Record<string, unknown>;

function asMap(value: unknown): JsonMap {
  return value && typeof value === "object" ? value as JsonMap : {};
}

function hasFiniteInstallmentMarker(metaValue: unknown): boolean {
  const meta = asMap(metaValue);
  const installment = asMap(meta.installment);
  const progress = asMap(meta.installment_progress);

  return (
    meta.payment_method === "internal_installment" ||
    meta.model === "bepaid_finite_subscription" ||
    installment.model === "bepaid_finite_subscription" ||
    progress.model === "bepaid_finite_subscription" ||
    installment.as_finite_subscription === true
  );
}

/**
 * bePaid represents a finite installment plan as an sbs_* object. That is a
 * provider implementation detail, not a renewable product subscription.
 */
export function isFiniteInstallmentProviderSubscription(row: unknown): boolean {
  const subscription = asMap(row);
  const localSubscription = asMap(subscription.subscriptions_v2);

  return (
    hasFiniteInstallmentMarker(subscription.meta) ||
    hasFiniteInstallmentMarker(localSubscription.meta)
  );
}

/**
 * Removes a provider subscription from cached live lists after the backend has
 * confirmed cancellation. React Query invalidation still follows to reconcile
 * with the server, but the contact card must not keep showing a canceled row
 * while that refetch is in flight.
 */
export function removeProviderSubscriptionById<T>(
  rows: readonly T[] | undefined,
  providerSubscriptionId: string,
): T[] {
  if (!rows) return [];
  return rows.filter((row) => {
    const subscription = asMap(row);
    return subscription.provider_subscription_id !== providerSubscriptionId;
  });
}
