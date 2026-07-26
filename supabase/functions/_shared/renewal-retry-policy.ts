import { APP_TZ, dayWindowUtc, toTzDateKey } from "./timezone.ts";

export type EffectiveRetryPolicy = {
  mode: "limited" | "unlimited";
  maxAttempts: number | null;
  source:
    | "installment_snapshot"
    | "subscription_snapshot"
    | "recurring_snapshot"
    | "default";
};

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const positiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export function resolveEffectiveRetryPolicy(
  meta: unknown,
  defaultMaxAttempts = 3,
): EffectiveRetryPolicy {
  const root = record(meta);
  const installment = record(root.installment);
  const recurring = record(root.recurring_snapshot ?? root.recurring);
  const candidates: Array<[JsonRecord, EffectiveRetryPolicy["source"]]> = [
    [record(installment.retry_policy), "installment_snapshot"],
    [record(root.retry_policy), "subscription_snapshot"],
  ];
  for (const [snapshot, source] of candidates) {
    const mode = String(snapshot.mode ?? "");
    const configuredNumber = Number(snapshot.configured_value);
    if (mode === "unlimited_requested" || configuredNumber === 0) {
      return { mode: "unlimited", maxAttempts: null, source };
    }
    const maxAttempts = positiveInt(
      snapshot.configured_value ??
        snapshot.max_attempts ??
        snapshot.provider_number_payment_attempts,
    );
    if (maxAttempts !== null) return { mode: "limited", maxAttempts, source };
  }
  const recurringMax = positiveInt(recurring.max_charge_attempts);
  if (recurringMax !== null) {
    return {
      mode: "limited",
      maxAttempts: recurringMax,
      source: "recurring_snapshot",
    };
  }
  return {
    mode: "limited",
    maxAttempts: positiveInt(defaultMaxAttempts) ?? 3,
    source: "default",
  };
}

export function isRetryExhausted(
  attempts: number,
  policy: EffectiveRetryPolicy,
): boolean {
  return policy.maxAttempts !== null && attempts >= policy.maxAttempts;
}

/** Access remains valid through the full local calendar day of access_end_at. */
export function accessDayHasEnded(
  accessEndAt: string | null | undefined,
  nowIso: string,
  timezone = APP_TZ,
): boolean {
  if (!accessEndAt) return false;
  const { end } = dayWindowUtc(timezone, toTzDateKey(accessEndAt, timezone));
  return new Date(nowIso).getTime() >= new Date(end).getTime();
}
