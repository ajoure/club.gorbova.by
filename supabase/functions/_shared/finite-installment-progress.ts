function positiveNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function nonNegativeNumber(...values: unknown[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function validIso(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    if (Number.isFinite(Date.parse(value))) return value;
  }
  return null;
}

export function isFiniteInstallmentModel(ps: any, subV2: any): boolean {
  const providerMeta = ps?.meta ?? {};
  const subMeta = subV2?.meta ?? {};
  const installmentMeta = subMeta?.installment ?? providerMeta?.installment ?? {};
  const count = positiveNumber(
    subMeta?.installment_count,
    subMeta?.billing_cycles,
    providerMeta?.installment_count,
    providerMeta?.billing_cycles,
    installmentMeta?.selected_installment_months,
    installmentMeta?.billing_cycles,
    installmentMeta?.installment_count,
  );

  return subMeta?.model === "bepaid_finite_subscription"
    || providerMeta?.model === "bepaid_finite_subscription"
    || installmentMeta?.as_finite_subscription === true
    || count >= 2;
}

/**
 * Some historical internal installments are canonical in subscriptions_v2 but
 * have no active provider_subscriptions row. Keep them in the reminder runner
 * without duplicating provider-managed installments.
 */
export function buildLocalFiniteCandidateRows(
  providerRows: any[],
  subscriptionRows: any[],
): any[] {
  const providerManagedSubscriptionIds = new Set(
    (providerRows ?? [])
      .map((row) => row?.subscription_v2_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );

  return (subscriptionRows ?? [])
    .filter((sub) => (
      typeof sub?.id === "string"
      && typeof sub?.user_id === "string"
      && !providerManagedSubscriptionIds.has(sub.id)
      && isFiniteInstallmentModel(null, sub)
    ))
    .map((sub) => {
      const order = Array.isArray(sub?.orders_v2) ? sub.orders_v2[0] : sub?.orders_v2;
      const subMeta = sub?.meta ?? {};
      const progress = order?.meta?.installment_progress ?? subMeta?.installment_progress ?? {};
      const perPaymentAmount = positiveNumber(
        progress?.per_payment_byn,
        progress?.per_payment_amount,
        subMeta?.installment_per_payment_amount_byn,
        subMeta?.recurring_amount,
      );

      return {
        id: `local:${sub.id}`,
        user_id: sub.user_id,
        subscription_v2_id: sub.id,
        state: sub.status ?? "active",
        next_charge_at: sub.next_charge_at ?? progress?.next_charge_at ?? null,
        amount_cents: perPaymentAmount > 0 ? Math.round(perPaymentAmount * 100) : 0,
        currency: String(order?.currency ?? subMeta?.recurring_currency ?? "BYN"),
        meta: {
          ...subMeta,
          reminder_candidate_source: "subscriptions_v2",
        },
        subscriptions_v2: sub,
      };
    });
}

/**
 * Provider-managed finite installments intentionally do not materialize rows in
 * installment_payments. Reconstruct the next scheduled payment from the
 * canonical snapshots written to subscriptions_v2/orders_v2/provider metadata.
 */
export function buildVirtualInstallmentPayment(ps: any, subV2: any): any | null {
  const subMeta = subV2?.meta ?? {};
  const subInstallment = subMeta?.installment ?? {};
  const order = Array.isArray(subV2?.orders_v2) ? subV2.orders_v2[0] : subV2?.orders_v2;
  const orderMeta = order?.meta ?? {};
  const orderInstallment = orderMeta?.installment ?? {};
  const progress = orderMeta?.installment_progress ?? subMeta?.installment_progress ?? {};
  const providerMeta = ps?.meta ?? {};
  const providerInstallment = providerMeta?.installment ?? {};

  const totalPayments = positiveNumber(
    progress?.billing_cycles,
    progress?.total_payments,
    subMeta?.billing_cycles,
    subMeta?.installment_count,
    subInstallment?.billing_cycles,
    subInstallment?.installment_count,
    subInstallment?.selected_installment_months,
    orderInstallment?.billing_cycles,
    orderInstallment?.installment_count,
    providerMeta?.billing_cycles,
    providerMeta?.installment_count,
    providerInstallment?.billing_cycles,
  );
  if (totalPayments < 2) return null;

  const paidPayments = Math.min(
    totalPayments,
    nonNegativeNumber(
      progress?.paid_billing_cycles,
      progress?.paid_payments,
      subMeta?.paid_billing_cycles,
      providerMeta?.paid_billing_cycles,
      providerMeta?.retry_observability?.successful_attempts,
      subMeta?.retry_observability?.successful_attempts,
    ),
  );
  if (
    paidPayments >= totalPayments
    || progress?.status === "completed"
    || subMeta?.installment_status === "completed"
  ) return null;

  const dueDate = validIso(
    progress?.next_charge_at,
    subMeta?.installment_progress?.next_charge_at,
    subV2?.next_charge_at,
    ps?.next_charge_at,
  );
  if (!dueDate) return null;

  const amount = positiveNumber(
    progress?.per_payment_byn,
    progress?.per_payment_amount,
    subMeta?.installment_per_payment_amount_byn,
    subInstallment?.per_payment_byn,
    subInstallment?.per_payment_amount,
    orderInstallment?.per_payment_byn,
    orderInstallment?.per_payment_amount,
    Number(ps?.amount_cents ?? 0) / 100,
  );
  const currency = String(
    progress?.currency
    ?? order?.currency
    ?? ps?.currency
    ?? "BYN",
  );
  const paymentNumber = paidPayments + 1;
  const dueDateKey = dueDate.slice(0, 10);

  return {
    id: `virtual:${subV2.id}:${paymentNumber}:${dueDateKey}`,
    payment_number: paymentNumber,
    total_payments: totalPayments,
    amount,
    currency,
    due_date: dueDate,
    virtual: true,
  };
}
