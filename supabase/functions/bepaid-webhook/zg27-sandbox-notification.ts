/** Only our authenticated provider TEST notifications bypass business processing. */
export function isIsolatedZg27SandboxNotification(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const event = body as Record<string, unknown>;
  if (Object.hasOwn(event, 'transaction')) {
    const transaction = event.transaction;
    if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) return false;
    const tx = transaction as Record<string, unknown>;
    return tx.test === true && typeof tx.tracking_id === 'string'
      && tx.tracking_id.startsWith('zg27-sandbox:')
      && tx.tracking_id.length > 'zg27-sandbox:'.length && tx.tracking_id.length <= 128;
  }
  // Documented Checkout notifications (including expired unused tokens) are bare
  // checkout objects. Restrict this form to our separate hosted TEST namespace.
  const order = event.order;
  if (event.test !== true || event.transaction_type !== 'payment'
    || typeof event.token !== 'string' || event.token.length < 16 || event.token.length > 512
    || !order || typeof order !== 'object' || Array.isArray(order)) return false;
  const tracking = (order as Record<string, unknown>).tracking_id;
  const prefix = 'zg27-sandbox:hosted:';
  return typeof tracking === 'string' && tracking.startsWith(prefix)
    && tracking.length > prefix.length && tracking.length <= 128;
}
