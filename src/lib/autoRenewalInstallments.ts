type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function finiteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function positiveInt(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 2) return parsed;
  }
  return null;
}

function nonNegativeInt(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function isoString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    if (Number.isFinite(Date.parse(value))) return value;
  }
  return null;
}

export function isFiniteInstallment(args: {
  subscriptionMeta?: unknown;
  orderMeta?: unknown;
  providerMeta?: unknown;
  offerPaymentMethod?: unknown;
  offerIsInstallment?: unknown;
  offerInstallmentCount?: unknown;
}): boolean {
  const subscription = record(args.subscriptionMeta);
  const order = record(args.orderMeta);
  const provider = record(args.providerMeta);
  const installment = record(subscription.installment);
  const orderInstallment = record(order.installment);
  const orderProgress = record(order.installment_progress);

  const count = positiveInt(
    subscription.installment_count,
    subscription.billing_cycles,
    installment.installment_count,
    installment.billing_cycles,
    installment.selected_installment_months,
    orderInstallment.installment_count,
    orderInstallment.billing_cycles,
    orderProgress.billing_cycles,
    provider.installment_count,
    provider.billing_cycles,
    args.offerInstallmentCount,
  );

  return subscription.model === "bepaid_finite_subscription"
    || provider.model === "bepaid_finite_subscription"
    || installment.as_finite_subscription === true
    || orderInstallment.as_finite_subscription === true
    || args.offerPaymentMethod === "internal_installment"
    || args.offerIsInstallment === true
    || count !== null;
}

export type InstallmentProgress = {
  totalPayments: number;
  paidPayments: number;
  remainingPayments: number;
  nextPaymentNumber: number | null;
  perPaymentAmount: number;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
  nextChargeAt: string | null;
  completed: boolean;
};

export type InstallmentPaymentEvidenceRow = {
  status?: unknown;
  payment_number?: unknown;
  charge_attempts?: unknown;
  paid_at?: unknown;
  last_attempt_at?: unknown;
  error_message?: unknown;
  due_date?: unknown;
  payment_id?: unknown;
};

export type InstallmentPaymentEvidence = {
  firstPaymentSucceeded: boolean;
  successfulPayments: number;
  failedAttempts: number;
  totalAttempts: number;
  currentAttempts: number;
  latestAttemptAt: string | null;
  latestAttemptSucceeded: boolean | null;
  latestAttemptError: string | null;
};

/**
 * Фактическое состояние рассрочки строится только по строкам графика платежей.
 * Созданная ссылка или provider subscription без успешного первого взноса не
 * является живой рассрочкой и не должна попадать в рабочий реестр.
 */
export function summarizeInstallmentPayments(
  rows: InstallmentPaymentEvidenceRow[],
): InstallmentPaymentEvidence {
  const normalized = rows.map((row) => {
    const status = String(row.status ?? "").toLowerCase();
    const paymentNumber = nonNegativeInt(row.payment_number) ?? 0;
    const chargeAttempts = nonNegativeInt(row.charge_attempts) ?? 0;
    const paidAt = isoString(row.paid_at);
    const lastAttemptAt = isoString(row.last_attempt_at);
    return {
      status,
      paymentNumber,
      chargeAttempts,
      paidAt,
      lastAttemptAt,
      error: typeof row.error_message === "string" && row.error_message
        ? row.error_message
        : null,
      dueAt: isoString(row.due_date),
      hasPaymentId: typeof row.payment_id === "string" && row.payment_id.length > 0,
    };
  });

  const succeeded = normalized.filter((row) => row.status === "succeeded");
  const firstPaymentSucceeded = succeeded.some((row) =>
    row.paymentNumber === 1 || row.hasPaymentId || row.paidAt !== null
  );
  const failedAttempts = normalized.reduce(
    (sum, row) => sum + row.chargeAttempts,
    0,
  );
  const totalAttempts = failedAttempts + succeeded.length;
  const outstanding = normalized
    .filter((row) => ["pending", "failed", "overdue", "processing"].includes(row.status))
    .sort((a, b) => {
      const aTime = a.dueAt ? Date.parse(a.dueAt) : Number.MAX_SAFE_INTEGER;
      const bTime = b.dueAt ? Date.parse(b.dueAt) : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });

  const attempted = normalized
    .filter((row) => row.lastAttemptAt || row.paidAt)
    .sort((a, b) => Date.parse(b.lastAttemptAt ?? b.paidAt!) - Date.parse(a.lastAttemptAt ?? a.paidAt!));
  const latest = attempted[0] ?? null;

  return {
    firstPaymentSucceeded,
    successfulPayments: succeeded.length,
    failedAttempts,
    totalAttempts,
    currentAttempts: outstanding[0]?.chargeAttempts ?? 0,
    latestAttemptAt: latest?.lastAttemptAt ?? latest?.paidAt ?? null,
    latestAttemptSucceeded: latest ? latest.status === "succeeded" : null,
    latestAttemptError: latest?.error ?? null,
  };
}

export function hasRealInstallmentEvidence(args: {
  evidence?: InstallmentPaymentEvidence | null;
  paidPayments?: unknown;
  paidAmount?: unknown;
  providerLastChargeAt?: unknown;
}): boolean {
  if (args.evidence?.firstPaymentSucceeded) return true;
  if ((nonNegativeInt(args.paidPayments) ?? 0) > 0) return true;
  if ((finiteNumber(args.paidAmount) ?? 0) > 0) return true;
  return isoString(args.providerLastChargeAt) !== null;
}

export function resolveInstallmentProgress(args: {
  subscriptionMeta?: unknown;
  orderMeta?: unknown;
  providerMeta?: unknown;
  providerRawData?: unknown;
  orderFinalPrice?: unknown;
  providerAmount?: unknown;
  subscriptionNextChargeAt?: unknown;
  providerNextChargeAt?: unknown;
  successfulAttempts?: unknown;
}): InstallmentProgress {
  const subscription = record(args.subscriptionMeta);
  const installment = record(subscription.installment);
  const subscriptionProgress = record(subscription.installment_progress);
  const order = record(args.orderMeta);
  const orderInstallment = record(order.installment);
  const orderProgress = record(order.installment_progress);
  const provider = record(args.providerMeta);
  const providerRaw = record(args.providerRawData);
  const providerPlan = record(providerRaw.plan);
  const retry = record(
    provider.retry_observability ?? subscription.retry_observability,
  );

  const totalPayments = positiveInt(
    orderProgress.billing_cycles,
    orderProgress.total_payments,
    subscriptionProgress.billing_cycles,
    subscriptionProgress.total_payments,
    subscription.billing_cycles,
    subscription.installment_count,
    installment.billing_cycles,
    installment.installment_count,
    installment.selected_installment_months,
    orderInstallment.billing_cycles,
    orderInstallment.installment_count,
    provider.billing_cycles,
    provider.installment_count,
    providerPlan.billing_cycles,
  ) ?? 1;

  const rawPaidPayments = nonNegativeInt(
    orderProgress.paid_billing_cycles,
    orderProgress.paid_payments,
    subscriptionProgress.paid_billing_cycles,
    subscriptionProgress.paid_payments,
    subscription.paid_billing_cycles,
    provider.paid_billing_cycles,
    providerPlan.paid_billing_cycles,
    args.successfulAttempts,
    retry.successful_attempts,
  ) ?? 0;
  const paidPayments = Math.min(totalPayments, rawPaidPayments);
  const remainingPayments = Math.max(0, totalPayments - paidPayments);

  const perPaymentAmount = finiteNumber(
    orderProgress.per_payment_byn,
    orderProgress.per_payment_amount,
    subscriptionProgress.per_payment_byn,
    subscription.installment_per_payment_amount_byn,
    installment.per_payment_byn,
    installment.per_payment_amount,
    orderInstallment.per_payment_byn,
    orderInstallment.per_payment_amount,
    args.providerAmount,
    providerPlan.amount,
  ) ?? 0;

  const explicitTotal = finiteNumber(
    orderProgress.effective_total_byn,
    orderProgress.total_amount,
    subscriptionProgress.effective_total_byn,
    subscription.installment_total_amount_byn,
    installment.effective_total_byn,
    installment.total_installment_amount,
    orderInstallment.effective_total_byn,
    orderInstallment.total_installment_amount,
    args.orderFinalPrice,
  );
  const totalAmount = explicitTotal ?? Number((perPaymentAmount * totalPayments).toFixed(2));

  const paidAmount = finiteNumber(
    orderProgress.paid_total_byn,
    subscriptionProgress.paid_total_byn,
  ) ?? Number((perPaymentAmount * paidPayments).toFixed(2));
  const remainingAmount = finiteNumber(
    orderProgress.remaining_total_byn,
    subscriptionProgress.remaining_total_byn,
  ) ?? Number(Math.max(0, totalAmount - paidAmount).toFixed(2));

  const completed = remainingPayments === 0
    || orderProgress.status === "completed"
    || subscription.installment_status === "completed";

  return {
    totalPayments,
    paidPayments,
    remainingPayments,
    nextPaymentNumber: completed ? null : paidPayments + 1,
    perPaymentAmount,
    paidAmount,
    remainingAmount,
    totalAmount,
    nextChargeAt: completed
      ? null
      : isoString(
          orderProgress.next_charge_at,
          subscriptionProgress.next_charge_at,
          args.subscriptionNextChargeAt,
          args.providerNextChargeAt,
        ),
    completed,
  };
}
