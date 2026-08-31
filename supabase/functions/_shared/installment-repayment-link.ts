import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { loadInstallmentRepaymentContext, quoteInstallmentRepayment } from './installment-repayment-context.ts';
import { RepaymentPlanError } from './installment-repayment-plan.ts';

export type RepaymentLinkRequest = {
  action: 'quote' | 'create'; order_id: string; payment_type: 'one_time' | 'subscription';
  count?: number; interval_days?: number; expected_fingerprint?: string;
  replace_mandate_confirmed?: boolean; request_id?: string; reason?: string;
};

/** Called only after requirePaymentsEdit, inside the canonical public-link writer. */
export async function handleInstallmentRepaymentLink(db: SupabaseClient, actorId: string, input: RepaymentLinkRequest) {
  const context = await loadInstallmentRepaymentContext(db, input.order_id);
  const quote = quoteInstallmentRepayment(context, input);
  if (input.action === 'quote') return { success: true, quote };
  if (input.action !== 'create') throw new RepaymentPlanError('invalid_repayment_action');
  if (input.expected_fingerprint !== quote.fingerprint) throw new RepaymentPlanError('repayment_quote_changed');
  if (quote.replaces_live_mandate && input.replace_mandate_confirmed !== true) {
    throw new RepaymentPlanError('mandate_replacement_confirmation_required');
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.request_id || '')) throw new RepaymentPlanError('repayment_request_id_required');
  if (!(input.reason || '').trim() || input.reason!.length > 1000) throw new RepaymentPlanError('repayment_reason_required');
  const { data: payments, error: paymentsError } = await db.from('payments_v2').select('id,updated_at').eq('order_id', context.order.id);
  if (paymentsError) throw new RepaymentPlanError('repayment_read_failed');
  // Re-read the whole context: a payment between quote and the timestamp snapshot
  // must not be accepted with the earlier monetary balance.
  const fresh = await loadInstallmentRepaymentContext(db, input.order_id);
  if (fresh.fingerprint !== context.fingerprint) throw new RepaymentPlanError('repayment_quote_changed');
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
  const { data, error } = await db.rpc('create_existing_installment_payment_link_v1', {
    p_actor_id: actorId, p_order_id: context.order.id, p_sub_id: context.sub.id,
    p_order_updated_at: context.order.updated_at, p_sub_updated_at: context.sub.updated_at,
    p_expected_payments: payments, p_expected_providers: context.providers.map(p => ({ id: p.id, updated_at: p.updated_at })),
    p_quote: quote, p_token: token, p_request_id: input.request_id, p_reason: input.reason!.trim(),
    p_replace_confirmed: input.replace_mandate_confirmed === true,
  });
  if (error) throw new RepaymentPlanError(/^repayment_[a-z_]+$/.test(error.message) ? error.message : 'repayment_link_write_failed');
  return { success: true, ...data, quote };
}
