// Phase 1 Stripe Integration — bePaid adapter (facade)
//
// IMPORTANT: This is a thin facade over the existing bePaid checkout pipeline.
// It MUST NOT change bePaid behavior in any way. All real logic continues to
// live in the existing edge functions (create-payment-checkout, bepaid-*).
// In Phase 1 callers that already speak directly to create-payment-checkout
// stay unchanged. This adapter exists so Phase 2 Stripe adapter has a peer.

import type { AcquiringAdapter, CheckoutRequest, CheckoutResponse } from './types.ts';

export const bepaidAdapter: AcquiringAdapter = {
  provider: 'bepaid',
  async createCheckout(_req: CheckoutRequest): Promise<CheckoutResponse> {
    // Facade placeholder. The canonical bePaid write-path remains
    // `create-payment-checkout` / `bepaid-*` edge functions. Routing through
    // this adapter is wired up in Phase 2 together with the Stripe adapter.
    return {
      ok: false,
      fallback: true,
      error: 'bepaid_adapter_facade_only_phase_1',
    };
  },
};
