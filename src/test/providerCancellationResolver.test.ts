import { describe, expect, it } from 'vitest';
import {
  resolveProviderCancellationTargets,
  type ProviderCancellationCandidate,
} from '../../supabase/functions/subscription-actions/provider_cancellation_resolver.ts';

const base: ProviderCancellationCandidate = {
  rowId: 'provider-row-1',
  provider: 'bepaid',
  providerSubscriptionId: 'sbs_live',
  state: 'active',
  userId: 'user-1',
  subscriptionV2Id: 'sub-current',
  linkedUserId: 'user-1',
  linkedProductId: 'product-1',
  orderUserId: 'user-1',
  orderProductId: 'product-1',
};

const input = (candidates: ProviderCancellationCandidate[], billingType = 'provider_managed') => ({
  subscriptionV2Id: 'sub-current',
  userId: 'user-1',
  productId: 'product-1',
  billingType,
  candidates,
});

describe('provider cancellation target resolver', () => {
  it('follows the same-product bePaid chain even when the local link is stale', () => {
    expect(resolveProviderCancellationTargets(input([{
      ...base,
      subscriptionV2Id: 'sub-superseded',
    }]))).toEqual({
      outcome: 'cancel',
      providerSubscriptionIds: ['sbs_live'],
      source: 'same_product_fallback',
      matchedRows: 1,
    });
  });

  it('cancels every duplicate live bePaid chain for one product', () => {
    expect(resolveProviderCancellationTargets(input([
      base,
      {
        ...base,
        rowId: 'provider-row-2',
        providerSubscriptionId: 'sbs_shadow',
        subscriptionV2Id: 'sub-superseded',
      },
    ]))).toEqual({
      outcome: 'cancel',
      providerSubscriptionIds: ['sbs_live', 'sbs_shadow'],
      source: 'mixed',
      matchedRows: 2,
    });
  });

  it('fails closed for a provider-managed row with no resolvable provider link', () => {
    expect(resolveProviderCancellationTargets(input([]))).toEqual({
      outcome: 'blocked',
      reason: 'provider_subscription_link_missing',
      matchedRows: 0,
    });
  });

  it('keeps legacy MIT cancellation local when no provider exists', () => {
    expect(resolveProviderCancellationTargets(input([], 'mit'))).toEqual({
      outcome: 'local_only',
      matchedRows: 0,
    });
  });

  it('fails closed on contradictory identity evidence', () => {
    expect(resolveProviderCancellationTargets(input([{
      ...base,
      subscriptionV2Id: 'sub-superseded',
      linkedProductId: 'other-product',
    }]))).toEqual({
      outcome: 'blocked',
      reason: 'provider_subscription_identity_mismatch',
      matchedRows: 0,
    });
  });
});
