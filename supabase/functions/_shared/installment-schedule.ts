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
