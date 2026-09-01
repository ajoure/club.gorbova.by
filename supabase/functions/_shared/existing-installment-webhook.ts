/* eslint-disable @typescript-eslint/no-explicit-any -- bePaid webhook shapes vary by event and are runtime-validated below */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createBepaidAuthHeader, getBepaidCredsStrict, isBepaidCredsError } from './bepaid-credentials.ts';

type UpsertPayment = (db: any, payload: Record<string, any>, prefix: string) => Promise<{ id: string | null; action: string; error?: string }>;

const TRACKING = /^repayment:([0-9a-f-]{36}):order:([0-9a-f-]{36})$/i;
const terminalProviderStates = new Set(['canceled', 'cancelled', 'failed', 'expired', 'completed', 'terminated']);

function response(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function isExistingInstallmentRepaymentTracking(value: string | null | undefined) {
  return !!value && TRACKING.test(value);
}

export async function handleExistingInstallmentRepaymentWebhook(input: {
  supabase: SupabaseClient;
  body: any;
  rawTrackingId: string;
  transaction: any;
  subscription: any;
  upsertPayment: UpsertPayment;
  corsHeaders: Record<string, string>;
}) {
  const { supabase, body, rawTrackingId, transaction, subscription, upsertPayment, corsHeaders } = input;
  const match = rawTrackingId.match(TRACKING)!;
  const [, linkId, orderId] = match;
  const subscriptionId = String(body?.id || subscription?.id || '');
  const transactionUid = String(transaction?.uid || transaction?.id || '');
  const transactionStatus = String(transaction?.status || '').toLowerCase();
  const transactionType = String(transaction?.type || body?.type || '').toLowerCase();
  const isRefund = transactionType === 'refund' || Boolean(body?.refund)
    || transaction?.refund_reason !== undefined;
  const providerState = String(body?.state || subscription?.state || '').toLowerCase();

  const { data: link } = await supabase.from('payment_links').select('*').eq('id', linkId).maybeSingle();
  const repayment = (link?.meta as any)?.repayment as Record<string, any> | undefined;
  if (!link || !repayment || repayment.contract_version !== 1 || repayment.original_order_id !== orderId
      || repayment.preserves_purchase !== true || repayment.changes_access !== false) {
    return response({ ok: false, status: 'manual_review', reason: 'repayment_link_mismatch' }, 202, corsHeaders);
  }
  const isSubscription = repayment.payment_type === 'subscription';
  if (isSubscription && (!subscriptionId || String(repayment.provider_subscription_id) !== subscriptionId)) {
    return response({ ok: false, status: 'manual_review', reason: 'repayment_provider_mismatch' }, 202, corsHeaders);
  }
  // The canonical webhook has already persisted every transaction, including
  // parent_uid, in payment_reconcile_queue before this routed handler runs.
  // Never reinterpret a successful refund as another installment payment.
  if (isRefund) {
    await supabase.from('audit_logs').insert({ actor_type: 'system', actor_label: 'existing-installment-webhook',
      action: 'installment.repayment_refund_queued_for_reconciliation', target_user_id: link.user_id,
      meta: { severity: 'WARNING', payment_link_id: linkId, order_id: orderId,
        refund_uid: transactionUid || null, parent_uid: transaction?.parent_uid || body?.parent_uid || null,
        changes_access: false } });
    return response({ ok: false, status: 'manual_review', reason: 'repayment_refund_requires_reconciliation',
      refund_queued: true }, 202, corsHeaders);
  }
  const succeeded = ['successful', 'settled', 'authorized'].includes(transactionStatus);
  if (!succeeded) {
    if (transactionUid && ['failed', 'expired'].includes(transactionStatus)) {
      await upsertPayment(supabase, {
        order_id: orderId, user_id: link.user_id, profile_id: null,
        amount: Number(transaction?.amount || 0) / 100, currency: transaction?.currency || 'BYN', status: 'failed',
        provider: 'bepaid', provider_payment_id: transactionUid, error_message: transaction?.message || transactionStatus,
        origin: 'bepaid', is_recurring: isSubscription,
        meta: { payment_link_id: linkId, payment_origin_detail: 'installment_repayment', repayment: true, tracking_id: rawTrackingId },
      }, '[REPAYMENT-WEBHOOK-FAILED]');
    }
    return response({ ok: true, status: 'repayment_waiting_for_success' }, 200, corsHeaders);
  }
  if (!transactionUid) return response({ ok: false, status: 'manual_review', reason: 'repayment_transaction_uid_missing' }, 202, corsHeaders);

  const [{ data: order }, { data: sub }, { data: providerRow }] = await Promise.all([
    supabase.from('orders_v2').select('id,user_id,profile_id,product_id,tariff_id,currency,meta').eq('id', orderId).maybeSingle(),
    supabase.from('subscriptions_v2').select('id,order_id,user_id,product_id,tariff_id,status,meta,access_start_at,access_end_at').eq('id', repayment.subscription_v2_id).maybeSingle(),
    isSubscription
      ? supabase.from('provider_subscriptions').select('*').eq('provider', 'bepaid').eq('provider_subscription_id', subscriptionId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!order || !sub || order.user_id !== link.user_id || sub.order_id !== order.id || sub.user_id !== order.user_id
      || sub.product_id !== order.product_id || sub.tariff_id !== order.tariff_id
      || (isSubscription && (!providerRow || providerRow.subscription_v2_id !== sub.id || providerRow.order_id !== order.id))) {
    return response({ ok: false, status: 'manual_review', reason: 'repayment_identity_mismatch' }, 202, corsHeaders);
  }
  const schedule = (repayment.schedule_minor || []).map(Number);
  const paidAmountMinor = Number(transaction?.amount || 0);
  if (!schedule.length || !Number.isSafeInteger(paidAmountMinor) || !schedule.includes(paidAmountMinor)) {
    return response({ ok: false, status: 'manual_review', reason: 'repayment_amount_mismatch' }, 202, corsHeaders);
  }

  const oldProviderId = String(
    (isSubscription ? (providerRow?.meta as any)?.repayment?.replaces_provider_subscription_id : null)
      || repayment.replaces_provider_subscription_id
      || '',
  );
  const paymentResult = await upsertPayment(supabase, {
    order_id: orderId, user_id: order.user_id, profile_id: order.profile_id,
    amount: paidAmountMinor / 100, currency: transaction?.currency || 'BYN', status: 'succeeded',
    provider: 'bepaid', provider_payment_id: transactionUid,
    card_brand: subscription?.card?.brand || body?.card?.brand || transaction?.credit_card?.brand || null,
    card_last4: subscription?.card?.last_4 || body?.card?.last_4 || transaction?.credit_card?.last_4 || null,
    paid_at: transaction?.paid_at || new Date().toISOString(), is_recurring: isSubscription, origin: 'bepaid',
    meta: { payment_link_id: linkId, payment_method: 'internal_installment', model: 'bepaid_finite_subscription',
      original_order_id: orderId, subscription_v2_id: sub.id, provider_subscription_id: subscriptionId || null,
      payment_origin_detail: 'installment_repayment', repayment: true, changes_access: false, tracking_id: rawTrackingId },
  }, '[REPAYMENT-WEBHOOK]');
  if (paymentResult.action === 'error') return response({ ok: false, status: 'manual_review', reason: 'repayment_payment_write_failed' }, 202, corsHeaders);

  // Record the provider's successful money fact first. The old mandate is
  // canceled only after the replacement card succeeds; a cancellation outage
  // must never make a real payment disappear from the ledger.
  if (oldProviderId && oldProviderId !== subscriptionId) {
    const creds = await getBepaidCredsStrict(supabase);
    let oldState = 'credentials_missing';
    if (!isBepaidCredsError(creds)) {
      const auth = createBepaidAuthHeader(creds);
      try {
        const before = await fetch(`https://api.bepaid.by/subscriptions/${encodeURIComponent(oldProviderId)}`, {
          headers: { Authorization: auth, Accept: 'application/json' },
        });
        const beforeBody = await before.json();
        oldState = String(beforeBody?.subscription?.state || beforeBody?.state || '').toLowerCase();
        if (!terminalProviderStates.has(oldState)) {
          const canceled = await fetch(`https://api.bepaid.by/subscriptions/${encodeURIComponent(oldProviderId)}/cancel`, {
            method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ cancel_reason: 'Replaced by customer-approved installment repayment link' }),
          });
          const canceledBody = await canceled.json();
          oldState = String(canceledBody?.subscription?.state || canceledBody?.state || '').toLowerCase();
        }
      } catch {
        oldState = 'transport_error';
      }
    }
    if (!terminalProviderStates.has(oldState)) {
      await supabase.from('payment_links').update({ meta: { ...(link.meta as any), repayment: { ...repayment,
        checkout_state: 'manual_review', manual_review_reason: 'old_mandate_cancel_failed',
        successful_payment_uid: transactionUid } } }).eq('id', linkId);
      await supabase.from('audit_logs').insert({ actor_type: 'system', actor_label: 'existing-installment-webhook',
        action: 'installment.repayment_old_mandate_cancel_failed', target_user_id: order.user_id,
        meta: { severity: 'CRITICAL', payment_link_id: linkId, payment_id: paymentResult.id, order_id: orderId,
          old_provider_subscription_id: oldProviderId, new_provider_subscription_id: subscriptionId, observed_state: oldState } });
      return response({ ok: false, status: 'manual_review', reason: 'repayment_old_mandate_cancel_failed', payment_recorded: true }, 202, corsHeaders);
    }
    const { data: oldLocal } = await supabase.from('provider_subscriptions').select('id,meta')
      .eq('provider', 'bepaid').eq('provider_subscription_id', oldProviderId).maybeSingle();
    const { error: oldLocalUpdateError } = await supabase.from('provider_subscriptions').update({ state: 'canceled', next_charge_at: null,
      meta: { ...((oldLocal?.meta as Record<string, unknown>) || {}), ignore_provider_events: true,
        replacement_confirmed_at: new Date().toISOString(), replaced_by_provider_subscription_id: subscriptionId || null,
        replacement_payment_link_id: linkId } })
      .eq('provider', 'bepaid').eq('provider_subscription_id', oldProviderId);
    if (oldLocalUpdateError) {
      return response({ ok: false, status: 'manual_review', reason: 'repayment_old_mandate_local_write_failed', payment_recorded: true }, 202, corsHeaders);
    }
  }

  const { data: paidRows, error: paidError } = await supabase.from('payments_v2')
    .select('id,provider,provider_payment_id,amount,status,is_deleted,refunded_amount,paid_at')
    .eq('order_id', orderId).eq('status', 'succeeded');
  if (paidError) return response({ ok: false, status: 'manual_review', reason: 'repayment_balance_read_failed' }, 202, corsHeaders);
  const unique = new Map<string, number>();
  for (const row of paidRows || []) {
    if (row.is_deleted || Number(row.refunded_amount || 0) > 0) continue;
    unique.set(`${row.provider}:${row.provider_payment_id || row.id}`, Number(row.amount || 0));
  }
  const total = Number((order.meta as any)?.installment?.effective_total_byn || 0);
  const paid = Number([...unique.values()].reduce((sum, n) => sum + n, 0).toFixed(2));
  const remaining = Number((total - paid).toFixed(2));
  if (!(total > 0) || remaining < 0) return response({ ok: false, status: 'manual_review', reason: 'repayment_balance_invalid' }, 202, corsHeaders);
  const agreement = (order.meta as any).installment;
  const completed = remaining === 0;
  const nextChargeAt = completed ? null : (body?.renew_at || subscription?.renew_at || null);
  const replacementBillingCycles = Number(repayment.paid_count || 0) + schedule.length;
  const progress = {
    model: 'bepaid_finite_subscription', billing_cycles: replacementBillingCycles,
    original_billing_cycles: agreement.billing_cycles,
    paid_billing_cycles: unique.size, remaining_cycles: Math.max(0, replacementBillingCycles - unique.size),
    remaining_billing_cycles: Math.max(0, replacementBillingCycles - unique.size),
    per_payment_byn: schedule[0] / 100, effective_total_byn: total,
    paid_total_byn: paid, remaining_total_byn: remaining, currency: 'BYN',
    last_cycle_paid_at: transaction?.paid_at || new Date().toISOString(),
    last_provider_payment_uid: transactionUid, next_charge_at: nextChargeAt,
    status: completed ? 'completed' : 'active', source: 'repayment_factual_ledger',
    subscription_v2_id: sub.id, provider_subscription_id: subscriptionId || null, updated_at: new Date().toISOString(),
  };
  const { error: orderUpdateError } = await supabase.from('orders_v2')
    .update({ meta: { ...(order.meta as any), installment_progress: progress } }).eq('id', orderId);
  const { error: subUpdateError } = await supabase.from('subscriptions_v2').update({ next_charge_at: nextChargeAt, auto_renew: false,
    meta: { ...(sub.meta as any), repayment_last_payment_link_id: linkId,
      ...(completed ? { installment_status: 'completed', installment_completed_at: new Date().toISOString() } : {}) } }).eq('id', sub.id);
  if (orderUpdateError || subUpdateError) {
    return response({ ok: false, status: 'manual_review', reason: 'repayment_progress_write_failed', payment_recorded: true }, 202, corsHeaders);
  }
  if (isSubscription) {
    const { error: providerUpdateError } = await supabase.from('provider_subscriptions').update({ state: completed ? 'completed' : (providerState || 'active'),
      next_charge_at: nextChargeAt, meta: { ...(providerRow.meta as any), repayment_balance_remaining_byn: remaining,
        repayment_last_payment_uid: transactionUid } }).eq('id', providerRow.id);
    if (providerUpdateError) {
      return response({ ok: false, status: 'manual_review', reason: 'repayment_provider_progress_write_failed', payment_recorded: true }, 202, corsHeaders);
    }
  }
  const { error: linkUpdateError } = await supabase.from('payment_links').update({ status: 'completed', current_uses: 1,
    meta: { ...(link.meta as any), repayment: { ...repayment, checkout_state: 'paid', paid_at: new Date().toISOString(),
      last_provider_payment_uid: transactionUid, remaining_minor_after: Math.round(remaining * 100) } } }).eq('id', linkId);
  if (linkUpdateError) {
    return response({ ok: false, status: 'manual_review', reason: 'repayment_link_completion_write_failed', payment_recorded: true }, 202, corsHeaders);
  }
  await supabase.from('audit_logs').insert({ actor_type: 'system', actor_label: 'existing-installment-webhook',
    action: 'installment.repayment_materialized', target_user_id: order.user_id,
    meta: { payment_link_id: linkId, payment_id: paymentResult.id, order_id: orderId, subscription_v2_id: sub.id,
      provider_subscription_id: subscriptionId || null, paid_minor: paidAmountMinor,
      remaining_minor_after: Math.round(remaining * 100), completed, new_orders: 0, new_subscriptions_v2: 0, changes_access: false } });
  return response({ ok: true, status: 'repayment_processed', completed, remaining_minor: Math.round(remaining * 100) }, 200, corsHeaders);
}
