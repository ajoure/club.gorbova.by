// ============================================================================
// payment-status.ts — canonical helper для «успешного» статуса payments_v2
// и selectCanonicalPayment(orderId).
//
// Discovery (2026-05-11): payments_v2.status enum =
//   {succeeded, failed, refunded, processing, canceled}.
// «Успешный» в этом контексте = 'succeeded'. refunded/processing НЕ считаются.
//
// STOP-guard: read-only. Никаких repair/reconcile/insert.
// ============================================================================

export const SUCCEEDED_PAYMENT_STATUSES = ['succeeded'] as const;

export function isSucceededStatus(s: string | null | undefined): boolean {
  if (!s) return false;
  return (SUCCEEDED_PAYMENT_STATUSES as readonly string[]).includes(s);
}

export interface SupabaseLike {
  from: (table: string) => any;
}

export interface CanonicalPaymentResult<T = any> {
  payment: T | null;
  selection_reason:
    | 'latest_successful_payment'
    | 'no_successful_payment'
    | 'payment_not_found'
    | 'lookup_error';
  candidates_count: number;
  warning?: string;
}

export async function selectCanonicalPayment<T = any>(
  supabase: SupabaseLike,
  orderId: string,
): Promise<CanonicalPaymentResult<T>> {
  if (!orderId) {
    return { payment: null, selection_reason: 'payment_not_found', candidates_count: 0 };
  }
  try {
    const { data, error } = await supabase
      .from('payments_v2')
      .select('*')
      .eq('order_id', orderId)
      .eq('status', 'succeeded')
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) {
      return {
        payment: null,
        selection_reason: 'lookup_error',
        candidates_count: 0,
        warning: error.message,
      };
    }
    const rows = (data || []) as T[];
    if (rows.length === 0) {
      return { payment: null, selection_reason: 'no_successful_payment', candidates_count: 0 };
    }
    return {
      payment: rows[0],
      selection_reason: 'latest_successful_payment',
      candidates_count: rows.length,
    };
  } catch (e: any) {
    return {
      payment: null,
      selection_reason: 'lookup_error',
      candidates_count: 0,
      warning: e?.message ?? String(e),
    };
  }
}
