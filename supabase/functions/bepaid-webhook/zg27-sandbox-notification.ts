/** Only our authenticated provider TEST notifications bypass business processing. */
export function isIsolatedZg27SandboxNotification(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const transaction = (body as Record<string, unknown>).transaction;
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) return false;
  const tx = transaction as Record<string, unknown>;
  return tx.test === true && typeof tx.tracking_id === 'string'
    && tx.tracking_id.startsWith('zg27-sandbox:')
    && tx.tracking_id.length > 'zg27-sandbox:'.length && tx.tracking_id.length <= 128;
}
