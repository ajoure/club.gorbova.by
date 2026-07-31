type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function valueOrNull(value: unknown): string | number | boolean | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : null;
}

/**
 * A deliberately small, allow-listed provider receipt for persistent queues and
 * payment facts. bePaid responses may contain card tokens, holder names,
 * customer contacts and provider credentials. None of those are needed to
 * reconcile a transaction: the dedicated, access-controlled columns hold the
 * supported payment facts (UID, amount, card brand and last four digits).
 */
export function sanitizeBepaidProviderPayload(payload: unknown): UnknownRecord {
  const body = asRecord(payload);
  const transaction = asRecord(body.transaction ?? body.last_transaction);
  const plan = asRecord(body.plan);

  return {
    id: valueOrNull(body.id),
    state: valueOrNull(body.state),
    event: valueOrNull(body.event),
    tracking_id: valueOrNull(transaction.tracking_id ?? body.tracking_id),
    subscription_id: valueOrNull(body.subscription_id ?? body.id),
    transaction: {
      uid: valueOrNull(transaction.uid),
      parent_uid: valueOrNull(transaction.parent_uid),
      status: valueOrNull(transaction.status ?? body.status),
      status_code: valueOrNull(transaction.status_code),
      type: valueOrNull(transaction.type ?? body.type),
      amount: valueOrNull(transaction.amount),
      currency: valueOrNull(transaction.currency ?? plan.currency),
      paid_at: valueOrNull(transaction.paid_at),
      created_at: valueOrNull(transaction.created_at),
      message: valueOrNull(transaction.message),
      decline_code: valueOrNull(transaction.decline_code),
      receipt_url: valueOrNull(transaction.receipt_url),
    },
    plan: {
      id: valueOrNull(plan.id),
      amount: valueOrNull(plan.amount),
      currency: valueOrNull(plan.currency),
    },
  };
}
