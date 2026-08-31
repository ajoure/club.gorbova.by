// Optional guard for an administrator repairing an existing paid access window.
// It narrows the standard fulfiller; it never changes caller authorization.
export interface ExactAccessTarget {
  subscriptionId: string;
  end: Date;
}

export function parseExactAccessTarget(input: {
  expectedExistingSubscriptionId?: unknown;
  customAccessEndAt?: unknown;
  extendFromCurrent?: unknown;
}, now: Date): ExactAccessTarget | null {
  const id = input.expectedExistingSubscriptionId;
  if (id === undefined || id === null) return null;
  const end = typeof input.customAccessEndAt === 'string'
    && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.customAccessEndAt)
    ? new Date(input.customAccessEndAt) : null;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
      || input.extendFromCurrent !== true || !end || !Number.isFinite(end.getTime()) || end <= now) {
    throw new Error('exact_access_invalid_request');
  }
  return { subscriptionId: id, end };
}

export function exactAccessTargetError(target: ExactAccessTarget | null, subscription: {
  id?: string;
  status?: string;
  access_end_at?: string | null;
} | null | undefined): string | null {
  if (!target) return null;
  if (!subscription || subscription.id !== target.subscriptionId
      || !['active', 'expired'].includes(subscription.status || '')) {
    return 'exact_access_existing_subscription_changed';
  }
  const previousEnd = subscription.access_end_at ? Date.parse(subscription.access_end_at) : NaN;
  if (!Number.isFinite(previousEnd)) return 'exact_access_existing_window_invalid';
  if (target.end.getTime() < previousEnd) return 'exact_access_cannot_shorten';
  return null;
}
