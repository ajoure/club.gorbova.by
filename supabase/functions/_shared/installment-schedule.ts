// Stage 2: Installment Schedule Generator
// Single source of truth for creating installment_payments rows from a tariff_offer.
//
// Contract:
//   - Reads installment params strictly from tariff_offers (UUID-identified offer).
//   - Idempotent: if schedule already exists for the order, no-op + audit.
//   - Validates offer is a real internal_installment offer.
//   - Writes audit_logs row 'installment_started' on first successful generation.
//   - Due dates: payment N due_date = now + (first_payment_delay_days + (N-1) * installment_interval_days) days
//   - Backed by UNIQUE (order_id, payment_number) constraint as final safety net.

export type InstallmentOffer = {
  id: string;
  payment_method: string | null;
  installment_count: number | null;
  installment_interval_days: number | null;
  first_payment_delay_days: number | null;
};

export type GenerateScheduleParams = {
  supabase: any;
  offer: InstallmentOffer;
  order: { id: string };
  subscription: { id: string };
  user: { id: string };
  totalAmount: number;
  currency: string;
  // First payment is already settled inline in direct-charge (prepaid via bePaid).
  firstPayment?: { paymentId: string | null };
};

export type GenerateScheduleResult =
  | { ok: true; created: true; count: number }
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
  const { supabase, offer, order, subscription, user, totalAmount, currency, firstPayment } = params;

  // ---- Validation: strict offer contract ----
  if (!offer?.id) {
    return { ok: false, error: 'offer_id_required' };
  }
  if (offer.payment_method !== 'internal_installment') {
    return { ok: false, error: 'invalid_payment_method', details: { payment_method: offer.payment_method } };
  }
  const installmentCount = Number(offer.installment_count ?? 0);
  const intervalDays = Number(offer.installment_interval_days ?? 0);
  const firstDelayDays = Number(offer.first_payment_delay_days ?? 0);

  if (!Number.isFinite(installmentCount) || installmentCount <= 1) {
    return { ok: false, error: 'installment_count_invalid', details: { installment_count: installmentCount } };
  }
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
    return { ok: false, error: 'installment_interval_days_invalid', details: { installment_interval_days: intervalDays } };
  }
  if (!Number.isFinite(firstDelayDays) || firstDelayDays < 0) {
    return { ok: false, error: 'first_payment_delay_days_invalid', details: { first_payment_delay_days: firstDelayDays } };
  }
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return { ok: false, error: 'amount_invalid', details: { total_amount: totalAmount } };
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
      offer_id: offer.id,
      existing_count: existing.length,
    }, user.id);
    return { ok: true, created: false, reason: 'already_exists', existing_count: existing.length };
  }

  // ---- Build schedule ----
  const perPaymentAmount = Math.round((totalAmount / installmentCount) * 100) / 100;
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
    // Race with parallel generator → treat as already_exists if unique violation
    const msg = String(insertErr.message ?? '');
    if (msg.includes('installment_payments_order_payment_number_unique') || insertErr.code === '23505') {
      await writeAudit(supabase, 'installment_schedule_already_exists', {
        order_id: order.id,
        subscription_id: subscription.id,
        offer_id: offer.id,
        race: true,
      }, user.id);
      return { ok: true, created: false, reason: 'already_exists', existing_count: installmentCount };
    }
    return { ok: false, error: 'insert_failed', details: insertErr.message };
  }

  // ---- Audit success ----
  await writeAudit(supabase, 'installment_started', {
    order_id: order.id,
    subscription_id: subscription.id,
    offer_id: offer.id,
    installment_count: installmentCount,
    installment_interval_days: intervalDays,
    first_payment_delay_days: firstDelayDays,
    total_amount: totalAmount,
    per_payment_amount: perPaymentAmount,
    currency,
  }, user.id);

  return { ok: true, created: true, count: installmentCount };
}
