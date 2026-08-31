// Exact, provider-verified queue recovery. No legacy writes, fuzzy identity
// matching, user creation or provider mutations. Only this module owns leases.
// deno-lint-ignore-file no-explicit-any
import { parseBepaidTrackingId } from './bepaid-tracking-id.ts';
import { isStaleProcessingItem, staleProcessingCutoff, staleTerminalReason } from './bepaid-queue-policy.ts';
import { calcCalendarMonthEnd } from './resolve-access-window.ts';
import { buildRebillOrderNumber } from './rebill/rebill_builders.ts';
import { runRebillFlow, classifyRebillAccessOutcome } from './rebill/rebill_flow.ts';
import { buildRebillDepsAdapter } from './rebill/rebill_deps_adapter.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SBS = /^sbs_[A-Za-z0-9_-]{1,128}$/;
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value) : null;
const sameMoney = (a: unknown, b: unknown) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) < 0.005;

async function checked(query: any, label: string): Promise<any> {
  const result = await query;
  if (result.error) throw new Error(`recovery_${label}_failed`);
  return result.data;
}
const one = (db: any, table: string, id: string) => checked(db.from(table).select('*').eq('id', id).maybeSingle(), table);

export function queueProviderSubscriptionId(item: any): string | null {
  const raw = item.raw_payload || {};
  const values = [raw.subscription_id, raw.id, raw.subscription?.id, raw.transaction?.subscription_id]
    .filter((value): value is string => typeof value === 'string' && SBS.test(value));
  const unique = [...new Set(values)];
  if (unique.length > 1) throw new Error('recovery_ambiguous_provider_subscription');
  return unique[0] ?? null;
}

async function providerGet(fetcher: typeof fetch, url: string, auth: string) {
  const response = await fetcher(url, { method: 'GET', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: auth, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`recovery_provider_http_${response.status}`);
  return await response.json();
}

async function paymentByUid(db: any, uid: string) {
  return await checked(db.from('payments_v2').select('*').eq('provider', 'bepaid')
    .eq('provider_payment_id', uid).maybeSingle(), 'payment_lookup');
}

async function fulfillmentProof(db: any, order: any, now: Date) {
  const ents = await checked(db.from('entitlements').select('*').eq('user_id', order.user_id)
    .eq('product_id', order.product_id).eq('status', 'active'), 'entitlement_proof');
  const subs = await checked(db.from('subscriptions_v2').select('*').eq('user_id', order.user_id)
    .eq('product_id', order.product_id).eq('tariff_id', order.tariff_id).eq('status', 'active'), 'subscription_proof');
  const ledger = await checked(db.from('access_grant_ledger').select('*')
    .eq('source_order_id', order.id), 'ledger_proof');
  const belongs = (row: any) => row.order_id === order.id || (row.meta?.extended_by_orders || []).includes(order.id);
  const activeSub = (subs || []).find((row: any) => belongs(row) && date(row.access_end_at) && date(row.access_end_at)! > now);
  const activeEnt = (ents || []).find((row: any) => date(row.expires_at) && date(row.expires_at)! > now);
  const deliveryRecorded = (ledger || []).some((row: any) => ['granted', 'extended'].includes(row.status));
  return !!activeSub && !!activeEnt && (belongs(activeEnt) || deliveryRecorded);
}

async function loadPlan(db: any, item: any, auth: string, fetcher: typeof fetch, now: Date, explicitSbs?: string) {
  if (!UID.test(item.bepaid_uid || '')) throw new Error('recovery_missing_provider_uid');
  const uid = item.bepaid_uid;
  const response = await providerGet(fetcher, `https://gateway.bepaid.by/transactions/${encodeURIComponent(uid)}`, auth);
  const tx = response.transaction;
  if (!tx || tx.uid !== uid || !['successful', 'succeeded'].includes(tx.status) ||
      !['payment', 'capture'].includes(tx.type) || !Number.isInteger(tx.amount) || tx.amount <= 0 ||
      !sameMoney(tx.amount / 100, item.amount) || tx.currency !== item.currency || !date(tx.paid_at)) {
    throw new Error('recovery_provider_payment_mismatch');
  }
  const payment = { uid, amount: tx.amount / 100, currency: tx.currency, paid_at: new Date(tx.paid_at).toISOString() };
  const refunds = await checked(db.from('payments_v2').select('amount,status,refunded_amount,meta')
    .or(`provider_payment_id.eq.${uid},meta->>parent_payment_uid.eq.${uid}`), 'refund_lookup');
  if ((refunds || []).some((row: any) => Number(row.amount) < 0 || row.status === 'refunded' || Number(row.refunded_amount) > 0)) {
    throw new Error('recovery_refund_requires_review');
  }

  const tracking = parseBepaidTrackingId(item.tracking_id);
  let sbs = queueProviderSubscriptionId(item);
  // Old transaction-only events may omit SBS. An authorized exact recovery
  // can supply the provider ID obtained during preflight, but cannot override
  // conflicting event evidence. GET must still prove its last UID == this UID.
  if (explicitSbs !== undefined) {
    if (!SBS.test(explicitSbs) || (sbs && sbs !== explicitSbs)) throw new Error('recovery_explicit_subscription_mismatch');
    sbs = explicitSbs;
  }
  if (!sbs && tracking.subscriptionV2Id && UUID.test(tracking.subscriptionV2Id)) {
    const link = await checked(db.from('provider_subscriptions').select('provider_subscription_id')
      .eq('provider', 'bepaid').eq('subscription_v2_id', tracking.subscriptionV2Id).eq('state', 'active').maybeSingle(), 'tracking_provider_link');
    sbs = link?.provider_subscription_id ?? null;
  }
  if (tracking.kind === 'subv2' && !sbs) throw new Error('recovery_missing_provider_link');
  let ps: any = null;
  let providerSub: any = null;
  let sub: any = null;
  if (sbs) {
    const value = await providerGet(fetcher, `https://api.bepaid.by/subscriptions/${encodeURIComponent(sbs)}`, auth);
    providerSub = value.subscription || value;
    if ((providerSub.id && providerSub.id !== sbs) || (providerSub.state || providerSub.status) !== 'active' ||
        providerSub.last_transaction?.uid !== uid || !date(providerSub.renew_at || providerSub.next_billing_at)) {
      throw new Error('recovery_provider_subscription_mismatch');
    }
    ps = await checked(db.from('provider_subscriptions').select('*').eq('provider', 'bepaid')
      .eq('provider_subscription_id', sbs).maybeSingle(), 'provider_link');
    if (!ps?.subscription_v2_id || ps.state !== 'active') throw new Error('recovery_missing_provider_link');
    sub = await one(db, 'subscriptions_v2', ps.subscription_v2_id);
    if (!sub) throw new Error('recovery_missing_subscription');
  }
  const existingPayment = await paymentByUid(db, uid);
  if (existingPayment && (existingPayment.status !== 'succeeded' || !sameMoney(existingPayment.amount, payment.amount) ||
      existingPayment.currency !== payment.currency || !existingPayment.order_id)) {
    throw new Error('recovery_existing_payment_requires_review');
  }
  let parent = existingPayment ? await one(db, 'orders_v2', existingPayment.order_id) : null;
  if (!parent && sub?.order_id) parent = await one(db, 'orders_v2', sub.order_id);
  if (!parent && ps?.order_id) parent = await one(db, 'orders_v2', ps.order_id);
  const providerTracking = parseBepaidTrackingId(tx.tracking_id);
  if (!sbs && (!providerTracking.orderId || providerTracking.orderId !== tracking.orderId)) {
    throw new Error('recovery_provider_tracking_mismatch');
  }
  if (!parent && providerTracking.orderId && UUID.test(providerTracking.orderId)) parent = await one(db, 'orders_v2', providerTracking.orderId);
  if (!parent?.profile_id || !parent.user_id || !parent.product_id || !parent.tariff_id ||
      !['paid', 'pending', 'processing'].includes(parent.status)) throw new Error('recovery_no_canonical_order');
  const profile = await one(db, 'profiles', parent.profile_id);
  if (!profile?.user_id || profile.user_id !== parent.user_id) throw new Error('recovery_current_user_mismatch');
  const user = await db.auth.admin.getUserById(profile.user_id);
  if (user.error || !user.data?.user || user.data.user.id !== profile.user_id) throw new Error('recovery_auth_user_missing');
  if (existingPayment && ((existingPayment.user_id && existingPayment.user_id !== profile.user_id) ||
      (existingPayment.profile_id && existingPayment.profile_id !== profile.id))) throw new Error('recovery_payment_identity_mismatch');

  const alreadyFulfilled = !!existingPayment && parent.status === 'paid' && await fulfillmentProof(db, parent, now);
  if (sbs && !alreadyFulfilled) {
    if (sub.profile_id !== profile.id || sub.user_id !== profile.user_id || sub.product_id !== parent.product_id ||
        sub.tariff_id !== parent.tariff_id || ['canceled', 'superseded', 'expired_reentry'].includes(sub.status) ||
        (ps.user_id && ps.user_id !== profile.user_id)) throw new Error('recovery_subscription_identity_mismatch');
    const active = await checked(db.from('subscriptions_v2').select('id,meta').eq('user_id', profile.user_id)
      .eq('product_id', parent.product_id).eq('tariff_id', parent.tariff_id).eq('status', 'active'), 'foreign_subscription');
    if ((active || []).some((row: any) => row.id !== sub.id)) throw new Error('recovery_foreign_subscription');
  }
  const priorPayments = existingPayment ? [] : await checked(db.from('payments_v2').select('id,provider_payment_id')
    .eq('order_id', parent.id).eq('status', 'succeeded').gt('amount', 0), 'parent_payments');
  const isRebill = !!sbs && !existingPayment && priorPayments.length > 0;
  if (isRebill && parent.status !== 'paid') throw new Error('recovery_parent_not_paid');
  if (sbs && !existingPayment && !isRebill) throw new Error('recovery_missing_recurring_parent_payment');
  if (parent.meta?.do_not_grant_access || parent.meta?.refund_candidate || parent.meta?.grant_status === 'suppressed_post_cancel_charge') {
    throw new Error('recovery_suppressed_order');
  }
  if (!existingPayment && !isRebill && !sameMoney(parent.final_price, payment.amount)) throw new Error('recovery_partial_payment_requires_review');
  const existingRebill = isRebill ? await checked(db.from('orders_v2').select('*')
    .eq('order_number', buildRebillOrderNumber(uid)).maybeSingle(), 'rebill_lookup') : null;
  if (existingRebill && (existingRebill.provider_payment_id !== uid || existingRebill.user_id !== profile.user_id ||
      existingRebill.product_id !== parent.product_id || existingRebill.tariff_id !== parent.tariff_id)) {
    throw new Error('recovery_rebill_identity_mismatch');
  }
  const savedStart = (existingRebill || parent).meta?.recovery_access_start_at;
  const accessStart = savedStart ? date(savedStart) : new Date(Math.max(Date.parse(payment.paid_at),
    isRebill && date(sub?.access_end_at) ? Date.parse(sub.access_end_at) : Date.parse(payment.paid_at)));
  if (!accessStart) throw new Error('recovery_invalid_saved_window');
  const product = await one(db, 'products_v2', parent.product_id);
  const tariff = await one(db, 'tariffs', parent.tariff_id);
  if (!product || !tariff || tariff.product_id !== product.id) throw new Error('recovery_catalog_mismatch');
  const expectedEnd = product.meta?.access_window_rule === 'calendar_month' ? calcCalendarMonthEnd(accessStart)
    : new Date(accessStart.getTime() + (tariff.access_days ?? 30) * 86_400_000);
  return { item, uid, payment, sbs, ps, sub, parent, profile, existingPayment, existingRebill, isRebill,
    alreadyFulfilled, accessStart: accessStart.toISOString(), expectedEnd: expectedEnd.toISOString(),
    nextCharge: providerSub ? new Date(providerSub.renew_at || providerSub.next_billing_at).toISOString() : null };
}

function safePlan(plan: any) {
  return { queue_id: plan.item.id, provider_payment_id: plan.uid, parent_order_id: plan.parent.id,
    order_id: plan.existingPayment?.order_id || plan.existingRebill?.id || (plan.isRebill ? null : plan.parent.id),
    subscription_v2_id: plan.sub?.id ?? null, amount: plan.payment.amount, currency: plan.payment.currency,
    paid_at: plan.payment.paid_at, access_start_at: plan.accessStart, expected_access_end_at: plan.expectedEnd,
    provider_next_charge_at: plan.nextCharge, already_fulfilled: plan.alreadyFulfilled,
    expected_orders_created: plan.isRebill && !plan.existingRebill ? 1 : 0,
    expected_payments_created: plan.existingPayment ? 0 : 1,
    will_invoke_grant: !plan.alreadyFulfilled, queue_updated_at: plan.item.updated_at };
}

async function executePlan(db: any, plan: any) {
  // Re-read identities after the CAS and before any business write. A moved
  // provider link or changed profile must never be repaired by guessing.
  const currentProfile = await one(db, 'profiles', plan.profile.id);
  const currentParent = await one(db, 'orders_v2', plan.parent.id);
  if (currentProfile?.user_id !== plan.profile.user_id || !currentParent ||
      ['user_id', 'profile_id', 'product_id', 'tariff_id', 'status'].some(key => currentParent[key] !== plan.parent[key])) {
    throw new Error('recovery_identity_changed');
  }
  if (plan.ps) {
    const currentPs = await one(db, 'provider_subscriptions', plan.ps.id);
    const currentSub = await one(db, 'subscriptions_v2', plan.sub.id);
    if (!currentPs || currentPs.updated_at !== plan.ps.updated_at || currentPs.state !== 'active' ||
        currentPs.subscription_v2_id !== plan.sub.id || !currentSub ||
        ['user_id', 'profile_id', 'product_id', 'tariff_id', 'status', 'access_end_at'].some(key => currentSub[key] !== plan.sub[key])) {
      throw new Error('recovery_provider_link_changed');
    }
  }
  let orderId = plan.existingPayment?.order_id || plan.parent.id;
  const grant = async (id: string) => {
    const order = await one(db, 'orders_v2', id);
    const start = order?.meta?.recovery_access_start_at;
    const result = await db.functions.invoke('grant-access-for-order', { body: { orderId: id,
      grantTelegram: true, grantGetcourse: false, context: 'historical_payment_recovery',
      ...(start ? { customAccessStartAt: start, customAccessEndAt: order.meta.recovery_expected_end_at } : {}) } });
    if (result.error || result.data?.success !== true) throw new Error('recovery_canonical_grant_failed');
    return result.data;
  };
  if (plan.isRebill) {
    const base = buildRebillDepsAdapter(db);
    const deps = { ...base,
      findRebillOrderByOrderNumber: (number: string) => checked(db.from('orders_v2').select('id,order_number,meta')
        .eq('order_number', number).maybeSingle(), 'rebill_lookup'),
      findMainPaymentByUid: (uid: string) => paymentByUid(db, uid),
      // Provider/payment/foreign-SBS guards were verified before the claim.
      sumRefundsForPaymentUid: async () => {
        const rows = await checked(db.from('payments_v2').select('amount,status,refunded_amount')
          .or(`provider_payment_id.eq.${plan.uid},meta->>parent_payment_uid.eq.${plan.uid}`), 'refund_recheck');
        if ((rows || []).some((row: any) => row.amount < 0 || row.status === 'refunded' || Number(row.refunded_amount) > 0)) {
          throw new Error('recovery_refund_requires_review');
        }
        return 0;
      },
      checkSbsMismatchBeforeRebill: async () => {
        const rows = await checked(db.from('subscriptions_v2').select('id').eq('user_id', plan.profile.user_id)
          .eq('product_id', plan.parent.product_id).eq('tariff_id', plan.parent.tariff_id).eq('status', 'active'), 'foreign_recheck');
        return { mismatch: (rows || []).some((row: any) => row.id !== plan.sub.id) };
      },
      insertRebillOrder: (payload: Record<string, unknown>) => base.insertRebillOrder({ ...payload,
        meta: { ...(payload.meta as Record<string, unknown>), recovery_access_start_at: plan.accessStart,
          recovery_expected_end_at: plan.expectedEnd, recovery_queue_id: plan.item.id } }),
      updatePaymentOrderId: async ({ payment_id, rebill_order_id }: any) => {
        const payment = await one(db, 'payments_v2', payment_id);
        if (payment?.order_id !== rebill_order_id) throw new Error('recovery_payment_rebind_forbidden');
      },
      invokeGrantAccess: grant,
      mergeOrderMeta: async ({ orderId: id, patch }: any) => {
        const current = await one(db, 'orders_v2', id);
        if (!current) throw new Error('recovery_order_missing');
        const updated = await checked(db.from('orders_v2').update({ meta: { ...current.meta, ...patch } })
          .eq('id', id).select('id').maybeSingle(), 'order_meta');
        if (!updated) throw new Error('recovery_order_meta_conflict');
      },
      writeAudit: async ({ action, meta }: any) => { await checked(db.from('audit_logs').insert({
        actor_type: 'system', actor_user_id: null, actor_label: 'payments-reconcile', action, meta,
      }), 'audit'); },
    };
    const result = await runRebillFlow(deps, { mode: 'on', parentOrder: plan.parent,
      payment: plan.payment, subscriptionId: plan.sbs });
    if (classifyRebillAccessOutcome(result.decision) !== 'ok' || !result.rebill_order_id) {
      throw new Error(`recovery_${result.decision}`);
    }
    orderId = result.rebill_order_id;
  } else if (!plan.alreadyFulfilled) {
    if (!plan.existingPayment) {
      await checked(db.from('payments_v2').insert({ order_id: orderId, profile_id: plan.profile.id,
        user_id: plan.profile.user_id, provider: 'bepaid', provider_payment_id: plan.uid, status: 'succeeded',
        amount: plan.payment.amount, currency: plan.payment.currency, paid_at: plan.payment.paid_at,
        is_recurring: !!plan.sbs, meta: { source: 'payments_reconcile', queue_id: plan.item.id } }), 'payment_insert');
    }
    if (plan.parent.status !== 'paid') {
      const updated = await checked(db.from('orders_v2').update({ status: 'paid', paid_amount: plan.payment.amount })
        .eq('id', orderId).eq('status', plan.parent.status).select('id').maybeSingle(), 'order_paid');
      if (!updated) throw new Error('recovery_order_paid_conflict');
    }
    await grant(orderId);
  }
  const persisted = await paymentByUid(db, plan.uid);
  if (!persisted || persisted.order_id !== orderId || !sameMoney(persisted.amount, plan.payment.amount) ||
      persisted.currency !== plan.payment.currency || persisted.status !== 'succeeded') throw new Error('recovery_payment_readback_failed');
  const fulfilledOrder = await one(db, 'orders_v2', orderId);
  if (fulfilledOrder?.status !== 'paid' || !await fulfillmentProof(db, fulfilledOrder, new Date())) {
    throw new Error('recovery_fulfillment_readback_failed');
  }
  if (plan.isRebill) {
    const grantedSub = await one(db, 'subscriptions_v2', plan.sub.id);
    const end = date(grantedSub?.access_end_at);
    if (!end || end.toISOString() !== plan.expectedEnd || grantedSub.status !== 'active') {
      throw new Error('recovery_access_window_readback_failed');
    }
    const entitlements = await checked(db.from('entitlements').select('expires_at').eq('user_id', plan.profile.user_id)
      .eq('product_id', plan.parent.product_id).eq('status', 'active'), 'entitlement_window_readback');
    if (!(entitlements || []).some((row: any) => date(row.expires_at) && Date.parse(row.expires_at) >= Date.parse(plan.expectedEnd))) {
      throw new Error('recovery_entitlement_window_readback_failed');
    }
  }
  if (plan.sbs) {
    const current = await one(db, 'provider_subscriptions', plan.ps.id);
    if (!current || current.subscription_v2_id !== plan.ps.subscription_v2_id || current.provider_subscription_id !== plan.sbs ||
        current.state !== 'active') throw new Error('recovery_provider_link_changed');
    // Never rebind a provider subscription here. Synchronize verified billing
    // timestamps only; access remains owned by grant-access-for-order.
    const updated = await checked(db.from('provider_subscriptions').update({
      last_charge_at: plan.payment.paid_at, next_charge_at: plan.nextCharge,
    }).eq('id', current.id).eq('updated_at', current.updated_at).select('id').maybeSingle(), 'provider_sync');
    if (!updated) throw new Error('recovery_provider_sync_conflict');
  }
  return orderId;
}

export async function reconcileExactQueuePayment(db: any, options: {
  queueItemId: string; dryRun?: boolean; expectedUpdatedAt?: string; providerSubscriptionId?: string;
  providerAuth: string; fetcher?: typeof fetch; now?: Date;
}) {
  if (!UUID.test(options.queueItemId)) throw new Error('recovery_invalid_queue_id');
  const now = options.now || new Date();
  const item = await one(db, 'payment_reconcile_queue', options.queueItemId);
  if (!item) throw new Error('recovery_queue_missing');
  if (options.expectedUpdatedAt && options.expectedUpdatedAt !== item.updated_at) throw new Error('recovery_queue_snapshot_changed');
  const stale = isStaleProcessingItem(item, staleProcessingCutoff(now));
  if (item.status === 'processing' && !stale) return { success: true, claim_conflicts: 1, results: { orders_reconciled: 0 } };
  const terminal = staleTerminalReason(item, { maxAttempts: 5, excludeCancelled: true, excludeFileImport: true, queueItemId: null });
  if (terminal) {
    if (options.dryRun) return { success: true, dry_run: true, no_writes: true, terminal_reason: terminal };
    if (!stale) throw new Error('recovery_queue_requires_manual_review');
    const released = await checked(db.from('payment_reconcile_queue').update({ status: 'error',
      last_error: terminal === 'STALE_PROCESSING_CANCELLED' ? `${item.last_error}; ${terminal}` : `${terminal}: worker interrupted`,
      next_retry_at: null }).eq('id', item.id).eq('status', 'processing').eq('updated_at', item.updated_at)
      .select('id').maybeSingle(), 'terminal_release');
    return { success: true, stale_terminal: released ? 1 : 0, claim_conflicts: released ? 0 : 1, results: { orders_reconciled: 0 } };
  }
  if (!['pending', 'error', 'processing', 'successful', 'completed'].includes(item.status)) throw new Error('recovery_queue_requires_manual_review');
  const plan = await loadPlan(db, item, options.providerAuth, options.fetcher || fetch, now, options.providerSubscriptionId);
  if (options.dryRun) return { success: true, dry_run: true, no_writes: true, plan: safePlan(plan) };
  if (item.status === 'completed' && plan.alreadyFulfilled) return { success: true, already_completed: true, results: { already_materialized: 1 } };
  if (!['pending', 'error', 'processing', 'successful'].includes(item.status) || (item.attempts || 0) >= 5) {
    throw new Error('recovery_queue_requires_manual_review');
  }
  const claimed = await checked(db.from('payment_reconcile_queue').update({ status: 'processing',
    attempts: (item.attempts || 0) + 1, last_attempt_at: now.toISOString() })
    .eq('id', item.id).eq('status', item.status).eq('updated_at', item.updated_at)
    .select('id,updated_at').maybeSingle(), 'claim');
  if (!claimed?.updated_at) return { success: true, claim_conflicts: 1, results: { orders_reconciled: 0 } };
  try {
    const orderId = await executePlan(db, plan);
    const completed = await checked(db.from('payment_reconcile_queue').update({ status: 'completed',
      processed_at: new Date().toISOString(), processed_order_id: orderId, matched_order_id: orderId,
      matched_profile_id: plan.profile.id, last_error: null, next_retry_at: null })
      .eq('id', item.id).eq('status', 'processing').eq('updated_at', claimed.updated_at)
      .select('id,status').maybeSingle(), 'queue_complete');
    if (completed?.status !== 'completed') throw new Error('recovery_queue_completion_conflict');
    return { success: true, stale_recovered: stale ? 1 : 0, order_id: orderId,
      results: { orders_reconciled: 1, orders_created: plan.isRebill && !plan.existingRebill ? 1 : 0,
        already_materialized: plan.alreadyFulfilled ? 1 : 0, errors: [] } };
  } catch (error) {
    const message = error instanceof Error && /^recovery_[a-z0-9_]+$/.test(error.message) ? error.message : 'recovery_execution_failed';
    await checked(db.from('payment_reconcile_queue').update({ status: 'error', last_error: message,
      next_retry_at: (item.attempts || 0) + 1 < 5 ? new Date(now.getTime() + 3_600_000).toISOString() : null })
      .eq('id', item.id).eq('status', 'processing').eq('updated_at', claimed.updated_at), 'queue_error');
    throw new Error(message);
  }
}
