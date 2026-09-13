import { finishCheckoutAttempt } from './pending-purchase.ts';

/** A transport error or an unrecognized bank status is never proof of decline. */
export function chargeAttemptState(httpStatus: number, transaction: { uid?: string; status?: string } | undefined): 'ready' | 'failed' | 'unknown' {
  if (transaction?.uid && ['failed', 'declined', 'error'].includes(transaction.status || '')) return 'failed';
  if (transaction?.uid && ['successful', 'incomplete', 'pending', 'processing'].includes(transaction.status || '')) return 'ready';
  if (!transaction?.uid && [400, 401, 403, 404, 422].includes(httpStatus)) return 'failed';
  return 'unknown';
}

export async function chargeRequest<T>(db: any, attemptId: string, request: () => Promise<T>): Promise<T> {
  try { return await request(); }
  catch (error) {
    await finishCheckoutAttempt(db, attemptId, 'unknown', { success: false, error: 'charge_outcome_unknown' });
    throw error;
  }
}
