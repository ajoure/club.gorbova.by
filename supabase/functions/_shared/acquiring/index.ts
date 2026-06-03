// Phase 2 — adapter resolver. Real Stripe adapter wired up (was placeholder in Phase 1).

import type { AcquiringAdapter, AcquiringProvider } from './types.ts';
import { bepaidAdapter } from './bepaid-adapter.ts';
import { stripeAdapter } from './stripe-adapter.ts';

export type { AcquiringAdapter, AcquiringProvider, CheckoutRequest, CheckoutResponse, AcquiringContext, ProviderMode } from './types.ts';
export { getAcquiringSecret, hasAcquiringSecret } from './secrets.ts';
export { readAcquiringSecret, hasAcquiringVaultSecret } from './vault.ts';

const REGISTRY: Record<AcquiringProvider, AcquiringAdapter> = {
  bepaid: bepaidAdapter,
  stripe: stripeAdapter,
};

export function resolveAdapter(
  provider: AcquiringProvider,
  _account_code?: string | null,
): AcquiringAdapter {
  const adapter = REGISTRY[provider];
  if (!adapter) throw new Error(`acquiring_adapter_not_found:${provider}`);
  return adapter;
}
