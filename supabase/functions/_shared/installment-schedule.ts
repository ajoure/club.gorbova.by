// Stage 2 + Stage L3: Installment Schedule Generator
// Single source of truth for creating installment_payments rows.
//
// Two source modes:
//   1) scheduleSource='offer' (DEFAULT, backward compat for direct-charge):
//      - Reads installment_count / interval_days / first_payment_delay_days from offer.
//      - Per-payment = totalAmount / installment_count (rounded to 2 decimals).
//
//   2) scheduleSource='order_meta' (Stage L3, public link rассрочка):
//      - Reads installment_count and installment_per_payment_amount_byn from order.meta.
//      - Per-payment is taken AS-IS from meta (already rounded round-half-up-byn by writer L2).
//      - interval_days/first_payment_delay_days from order.meta.installment.* with defaults 30/0.
//
// Idempotent: pre-check by order_id + UNIQUE(order_id, payment_number) safety net.
// Audit: 'installment_started' on success, 'installment_schedule_already_exists' on duplicate.

export type InstallmentOffer = {
  id: string;
  payment_method: string | null;
  installment_count: number | null;
  installment_interval_days: number | null;
  first_payment_delay_days: number | null;
};

export type InstallmentOrder = {
  id: string;
  meta?: Record<string, any> | null;
};

export type GenerateScheduleParams = {
  supabase: any;
  // Offer mode requires `offer`; order_meta mode tolerates offer = null.
  offer: InstallmentOffer | null;
  order: InstallmentOrder;
  subscription: { id: string };
  user: { id: string };
  // For offer-mode this is total to be split. For order_meta-mode this is informational.
  totalAmount: number;
  currency: string;
  firstPayment?: { paymentId: string | null };
  // L3 addition. Default keeps direct-charge behavior unchanged.
  scheduleSource?: 'offer' | 'order_meta';
};

export type GenerateScheduleResult =
  | { ok: true; created: true; count: number; per_payment_amount: number }
  | { ok: true; created: false; reason: 'already_exists'; existing_count: number }
  | { ok: false; error: string; details?: unknown };

async function writeAudit(
  supabase: any,
  action: string,
  meta: Record<string, unknown>,
  user_id: string | null,
) {
  try {
    await supabase.from('audit_logs').insert({
      action,
      actor: 'system',
      user_id,
      meta,
    });
  } catch (e) {
    console.warn(`[installment-schedule] audit_logs write failed for ${action}:`, e);
  }
}

export async function generateInstallmentSchedule(
  params: GenerateScheduleParams,
): Promise<GenerateScheduleResult> {
  const {
    supabase, offer, order, subscription, user, totalAmount, currency, firstPayment,
  } = params;
  const scheduleSource: 'offer' | 'order_meta' = params.scheduleSource ?? 'offer';

  // ---- Resolve schedule parameters per source mode ----
  let installmentCount = 0;
  let intervalDays = 0;
  let firstDelayDays = 0;
  let perPaymentAmount = 0;

  if (scheduleSource === 'offer') {
    if (!offer?.id) {
      return { ok: false, error: 'offer_id_required' };
    }
    if (offer.payment_method !== 'internal_installment') {
      return { ok: false, error: 'invalid_payment_method', details: { payment_method: offer.payment_method } };
    }
    installmentCount = Number(offer.installment_count ?? 0);
    intervalDays = Number(offer.installment_interval_days ?? 0);
    firstDelayDays = Number(offer.first_payment_delay_days ?? 0);

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return { ok: false, error: 'amount_invalid', details: { total_amount: totalAmount } };
    }
    perPaymentAmount = Math.round((totalAmount / Math.max(1, installmentCount)) * 100) / 100;
  } else {
    // order_meta mode (Stage L3)
    const meta = (order?.meta ?? {}) as Record<string, any>;
    installmentCount = Number(meta.installment_count ?? 0);
    perPaymentAmount = Number(meta.installment_per_payment_amount_byn ?? 0);
    const installmentMeta = (meta.installment ?? {}) as Record<string, any>;
    intervalDays = Number(installmentMeta.interval_days ?? 30);
    firstDelayDays = Number(installmentMeta.first_payment_delay_days ?? 0);

    if (!Number.isFinite(perPaymentAmount) || perPaymentAmount <= 0) {
      return { ok: false, error: 'per_payment_invalid', details: { installment_per_payment_amount_byn: meta.installment_per_payment_amount_byn } };
    }
  }

  // ---- Common validation ----
  if (!Number.isFinite(installmentCount) || installmentCount <= 1) {
    return { ok: false, error: 'installment_count_invalid', details: { installment_count: installmentCount } };
  }
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
    return { ok: false, error: 'installment_interval_days_invalid', details: { installment_interval_days: intervalDays } };
  }
  if (!Number.isFinite(firstDelayDays) || firstDelayDays < 0) {
    return { ok: false, error: 'first_payment_delay_days_invalid', details: { first_payment_delay_days: firstDelayDays } };
  }

  // ---- Pre-insert idempotency guard ----
  const { data: existing, error: existingErr } = await supabase
    .from('installment_payments')
    .select('id', { count: 'exact', head: false })
    .eq('order_id', order.id);

  if (existingErr) {
    return { ok: false, error: 'precheck_failed', details: existingErr.message };
  }
  if (existing && existing.length > 0) {
    await writeAudit(supabase, 'installment_schedule_already_exists', {
      order_id: order.id,
      subscription_id: subscription.id,
      offer_id: offer?.id ?? null,
      schedule_source: scheduleSource,
      existing_count: existing.length,
    }, user.id);
    return { ok: true, created: false, reason: 'already_exists', existing_count: existing.length };
  }

  // ---- Build schedule ----
  const nowMs = Date.now();
  const rows = Array.from({ length: installmentCount }, (_, i) => {
    const n = i + 1;
    const delayDays = firstDelayDays + i * intervalDays;
    const dueDate = new Date(nowMs + delayDays * 24 * 60 * 60 * 1000).toISOString();
    return {
      subscription_id: subscription.id,
      order_id: order.id,
      user_id: user.id,
      payment_number: n,
      total_payments: installmentCount,
      amount: perPaymentAmount,
      currency,
      due_date: dueDate,
      status: n === 1 ? 'succeeded' : 'pending',
      paid_at: n === 1 ? new Date(nowMs).toISOString() : null,
      payment_id: n === 1 ? (firstPayment?.paymentId ?? null) : null,
    };
  });

  // ---- Insert (UNIQUE (order_id, payment_number) is final safety net) ----
  const { error: insertErr } = await supabase.from('installment_payments').insert(rows);
  if (insertErr) {
    const msg = String(insertErr.message ?? '');
    if (msg.includes('installment_payments_order_payment_number_unique') || (insertErr as any).code === '23505') {
      await writeAudit(supabase, 'installment_schedule_already_exists', {
        order_id: order.id,
        subscription_id: subscription.id,
        offer_id: offer?.id ?? null,
        schedule_source: scheduleSource,
        race: true,
      }, user.id);
      return { ok: true, created: false, reason: 'already_exists', existing_count: installmentCount };
    }
    return { ok: false, error: 'insert_failed', details: insertErr.message };
  }

  await writeAudit(supabase, 'installment_started', {
    order_id: order.id,
    subscription_id: subscription.id,
    offer_id: offer?.id ?? null,
    schedule_source: scheduleSource,
    installment_count: installmentCount,
    installment_interval_days: intervalDays,
    first_payment_delay_days: firstDelayDays,
    total_amount: scheduleSource === 'offer' ? totalAmount : (perPaymentAmount * installmentCount),
    per_payment_amount: perPaymentAmount,
    currency,
  }, user.id);

  return { ok: true, created: true, count: installmentCount, per_payment_amount: perPaymentAmount };
}

// ============================================================================
// B7 Item 8. Materialization for finite bePaid installment (subv2 tracking).
// Source of truth for parameters — the purchase snapshot on
// subscriptions_v2.meta.installment / provider_subscriptions.meta.installment
// / order.meta.installment. Legacy top-level fields only as fallback.
// Idempotent by UNIQUE(order_id, payment_number) and UNIQUE(subscription_id,
// payment_number). Called from bepaid-webhook AFTER the first successful
// provider webhook has been processed (payments_v2 upserted, subscription
// activated). Payment 1 is marked succeeded with the transaction UID and
// provider paid_at; payments 2..N are pending.
// ============================================================================

export type FiniteInstallmentMaterializeParams = {
  supabase: any;
  subscriptionId: string;
  orderId: string;
  userId: string;
  installmentCount: number;
  perPaymentByn: number;
  intervalDays: number;
  currency: string;
  firstPaidAtIso: string;
  firstTransactionUid: string | null;
  firstProviderNextChargeAtIso: string | null;
  paymentId?: string | null;
};

export type FiniteMaterializeResult =
  | { ok: true; created: true; count: number }
  | { ok: true; created: false; reason: 'already_exists'; existing_count: number }
  | { ok: false; error: string; details?: unknown };

export async function materializeFiniteInstallmentSchedule(
  p: FiniteInstallmentMaterializeParams,
): Promise<FiniteMaterializeResult> {
  const {
    supabase, subscriptionId, orderId, userId,
    installmentCount, perPaymentByn, intervalDays, currency,
    firstPaidAtIso, firstTransactionUid, firstProviderNextChargeAtIso, paymentId,
  } = p;

  if (!Number.isInteger(installmentCount) || installmentCount < 2) {
    return { ok: false, error: 'installment_count_invalid', details: { installmentCount } };
  }
  if (!Number.isFinite(perPaymentByn) || perPaymentByn <= 0) {
    return { ok: false, error: 'per_payment_invalid', details: { perPaymentByn } };
  }
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
    return { ok: false, error: 'interval_days_invalid', details: { intervalDays } };
  }

  // Idempotency pre-check by order_id (existing unique index).
  const { data: existing, error: existingErr } = await supabase
    .from('installment_payments')
    .select('id, payment_number, status')
    .eq('order_id', orderId);
  if (existingErr) {
    return { ok: false, error: 'precheck_failed', details: existingErr.message };
  }
  if (existing && existing.length > 0) {
    await writeAudit(supabase, 'installment_schedule_already_exists', {
      order_id: orderId,
      subscription_id: subscriptionId,
      schedule_source: 'finite_bepaid_webhook',
      existing_count: existing.length,
    }, userId);
    return { ok: true, created: false, reason: 'already_exists', existing_count: existing.length };
  }

  // Build rows. payment 1 due = first_paid_at; payment 2 due = provider next_charge_at
  // if available, else payment 1 + interval; payments 3..N step by interval.
  const firstMs = new Date(firstPaidAtIso).getTime();
  const secondMs = firstProviderNextChargeAtIso
    ? new Date(firstProviderNextChargeAtIso).getTime()
    : firstMs + intervalDays * 86400_000;

  const rows = Array.from({ length: installmentCount }, (_, i) => {
    const n = i + 1;
    let dueMs: number;
    if (n === 1) dueMs = firstMs;
    else if (n === 2) dueMs = secondMs;
    else dueMs = secondMs + (n - 2) * intervalDays * 86400_000;
    return {
      subscription_id: subscriptionId,
      order_id: orderId,
      user_id: userId,
      payment_number: n,
      total_payments: installmentCount,
      amount: perPaymentByn,
      currency,
      due_date: new Date(dueMs).toISOString(),
      status: n === 1 ? 'succeeded' : 'pending',
      paid_at: n === 1 ? firstPaidAtIso : null,
      payment_id: n === 1 ? (paymentId ?? null) : null,
      meta: n === 1 && firstTransactionUid
        ? { provider_transaction_uid: firstTransactionUid, source: 'finite_bepaid_webhook' }
        : { source: 'finite_bepaid_webhook' },
    };
  });

  const { error: insertErr } = await supabase.from('installment_payments').insert(rows);
  if (insertErr) {
    const msg = String((insertErr as any).message ?? '');
    const code = String((insertErr as any).code ?? '');
    if (code === '23505' || msg.includes('_unique') || msg.includes('duplicate key')) {
      await writeAudit(supabase, 'installment_schedule_already_exists', {
        order_id: orderId,
        subscription_id: subscriptionId,
        schedule_source: 'finite_bepaid_webhook',
        race: true,
      }, userId);
      return { ok: true, created: false, reason: 'already_exists', existing_count: installmentCount };
    }
    await writeAudit(supabase, 'installment.schedule_materialization_failed', {
      order_id: orderId,
      subscription_id: subscriptionId,
      installment_count: installmentCount,
      error: msg,
      severity: 'CRITICAL',
    }, userId);
    return { ok: false, error: 'insert_failed', details: msg };
  }

  await writeAudit(supabase, 'installment_started', {
    order_id: orderId,
    subscription_id: subscriptionId,
    schedule_source: 'finite_bepaid_webhook',
    installment_count: installmentCount,
    installment_interval_days: intervalDays,
    per_payment_amount: perPaymentByn,
    currency,
    installment_schedule_materialized: true,
    installment_schedule_count: installmentCount,
  }, userId);

  return { ok: true, created: true, count: installmentCount };
}

// ---------------------------------------------------------------------------
// Cycle advancement on subsequent successful provider webhooks.
// - Duplicate UID guard: if the same transaction UID already appears in any row
//   of this subscription, no-op.
// - If provider paid_billing_cycles is a valid integer 1..N → advance that row.
// - Else fall back to the first pending row (only for new UIDs).
// Returns the row updated (if any).
// ---------------------------------------------------------------------------
export type AdvanceCycleResult =
  | { ok: true; advanced: true; payment_number: number; payment_id: string }
  | { ok: true; advanced: false; reason: 'duplicate_uid' | 'no_pending_row' | 'schedule_missing' }
  | { ok: false; error: string; details?: unknown };

export async function advanceInstallmentCycleOnSuccess(args: {
  supabase: any;
  subscriptionId: string;
  transactionUid: string;
  paidAtIso: string;
  providerPaidCycles?: number | null;
  providerNextChargeAtIso?: string | null;
  userId: string;
}): Promise<AdvanceCycleResult> {
  const {
    supabase, subscriptionId, transactionUid, paidAtIso,
    providerPaidCycles, userId,
  } = args;

  const { data: allRows, error } = await supabase
    .from('installment_payments')
    .select('id, payment_number, status, meta, total_payments')
    .eq('subscription_id', subscriptionId)
    .order('payment_number', { ascending: true });
  if (error) return { ok: false, error: 'query_failed', details: error.message };
  if (!allRows || allRows.length === 0) {
    return { ok: true, advanced: false, reason: 'schedule_missing' };
  }

  // Duplicate UID guard — inspect meta.provider_transaction_uid across schedule.
  for (const r of allRows) {
    const uid = (r.meta as any)?.provider_transaction_uid;
    if (uid && String(uid) === String(transactionUid)) {
      return { ok: true, advanced: false, reason: 'duplicate_uid' };
    }
  }

  // Choose target row.
  let targetNumber: number | null = null;
  const N = allRows[0]?.total_payments ?? allRows.length;
  if (providerPaidCycles && Number.isInteger(providerPaidCycles)
      && providerPaidCycles >= 1 && providerPaidCycles <= N) {
    targetNumber = providerPaidCycles;
  } else {
    const firstPending = allRows.find((r: any) => r.status === 'pending');
    if (!firstPending) {
      return { ok: true, advanced: false, reason: 'no_pending_row' };
    }
    targetNumber = firstPending.payment_number;
  }

  const target = allRows.find((r: any) => r.payment_number === targetNumber);
  if (!target) return { ok: true, advanced: false, reason: 'no_pending_row' };
  if (target.status === 'succeeded') {
    return { ok: true, advanced: false, reason: 'duplicate_uid' };
  }

  const nextMeta = {
    ...((target.meta as any) || {}),
    provider_transaction_uid: transactionUid,
    advanced_at: new Date().toISOString(),
  };

  const { error: updErr } = await supabase
    .from('installment_payments')
    .update({
      status: 'succeeded',
      paid_at: paidAtIso,
      meta: nextMeta,
    })
    .eq('id', target.id)
    .eq('status', 'pending');
  if (updErr) {
    await writeAudit(supabase, 'installment.cycle_advancement_failed', {
      subscription_id: subscriptionId,
      transaction_uid: transactionUid,
      payment_number: targetNumber,
      error: updErr.message,
      severity: 'CRITICAL',
    }, userId);
    return { ok: false, error: 'update_failed', details: updErr.message };
  }
  return { ok: true, advanced: true, payment_number: targetNumber, payment_id: target.id };
}

// ---------------------------------------------------------------------------
// Failure annotation — merges failure info on the current first-pending row.
// Guards double-count by remembering last failure UID.
// ---------------------------------------------------------------------------
export async function annotateInstallmentCycleFailure(args: {
  supabase: any;
  subscriptionId: string;
  transactionUid: string | null;
  errorMessage: string;
  atIso: string;
}): Promise<{ ok: true; payment_number: number | null } | { ok: false; error: string }> {
  const { supabase, subscriptionId, transactionUid, errorMessage, atIso } = args;
  const { data: pending, error } = await supabase
    .from('installment_payments')
    .select('id, payment_number, meta')
    .eq('subscription_id', subscriptionId)
    .eq('status', 'pending')
    .order('payment_number', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!pending) return { ok: true, payment_number: null };

  const meta = (pending.meta as any) || {};
  const lastUid = meta.last_failure_transaction_uid ?? null;
  const currentCount = Number(meta.failure_attempt_count ?? 0);
  const isDup = transactionUid && lastUid && String(lastUid) === String(transactionUid);
  const nextCount = isDup ? currentCount : currentCount + 1;

  const nextMeta = {
    ...meta,
    last_failure_transaction_uid: transactionUid,
    last_failure_at: atIso,
    failure_attempt_count: nextCount,
    provider_error: errorMessage,
  };

  await supabase
    .from('installment_payments')
    .update({
      meta: nextMeta,
      last_attempt_at: atIso,
      error_message: errorMessage.slice(0, 500),
      charge_attempts: nextCount,
    })
    .eq('id', pending.id);
  return { ok: true, payment_number: pending.payment_number };
}

// ---------------------------------------------------------------------------
// Retry-exhausted termination — moves the current pending row to a terminal
// status. Used ONLY when classifier confidently returned retry_exhausted.
// Terminal status uses 'cancelled' (an existing allowed value) with meta
// termination_reason='retry_exhausted' to preserve provider evidence.
// ---------------------------------------------------------------------------
export async function terminateFirstPendingInstallment(args: {
  supabase: any;
  subscriptionId: string;
  transactionUid: string | null;
  evidence: Record<string, unknown>;
  atIso: string;
}): Promise<{ ok: true; payment_number: number | null } | { ok: false; error: string }> {
  const { supabase, subscriptionId, transactionUid, evidence, atIso } = args;
  const { data: pending, error } = await supabase
    .from('installment_payments')
    .select('id, payment_number, meta')
    .eq('subscription_id', subscriptionId)
    .eq('status', 'pending')
    .order('payment_number', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!pending) return { ok: true, payment_number: null };

  const nextMeta = {
    ...((pending.meta as any) || {}),
    termination_reason: 'retry_exhausted',
    terminated_at: atIso,
    last_failure_transaction_uid: transactionUid,
    provider_evidence: evidence,
  };

  await supabase
    .from('installment_payments')
    .update({ status: 'cancelled', meta: nextMeta })
    .eq('id', pending.id);
  return { ok: true, payment_number: pending.payment_number };
}

