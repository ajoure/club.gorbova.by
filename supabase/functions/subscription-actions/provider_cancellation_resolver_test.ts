import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  resolveProviderCancellationTargets,
  type ProviderCancellationCandidate,
} from './provider_cancellation_resolver.ts';

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

Deno.test('uses a directly linked live bePaid subscription', () => {
  assertEquals(resolveProviderCancellationTargets(input([base])), {
    outcome: 'cancel',
    providerSubscriptionIds: ['sbs_live'],
    source: 'direct',
    matchedRows: 1,
  });
});

Deno.test('follows a stale superseded link for the same user and product', () => {
  const stale = {
    ...base,
    subscriptionV2Id: 'sub-superseded',
  };
  assertEquals(resolveProviderCancellationTargets(input([stale])), {
    outcome: 'cancel',
    providerSubscriptionIds: ['sbs_live'],
    source: 'same_product_fallback',
    matchedRows: 1,
  });
});

Deno.test('cancels every duplicate live bePaid chain for the same product', () => {
  assertEquals(resolveProviderCancellationTargets(input([
    base,
    {
      ...base,
      rowId: 'provider-row-2',
      providerSubscriptionId: 'sbs_shadow',
      subscriptionV2Id: 'sub-superseded',
    },
  ])), {
    outcome: 'cancel',
    providerSubscriptionIds: ['sbs_live', 'sbs_shadow'],
    source: 'mixed',
    matchedRows: 2,
  });
});

Deno.test('provider-managed cancellation fails closed when the provider link is missing', () => {
  assertEquals(resolveProviderCancellationTargets(input([])), {
    outcome: 'blocked',
    reason: 'provider_subscription_link_missing',
    matchedRows: 0,
  });
});

Deno.test('legacy MIT cancellation remains local when no provider exists', () => {
  assertEquals(resolveProviderCancellationTargets(input([], 'mit')), {
    outcome: 'local_only',
    matchedRows: 0,
  });
});

Deno.test('identity mismatch blocks cancellation instead of choosing a guess', () => {
  assertEquals(resolveProviderCancellationTargets(input([{
    ...base,
    subscriptionV2Id: 'sub-superseded',
    linkedUserId: 'other-user',
  }])), {
    outcome: 'blocked',
    reason: 'provider_subscription_identity_mismatch',
    matchedRows: 0,
  });
});

Deno.test('unsupported same-product provider blocks local success', () => {
  assertEquals(resolveProviderCancellationTargets(input([{
    ...base,
    provider: 'stripe',
    providerSubscriptionId: 'stripe_sub',
  }])), {
    outcome: 'blocked',
    reason: 'provider_cancel_not_supported',
    matchedRows: 1,
    providers: ['stripe'],
  });
});
