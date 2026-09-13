/** Checkout lifetime is independent of the age of its CRM purchase. */
export const PAYMENT_CHECKOUT_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function paymentCheckoutExpiresAt(now = Date.now()): string {
  return new Date(now + PAYMENT_CHECKOUT_LIFETIME_MS).toISOString();
}

export function isPaymentCheckoutAlive(issuedAt: unknown, now = Date.now()): boolean {
  const issued = typeof issuedAt === 'string' ? Date.parse(issuedAt) : NaN;
  return Number.isFinite(issued) && now >= issued && now - issued < PAYMENT_CHECKOUT_LIFETIME_MS;
}
