export type RetryObservability = {
  attempts: number;
  maxAttempts: number | null;
  totalAttempts: number;
  failedAttempts: number;
  successfulAttempts: number;
  exhausted: boolean;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function nonNegativeInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function firstInt(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = nonNegativeInt(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function resolveRetryObservability(args: {
  subscriptionAttempts?: unknown;
  subscriptionMeta?: unknown;
  providerMeta?: unknown;
  providerRawData?: unknown;
  installmentAttempts?: unknown;
  successfulAttempts?: unknown;
  failedAttempts?: unknown;
}): RetryObservability {
  const subMeta = record(args.subscriptionMeta);
  const installment = record(subMeta.installment);
  const retryPolicy = record(installment.retry_policy ?? subMeta.retry_policy);
  const providerMeta = record(args.providerMeta);
  const providerRaw = record(args.providerRawData);
  const observability = record(
    providerMeta.retry_observability ??
      providerRaw.retry_observability ??
      subMeta.retry_observability,
  );

  const attempts = firstInt(
    args.installmentAttempts,
    observability.current_attempts,
    observability.attempt_count,
    providerRaw.charge_attempts,
    providerRaw.payment_attempts,
    args.subscriptionAttempts,
  ) ?? 0;

  const mode = String(retryPolicy.mode ?? "");
  const configured = firstInt(
    retryPolicy.configured_value,
    subMeta.max_charge_attempts_configured,
  );
  const providerLimit = firstInt(
    retryPolicy.provider_number_payment_attempts,
    providerRaw.number_payment_attempts,
  );
  const maxAttempts = mode === "unlimited_requested" || configured === 0
    ? null
    : configured ?? providerLimit ?? 3;

  const successfulAttempts = firstInt(
    args.successfulAttempts,
    observability.successful_attempts,
  ) ?? 0;
  const failedAttempts = firstInt(
    args.failedAttempts,
    observability.failed_attempts,
    attempts,
  ) ?? attempts;
  const totalAttempts = firstInt(
    observability.total_attempts,
    successfulAttempts + failedAttempts,
  ) ?? attempts;

  return {
    attempts,
    maxAttempts,
    totalAttempts,
    failedAttempts,
    successfulAttempts,
    exhausted: maxAttempts !== null && attempts >= maxAttempts,
  };
}

export function retryAttemptLabel(value: RetryObservability): string {
  return `${value.attempts}/${value.maxAttempts === null ? "∞" : value.maxAttempts}`;
}

export function retryAttemptSummaryLabel(value: RetryObservability): string {
  const current = retryAttemptLabel(value);
  return value.totalAttempts > value.attempts
    ? `${current} · Σ${value.totalAttempts}`
    : current;
}
