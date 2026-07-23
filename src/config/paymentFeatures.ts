/**
 * Saved bePaid card tokens are retired from every customer-facing flow.
 * Provider-managed checkouts (bePaid SBS and Stripe Checkout) remain enabled.
 */
export const SAVED_CARD_PAYMENTS_ENABLED = false;
