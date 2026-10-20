import { courseAccessEnd } from './course-access-window.ts';
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

// A historical webhook may have persisted a provider timestamp at whole-second
// precision. Accept only truncation within that exact second, never a rolling
// tolerance or a mismatch between two fractional timestamps. UID, money,
// tracking and the paid successor are still independently proved below.
function sameHistoricalPaidAt(providerValue: unknown, storedValue: unknown) {
  const provider = date(providerValue), stored = date(storedValue);
  if (!provider || !stored) return false;
  const providerMs = provider.getTime(), storedMs = stored.getTime();
  return providerMs === storedMs || (storedMs % 1000 === 0 &&
    Math.floor(providerMs / 1000) === Math.floor(storedMs / 1000));
}

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
  let response: Response;
  try {
    response = await fetcher(url, { method: 'GET', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: auth, Accept: 'application/json' } });
  } catch {
    throw new Error('recovery_provider_unavailable');
  }
  if (response.status === 429 || response.status >= 500) throw new Error('recovery_provider_unavailable');
  if (!response.ok) throw new Error(`recovery_provider_http_${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error('recovery_provider_unavailable');
  }
}

function safeRecoveryError(error: unknown, fallback: string) {
  return error instanceof Error && /^recovery_[a-z0-9_]+$/.test(error.message) ? error.message : fallback;
}

async function paymentByUid(db: any, uid: string) {
  return await checked(db.from('payments_v2').select('*').eq('provider', 'bepaid')
    .eq('provider_payment_id', uid).maybeSingle(), 'payment_lookup');
}

async function fulfillmentProof(db: any, order: any, now: Date, minimumEnd?: Date) {
  const ents = await checked(db.from('entitlements').select('*').eq('user_id', order.user_id)
    .eq('product_id', order.product_id).eq('status', 'active'), 'entitlement_proof');
  const subs = await checked(db.from('subscriptions_v2').select('*').eq('user_id', order.user_id)
    .eq('product_id', order.product_id).eq('tariff_id', order.tariff_id).eq('status', 'active'), 'subscription_proof');
  const ledger = await checked(db.from('access_grant_ledger').select('*')
    .eq('source_order_id', order.id), 'ledger_proof');
  const belongs = (row: any) => row.order_id === order.id || (row.meta?.extended_by_orders || []).includes(order.id);
  const reachesWindow = (value: unknown) => {
    const end = date(value);
    return !!end && end > now && (!minimumEnd || end >= minimumEnd);
  };
  const activeSub = (subs || []).find((row: any) => belongs(row) && reachesWindow(row.access_end_at));
  const activeEnt = (ents || []).find((row: any) => reachesWindow(row.expires_at));
  const deliveryRecorded = (ledger || []).some((row: any) => ['granted', 'extended'].includes(row.status));
  return !!activeSub && !!activeEnt && (belongs(activeEnt) || deliveryRecorded);
}

export interface PaidContinuationRepair {
  sourceSubscriptionId: string;
  targetSubscriptionId: string;
  previousPaymentUid: string;
  expectedProviderUpdatedAt: string;
}

// Explicit manual repair only. A superseded row is NOT generally eligible for
// recovery. Prove its trigger-created paid successor and the same provider
// tracking chain before even planning a provider-link CAS.
async function paidContinuation(db: any, ps: any, tx: any, repair: PaidContinuationRepair,
  auth: string, fetcher: typeof fetch) {
  if (!repair || !UUID.test(repair.sourceSubscriptionId || '') || !UUID.test(repair.targetSubscriptionId || '') ||
      repair.sourceSubscriptionId === repair.targetSubscriptionId || !UID.test(repair.previousPaymentUid || '') ||
      !date(repair.expectedProviderUpdatedAt) || ps.updated_at !== repair.expectedProviderUpdatedAt) {
    throw new Error('recovery_continuation_snapshot_invalid');
  }
  const source = await one(db, 'subscriptions_v2', repair.sourceSubscriptionId);
  const target = await one(db, 'subscriptions_v2', repair.targetSubscriptionId);
  const prior = await paymentByUid(db, repair.previousPaymentUid);
  const parent = prior?.order_id ? await one(db, 'orders_v2', prior.order_id) : null;
  const sourceOrder = source?.order_id ? await one(db, 'orders_v2', source.order_id) : null;
  if (!source || !target || !prior || !parent || !sourceOrder || source.status !== 'superseded' || source.canceled_at ||
      !['active', 'expired'].includes(target.status) || target.canceled_at || target.auto_renew_disabled_at ||
      prior.status !== 'succeeded' || parent.status !== 'paid' || sourceOrder.status !== 'paid' ||
      target.meta?.initial_order_id !== parent.id || target.order_id !== parent.id ||
      ['user_id','profile_id','product_id','tariff_id'].some(key => !target[key] || target[key] !== parent[key]) ||
      ['user_id','product_id','tariff_id'].some(key => source[key] !== target[key] || sourceOrder[key] !== target[key]) ||
      prior.user_id !== target.user_id || prior.profile_id !== target.profile_id || ps.user_id !== target.user_id ||
      !sameMoney(prior.amount, tx.amount / 100) || !sameMoney(parent.final_price, prior.amount) || prior.currency !== tx.currency || parent.currency !== prior.currency) {
    throw new Error('recovery_continuation_identity_mismatch');
  }
  for (const order of [sourceOrder, parent]) {
    if (order.meta?.do_not_grant_access || order.meta?.refund_candidate || order.meta?.grant_status === 'suppressed_post_cancel_charge') {
      throw new Error('recovery_continuation_suppressed');
    }
  }
  const priorTxResponse = await providerGet(fetcher, `https://gateway.bepaid.by/transactions/${encodeURIComponent(repair.previousPaymentUid)}`, auth);
  const previous = priorTxResponse.transaction;
  const a = parseBepaidTrackingId(previous?.tracking_id), b = parseBepaidTrackingId(tx.tracking_id);
  if (!previous || previous.uid !== repair.previousPaymentUid || !['successful','succeeded'].includes(previous.status) ||
      !['payment','capture'].includes(previous.type) || !sameMoney(previous.amount / 100, prior.amount) ||
      previous.currency !== prior.currency || !date(previous.paid_at) || !date(tx.paid_at) ||
      !sameHistoricalPaidAt(previous.paid_at, prior.paid_at) ||
      Date.parse(previous.paid_at) >= Date.parse(tx.paid_at) ||
      !a.orderId || a.kind !== 'link_order' || b.kind !== 'link_order' || a.orderId !== b.orderId) {
    throw new Error('recovery_continuation_provider_chain_mismatch');
  }
  const refundRows = await checked(db.from('payments_v2').select('amount,status,refunded_amount,meta')
    .or(`provider_payment_id.eq.${repair.previousPaymentUid},meta->>parent_payment_uid.eq.${repair.previousPaymentUid}`), 'continuation_refunds');
  if (refundRows.some((row: any) => Number(row.amount) < 0 || row.status === 'refunded' || Number(row.refunded_amount) > 0)) {
    throw new Error('recovery_refund_requires_review');
  }
  const audit = await checked(db.from('audit_logs').select('created_at,meta')
    .eq('action', 'subscription.auto_superseded').eq('actor_label', 'trg_close_superseded')
    .contains('meta', { new_subscription_id: target.id, user_id: target.user_id, product_id: target.product_id }), 'continuation_audit');
  if (!audit.some((row: any) => date(row.created_at) && date(source.updated_at) && date(target.created_at) &&
      Math.abs(Date.parse(row.created_at) - Date.parse(source.updated_at)) <= 1000 &&
      Math.abs(Date.parse(row.created_at) - Date.parse(target.created_at)) <= 1000)) {
    throw new Error('recovery_continuation_rollover_unproven');
  }
  const tupleSubs = await checked(db.from('subscriptions_v2').select('id')
    .eq('user_id', target.user_id).eq('product_id', target.product_id).eq('tariff_id', target.tariff_id), 'continuation_tuple');
  const streams = await checked(db.from('provider_subscriptions').select('provider_subscription_id')
    .eq('provider', 'bepaid').eq('user_id', target.user_id)
    .in('subscription_v2_id', tupleSubs.map((row: any) => row.id)).limit(7), 'continuation_streams');
  const others = [...new Set<string>(streams.map((row: any) => row.provider_subscription_id))]
    .filter(id => id !== ps.provider_subscription_id);
  if (streams.length >= 7 || others.length > 5) throw new Error('recovery_continuation_stream_limit');
  for (const id of others) {
    if (!SBS.test(id)) throw new Error('recovery_continuation_unknown_stream');
    const value = await providerGet(fetcher, `https://api.bepaid.by/subscriptions/${encodeURIComponent(id)}`, auth);
    const other = value.subscription || value;
    if (other.id !== id || !['canceled','cancelled','terminated','expired','completed','failed','error']
      .includes(String(other.state || other.status).toLowerCase())) {
      throw new Error('recovery_continuation_competing_provider_stream');
    }
  }
  const receipt = ps.meta?.paid_continuation_repair;
  const alreadyRelinked = ps.subscription_v2_id === target.id && receipt?.source_subscription_id === source.id &&
    receipt?.target_subscription_id === target.id && receipt?.payment_uid === tx.uid;
  if (ps.subscription_v2_id !== source.id && !alreadyRelinked) throw new Error('recovery_continuation_link_changed');
  return { source, target, parent, alreadyRelinked };
}

async function loadPlan(db: any, item: any, auth: string, fetcher: typeof fetch, now: Date, explicitSbs?: string, repair?: PaidContinuationRepair) {
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
  let continuation: any = null;
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
    if (repair) {
      continuation = await paidContinuation(db, ps, tx, repair, auth, fetcher);
      sub = continuation.target;
    }
  }
  if (repair && !continuation) throw new Error('recovery_continuation_provider_required');
  const existingPayment = await paymentByUid(db, uid);
  if (existingPayment && (existingPayment.status !== 'succeeded' || !sameMoney(existingPayment.amount, payment.amount) ||
      existingPayment.currency !== payment.currency || !existingPayment.order_id)) {
    throw new Error('recovery_existing_payment_requires_review');
  }
  let parent = existingPayment ? await one(db, 'orders_v2', existingPayment.order_id) : continuation?.parent ?? null;
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
  // A saved window belongs to THIS payment's order, never to the preceding
  // cycle used as a parent when creating a new REBILL.
  const windowOwner = existingPayment ? (parent.provider_payment_id === uid ? parent : null) : existingRebill;
  const savedStart = windowOwner?.meta?.recovery_access_start_at;
  const savedEnd = windowOwner?.meta?.recovery_expected_end_at;
  if (!!savedStart !== !!savedEnd || (savedEnd && !date(savedEnd))) throw new Error('recovery_invalid_saved_window');
  const product = await one(db, 'products_v2', parent.product_id);
  const tariff = await one(db, 'tariffs', parent.tariff_id);
  if (!product || !tariff || tariff.product_id !== product.id) throw new Error('recovery_catalog_mismatch');
  const fixedCourseEnd = courseAccessEnd(tariff.meta);
  // An installment finances the same course window; it does not start after
  // the already granted end of that course.
  const accessStart = savedStart ? date(savedStart) : new Date(Math.max(Date.parse(payment.paid_at),
    !fixedCourseEnd && isRebill && date(sub?.access_end_at) ? Date.parse(sub.access_end_at) : Date.parse(payment.paid_at)));
  if (!accessStart) throw new Error('recovery_invalid_saved_window');
  const expectedEnd = savedEnd ? date(savedEnd)! : fixedCourseEnd ? fixedCourseEnd : product.meta?.access_window_rule === 'calendar_month' ? calcCalendarMonthEnd(accessStart)
    : new Date(accessStart.getTime() + (tariff.access_days ?? 30) * 86_400_000);
  if (!Number.isFinite(expectedEnd.getTime()) || expectedEnd <= accessStart) throw new Error('recovery_invalid_saved_window');
  // A fixed/course installment must not be interpreted as purchasing the
  // entire tariff duration again. Only an explicit calendar-month policy or
  // this payment's immutable recovery window establishes this lower bound.
  const minimumEnd = savedEnd || fixedCourseEnd || product.meta?.access_window_rule === 'calendar_month' ? expectedEnd : undefined;
  // Still-active access can be short of the paid period. Fail before the
  // lease/business writes; never hide that deficit by completing the queue
  // or blindly adding another month. An exact repair must establish its window.
  if (alreadyFulfilled && minimumEnd && !await fulfillmentProof(db, parent, now, minimumEnd)) {
    throw new Error('recovery_paid_access_window_short');
  }
  return { item, uid, payment, sbs, ps, sub, parent, profile, existingPayment, existingRebill, isRebill,
    continuation,
    alreadyFulfilled, accessStart: accessStart.toISOString(), expectedEnd: expectedEnd.toISOString(),
    minimumEnd: minimumEnd?.toISOString() ?? null,
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
    will_invoke_grant: !plan.alreadyFulfilled, queue_updated_at: plan.item.updated_at,
    ...(plan.continuation ? { continuation_repair: { source_subscription_id: plan.continuation.source.id,
      target_subscription_id: plan.sub.id, will_relink: !plan.continuation.alreadyRelinked,
      notifications_suppressed: true, expected_provider_updated_at: plan.ps.updated_at } } : {}) };
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
        currentPs.subscription_v2_id !== plan.ps.subscription_v2_id || !currentSub ||
        ['user_id', 'profile_id', 'product_id', 'tariff_id', 'status', 'access_end_at', 'canceled_at', 'auto_renew_disabled_at', 'updated_at'].some(key => currentSub[key] !== plan.sub[key])) {
      throw new Error('recovery_provider_link_changed');
    }
    if (plan.continuation && !plan.continuation.alreadyRelinked) {
      const source = await one(db, 'subscriptions_v2', plan.continuation.source.id);
      if (!source || source.status !== 'superseded' || source.updated_at !== plan.continuation.source.updated_at || source.canceled_at) {
        throw new Error('recovery_continuation_source_changed');
      }
      const repaired = await checked(db.from('provider_subscriptions').update({
        subscription_v2_id: plan.sub.id,
        meta: { ...currentPs.meta, paid_continuation_repair: { source_subscription_id: source.id,
          target_subscription_id: plan.sub.id, payment_uid: plan.uid, queue_id: plan.item.id,
          repaired_at: new Date().toISOString() } },
      }).eq('id', currentPs.id).eq('updated_at', currentPs.updated_at)
        .eq('subscription_v2_id', source.id).eq('state', 'active').select('id').maybeSingle(), 'continuation_relink');
      if (!repaired) throw new Error('recovery_continuation_link_conflict');
      plan.ps = await one(db, 'provider_subscriptions', currentPs.id);
      await checked(db.from('audit_logs').insert({ actor_type: 'system', actor_label: 'payments-reconcile',
        action: 'bepaid.paid_continuation.relinked', meta: { provider_row_id: currentPs.id,
          source_subscription_id: source.id, target_subscription_id: plan.sub.id, payment_uid: plan.uid, queue_id: plan.item.id } }), 'continuation_audit');
    }
  }
  let orderId = plan.existingPayment?.order_id || plan.parent.id;
  const grant = async (id: string) => {
    const order = await one(db, 'orders_v2', id);
    const start = order?.provider_payment_id === plan.uid ? order?.meta?.recovery_access_start_at : null;
    const result = await db.functions.invoke('grant-access-for-order', { body: { orderId: id,
      grantTelegram: true, grantGetcourse: false, context: 'historical_payment_recovery',
      ...(plan.continuation ? { expectedExistingSubscriptionId: plan.sub.id, extendFromCurrent: true, notifyCustomer: false } : {}),
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
          recovery_expected_end_at: plan.expectedEnd, recovery_queue_id: plan.item.id,
          ...(plan.continuation ? { suppress_notifications: true } : {}) } }),
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
  if (fulfilledOrder?.status !== 'paid' || !await fulfillmentProof(db, fulfilledOrder, new Date(), plan.minimumEnd ? new Date(plan.minimumEnd) : undefined)) {
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
    if (plan.continuation) {
      const currentSub = await one(db, 'subscriptions_v2', plan.sub.id);
      if (!currentSub || currentSub.status !== 'active' || currentSub.canceled_at || currentSub.auto_renew_disabled_at ||
          !date(currentSub.updated_at) || date(currentSub.access_end_at)?.toISOString() !== plan.expectedEnd || currentSub.auto_renew === false) {
        throw new Error('recovery_continuation_billing_state_changed');
      }
      // Billing timestamp is the verified provider schedule, not the slightly
      // different calendar-month learning window. Never move access here.
      const synced = await checked(db.from('subscriptions_v2').update({ next_charge_at: plan.nextCharge })
        .eq('id', currentSub.id).eq('updated_at', currentSub.updated_at).eq('status', 'active')
        .select('id').maybeSingle(), 'continuation_billing_sync');
      if (!synced) throw new Error('recovery_continuation_billing_conflict');
    }
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
  recordPreflightFailure?: boolean;
  paidContinuation?: PaidContinuationRepair;
  providerAuth: string; fetcher?: typeof fetch; now?: Date;
}) {
  if (!UUID.test(options.queueItemId)) throw new Error('recovery_invalid_queue_id');
  if (options.paidContinuation && (!options.expectedUpdatedAt || !options.providerSubscriptionId || options.recordPreflightFailure)) {
    throw new Error('recovery_continuation_exact_manual_required');
  }
  if (options.recordPreflightFailure && !options.expectedUpdatedAt) throw new Error('recovery_preflight_snapshot_required');
  const now = options.now || new Date();
  const item = await one(db, 'payment_reconcile_queue', options.queueItemId);
  if (!item) throw new Error('recovery_queue_missing');
  if (options.expectedUpdatedAt && options.expectedUpdatedAt !== item.updated_at) throw new Error('recovery_queue_snapshot_changed');
  const stale = isStaleProcessingItem(item, staleProcessingCutoff(now));
  if (item.status === 'processing' && !stale) return { success: true, claim_conflicts: 1, results: { orders_reconciled: 0 } };
  const terminal = staleTerminalReason(item, { maxAttempts: 5, excludeCancelled: true, excludeFileImport: true, queueItemId: null });
  // Only the explicit service-only exact mode may retry an exhausted recovery.
  // It still proves the entire provider/paid/trigger chain below on EVERY call.
  // Never override an operator cancellation or replay a generic queue batch.
  const manualContinuationRetry = !!options.paidContinuation && (
    ((item.status === 'error' || stale) && String(item.last_error || '').startsWith('recovery_')) || item.status === 'completed');
  if (terminal && !(terminal === 'STALE_PROCESSING_MAX_ATTEMPTS' && manualContinuationRetry)) {
    if (options.dryRun) return { success: true, dry_run: true, no_writes: true, terminal_reason: terminal };
    if (!stale) throw new Error('recovery_queue_requires_manual_review');
    const released = await checked(db.from('payment_reconcile_queue').update({ status: 'error',
      last_error: terminal === 'STALE_PROCESSING_CANCELLED' ? `${item.last_error}; ${terminal}` : `${terminal}: worker interrupted`,
      next_retry_at: null }).eq('id', item.id).eq('status', 'processing').eq('updated_at', item.updated_at)
      .select('id').maybeSingle(), 'terminal_release');
    return { success: true, stale_terminal: released ? 1 : 0, claim_conflicts: released ? 0 : 1, results: { orders_reconciled: 0 } };
  }
  if (!['pending', 'error', 'processing', 'successful', 'completed'].includes(item.status)) throw new Error('recovery_queue_requires_manual_review');
  // Automatic retry accounting is opt-in. Manual exact recovery keeps its
  // zero-write preflight guards and may intentionally retry before the due date.
  if (options.recordPreflightFailure && ['pending', 'error'].includes(item.status) &&
      date(item.next_retry_at) && Date.parse(item.next_retry_at) > now.getTime()) {
    return { success: true, retry_deferred: 1, results: { orders_reconciled: 0 },
      ...(options.dryRun ? { dry_run: true, no_writes: true } : {}) };
  }
  let plan: any;
  try {
    plan = await loadPlan(db, item, options.providerAuth, options.fetcher || fetch, now, options.providerSubscriptionId, options.paidContinuation);
  } catch (error) {
    const message = safeRecoveryError(error, 'recovery_preflight_failed');
    if (!options.recordPreflightFailure || options.dryRun ||
        !['pending', 'error', 'processing'].includes(item.status) ||
        message === 'recovery_explicit_subscription_mismatch') throw error;
    // An outage is not evidence that a valid payment failed validation. Defer
    // it without exhausting its five validation attempts. No provider retry is
    // performed inside this call, and no financial/access row is ever changed.
    const unavailable = message === 'recovery_provider_unavailable';
    const attempts = (item.attempts || 0) + (unavailable ? 0 : 1);
    // The existing scheduled reader retries pending, not historical error
    // rows. Keep its retryable work visible without replaying that archive.
    const status = attempts >= 5 || item.status === 'error' ? 'error' : 'pending';
    const recorded = await checked(db.from('payment_reconcile_queue').update({
      status, attempts, last_attempt_at: now.toISOString(), last_error: message,
      next_retry_at: attempts < 5 ? new Date(now.getTime() + 3_600_000).toISOString() : null,
    }).eq('id', item.id).eq('status', item.status).eq('updated_at', item.updated_at)
      .select('id').maybeSingle(), 'preflight_error');
    if (!recorded) return { success: true, claim_conflicts: 1, results: { orders_reconciled: 0 } };
    throw new Error(message);
  }
  if (options.dryRun) return { success: true, dry_run: true, no_writes: true, plan: safePlan(plan) };
  if (item.status === 'completed' && plan.alreadyFulfilled) return { success: true, already_completed: true, results: { already_materialized: 1 } };
  if (!['pending', 'error', 'processing', 'successful'].includes(item.status) || ((item.attempts || 0) >= 5 && !manualContinuationRetry)) {
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
    const message = safeRecoveryError(error, 'recovery_execution_failed');
    const recorded = await checked(db.from('payment_reconcile_queue').update({ status: 'error', last_error: message,
      next_retry_at: (item.attempts || 0) + 1 < 5 ? new Date(now.getTime() + 3_600_000).toISOString() : null })
      .eq('id', item.id).eq('status', 'processing').eq('updated_at', claimed.updated_at)
      .select('id').maybeSingle(), 'queue_error');
    if (!recorded) return { success: true, claim_conflicts: 1, results: { orders_reconciled: 0 } };
    throw new Error(message);
  }
}
