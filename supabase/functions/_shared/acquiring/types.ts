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
  // MP-A2-2: resolved Stripe Customer (per (user_id, account_code)).
  // When set, adapter wires `customer: customer_id` into the Checkout Session.
  customer_id?: string | null;
  // MP-A2-2: when true on one-time checkout, adapter adds
  // `payment_intent_data[setup_future_usage]=off_session` so the PaymentMethod
  // is attached to the Customer for future off-session reuse.
  save_payment_method?: boolean;
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
