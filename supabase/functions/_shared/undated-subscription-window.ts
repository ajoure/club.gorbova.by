/**
 * Negative eligibility guard for technical checkout shells. This follows the
 * existing accessBearingSubscriptionFilter policy; it is not payment proof.
 * A dated subscription and a finite entitlement_source keep their own window.
 */
export function isAccessBearingUndatedSubscription(status: unknown): boolean {
  return status === 'active' || status === 'trial';
}
