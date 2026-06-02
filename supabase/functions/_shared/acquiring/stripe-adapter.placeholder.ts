// Phase 1 Stripe Integration — Stripe adapter placeholder
//
// Real implementation lands in Phase 2. This file exists only to keep the
// adapter map symmetric and to document the future write-path.
// NOTHING in this file performs a Stripe API call.

import type { AcquiringAdapter, CheckoutRequest, CheckoutResponse } from './types.ts';

export const stripeAdapterPlaceholder: AcquiringAdapter = {
  provider: 'stripe',
  async createCheckout(_req: CheckoutRequest): Promise<CheckoutResponse> {
    return {
      ok: false,
      fallback: true,
      error: 'stripe_adapter_not_implemented_phase_1',
    };
  },
};
