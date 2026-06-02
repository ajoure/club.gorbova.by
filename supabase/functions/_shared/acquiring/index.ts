// Phase 1 Stripe Integration — adapter resolver
//
// resolveAdapter(provider, account_code?) → AcquiringAdapter
//
// Single-account-now / multi-account-ready. account_code is accepted as a
// future-ready parameter; on MVP it is unused.

import type { AcquiringAdapter, AcquiringProvider } from './types.ts';
import { bepaidAdapter } from './bepaid-adapter.ts';
import { stripeAdapterPlaceholder } from './stripe-adapter.placeholder.ts';

export type { AcquiringAdapter, AcquiringProvider, CheckoutRequest, CheckoutResponse, AcquiringContext, ProviderMode } from './types.ts';
export { getAcquiringSecret, hasAcquiringSecret } from './secrets.ts';

const REGISTRY: Record<AcquiringProvider, AcquiringAdapter> = {
  bepaid: bepaidAdapter,
  stripe: stripeAdapterPlaceholder,
};

export function resolveAdapter(
  provider: AcquiringProvider,
  _account_code?: string | null,
): AcquiringAdapter {
  const adapter = REGISTRY[provider];
  if (!adapter) throw new Error(`acquiring_adapter_not_found:${provider}`);
  return adapter;
}
