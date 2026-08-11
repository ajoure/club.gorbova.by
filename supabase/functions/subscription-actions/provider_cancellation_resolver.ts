export const LIVE_PROVIDER_STATES = [
  'active',
  'pending',
  'trial',
  'past_due',
  'failed_attempt',
] as const;

export interface ProviderCancellationCandidate {
  rowId: string;
  provider: string;
  providerSubscriptionId: string | null;
  state: string;
  userId: string | null;
  subscriptionV2Id: string | null;
  linkedUserId: string | null;
  linkedProductId: string | null;
  orderUserId: string | null;
  orderProductId: string | null;
}

export type ProviderCancellationResolution =
  | {
      outcome: 'cancel';
      providerSubscriptionIds: string[];
      source: 'direct' | 'same_product_fallback' | 'mixed';
      matchedRows: number;
    }
  | {
      outcome: 'local_only';
      matchedRows: 0;
    }
  | {
      outcome: 'blocked';
      reason:
        | 'provider_subscription_link_missing'
        | 'provider_subscription_identity_mismatch'
        | 'provider_cancel_not_supported'
        | 'provider_subscription_id_missing';
      matchedRows: number;
      providers?: string[];
    };

interface ResolutionInput {
  subscriptionV2Id: string;
  userId: string;
  productId: string;
  billingType: string | null;
  candidates: ProviderCancellationCandidate[];
}

const normalized = (value: string | null | undefined) =>
  value == null ? null : String(value).toLowerCase();

const hasConflictingEvidence = (
  values: Array<string | null | undefined>,
  expected: string,
) => values.some((value) => value != null && String(value) !== String(expected));

/**
 * Select every live provider subscription that belongs to the same user and
 * product as the subscription being canceled.  This intentionally follows a
 * superseded/expired local link: bePaid is the billing source of truth and a
 * live sbs must not survive merely because its local foreign key is stale.
 *
 * The resolver is fail-closed for provider-managed subscriptions.  A missing
 * or contradictory link can never be reported as a successful local cancel.
 */
export function resolveProviderCancellationTargets(
  input: ResolutionInput,
): ProviderCancellationResolution {
  const liveStates = new Set<string>(LIVE_PROVIDER_STATES);
  const live = input.candidates.filter((row) =>
    liveStates.has(normalized(row.state) || '')
  );

  let identityMismatch = false;
  const matched: Array<ProviderCancellationCandidate & { direct: boolean }> = [];

  for (const row of live) {
    const direct = String(row.subscriptionV2Id || '') === String(input.subscriptionV2Id);
    const userEvidence = [row.userId, row.linkedUserId, row.orderUserId];
    const productEvidence = [row.linkedProductId, row.orderProductId];

    if (direct) {
      if (
        hasConflictingEvidence(userEvidence, input.userId) ||
        hasConflictingEvidence(productEvidence, input.productId)
      ) {
        identityMismatch = true;
        continue;
      }
      matched.push({ ...row, direct });
      continue;
    }

    // Fallback candidates need positive ownership and product evidence.  A
    // provider row with only a user_id but no product relationship is ignored.
    const ownsRow = userEvidence.some((value) => String(value || '') === String(input.userId));
    const sameProduct = productEvidence.some((value) => String(value || '') === String(input.productId));
    if (!ownsRow || !sameProduct) continue;

    if (
      hasConflictingEvidence(userEvidence, input.userId) ||
      hasConflictingEvidence(productEvidence, input.productId)
    ) {
      identityMismatch = true;
      continue;
    }

    matched.push({ ...row, direct });
  }

  if (identityMismatch) {
    return {
      outcome: 'blocked',
      reason: 'provider_subscription_identity_mismatch',
      matchedRows: matched.length,
    };
  }

  if (matched.length === 0) {
    if (String(input.billingType || '').toLowerCase() === 'provider_managed') {
      return {
        outcome: 'blocked',
        reason: 'provider_subscription_link_missing',
        matchedRows: 0,
      };
    }
    return { outcome: 'local_only', matchedRows: 0 };
  }

  const unsupported = [...new Set(
    matched
      .map((row) => normalized(row.provider) || 'unknown')
      .filter((provider) => provider !== 'bepaid'),
  )];
  if (unsupported.length > 0) {
    return {
      outcome: 'blocked',
      reason: 'provider_cancel_not_supported',
      matchedRows: matched.length,
      providers: unsupported,
    };
  }

  if (matched.some((row) => !row.providerSubscriptionId)) {
    return {
      outcome: 'blocked',
      reason: 'provider_subscription_id_missing',
      matchedRows: matched.length,
    };
  }

  const providerSubscriptionIds = [...new Set(
    matched.map((row) => String(row.providerSubscriptionId)),
  )];
  const directCount = matched.filter((row) => row.direct).length;
  const fallbackCount = matched.length - directCount;

  return {
    outcome: 'cancel',
    providerSubscriptionIds,
    source: directCount > 0 && fallbackCount > 0
      ? 'mixed'
      : (directCount > 0 ? 'direct' : 'same_product_fallback'),
    matchedRows: matched.length,
  };
}
