// Phase 1 Stripe Integration — adapter layer types
// add-only, single-account-now / multi-account-ready

export type AcquiringProvider = 'bepaid' | 'stripe';
export type ProviderMode = 'fixed' | 'customer_choice';

export interface AcquiringContext {
  provider: AcquiringProvider;
  account_code?: string | null;
  profile_code?: string | null;
  business_stream?: string | null;
}

export interface CheckoutRequest {
  order_id: string;
  amount: number;          // minor units (kopecks/cents)
  currency: string;
  description?: string;
  metadata?: Record<string, string | number | null | undefined>;
  return_url?: string;
  cancel_url?: string;
  customer_email?: string;
  is_one_time?: boolean;
  context: AcquiringContext;
}

export interface CheckoutResponse {
  ok: boolean;
  redirect_url?: string;
  session_id?: string;
  provider_payment_id?: string;
  fallback?: boolean;
  error?: string;
}

/**
 * Common adapter contract — every acquiring provider implements this.
 * Phase 1 only ships the bePaid adapter (a thin facade over existing logic).
 * Stripe adapter ships in Phase 2.
 */
export interface AcquiringAdapter {
  readonly provider: AcquiringProvider;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResponse>;
}
