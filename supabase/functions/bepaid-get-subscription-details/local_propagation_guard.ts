export type LocalPropagationDecision =
  | "allow"
  | "blocked_provider_not_active"
  | "blocked_transaction_not_successful"
  | "blocked_post_cancel_charge"
  | "blocked_ambiguous_terminal_charge";

export interface LocalPropagationGuardInput {
  providerState: string | null | undefined;
  hasCompetingActiveSubscription: boolean;
  localStatus: string | null | undefined;
  autoRenew: boolean | null | undefined;
  canceledAt: string | null | undefined;
  autoRenewDisabledAt: string | null | undefined;
  currentAccessEnd: string | null | undefined;
  transactionStatus: string | null | undefined;
  transactionPaidAt: string | null | undefined;
  proposedAccessEnd: string | null | undefined;
}

export interface LocalPropagationGuardResult {
  decision: LocalPropagationDecision;
  localStopAt: string | null;
  reason: string;
}

const TERMINAL_LOCAL_STATUSES = new Set([
  "canceled",
  "cancelled",
  "expired",
  "superseded",
]);

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function earliestInstant(
  ...values: Array<string | null | undefined>
): { iso: string | null; ms: number | null } {
  const parsed = values
    .map((value) => ({ value, ms: parseInstant(value) }))
    .filter((item): item is { value: string; ms: number } =>
      typeof item.value === "string" && item.ms !== null
    )
    .sort((a, b) => a.ms - b.ms);
  if (parsed.length === 0) return { iso: null, ms: null };
  return { iso: new Date(parsed[0].ms).toISOString(), ms: parsed[0].ms };
}

function isSuccessful(status: string | null | undefined): boolean {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "successful" || normalized === "succeeded" ||
    normalized === "success" || normalized === "paid";
}

/**
 * A provider pull is allowed to refresh access only when it cannot contradict
 * a locally persisted cancellation. Proven or ambiguous terminal charges are
 * held for manual recovery before any subscriptions/entitlements/Telegram
 * mutation is attempted.
 */
export function classifyLocalPropagation(
  input: LocalPropagationGuardInput,
): LocalPropagationGuardResult {
  const providerState = String(input.providerState || "").trim().toLowerCase();
  if (providerState !== "active" && providerState !== "trial") {
    return {
      decision: "blocked_provider_not_active",
      localStopAt: null,
      reason: "provider_state_not_active",
    };
  }

  if (!isSuccessful(input.transactionStatus)) {
    return {
      decision: "blocked_transaction_not_successful",
      localStopAt: null,
      reason: "transaction_not_successful",
    };
  }

  const status = String(input.localStatus || "").trim().toLowerCase();
  const terminalLocally = TERMINAL_LOCAL_STATUSES.has(status) ||
    input.autoRenew === false;
  if (!terminalLocally) {
    return {
      decision: "allow",
      localStopAt: null,
      reason: "local_subscription_non_terminal",
    };
  }

  const stop = earliestInstant(input.canceledAt, input.autoRenewDisabledAt);
  const paidAt = parseInstant(input.transactionPaidAt);
  if (stop.ms !== null && paidAt !== null && paidAt > stop.ms) {
    return {
      decision: "blocked_post_cancel_charge",
      localStopAt: stop.iso,
      reason: "successful_transaction_after_local_stop",
    };
  }

  if (stop.ms !== null && paidAt !== null && paidAt <= stop.ms) {
    return {
      decision: "allow",
      localStopAt: stop.iso,
      reason: "successful_transaction_not_after_local_stop",
    };
  }

  if (status === "canceled" || status === "cancelled") {
    return {
      decision: "blocked_ambiguous_terminal_charge",
      localStopAt: stop.iso,
      reason: "canceled_without_complete_charge_timeline",
    };
  }

  const currentAccessEnd = parseInstant(input.currentAccessEnd);
  const proposedAccessEnd = parseInstant(input.proposedAccessEnd);
  if (
    (status === "expired" || status === "superseded" ||
      status === "past_due") &&
    !input.hasCompetingActiveSubscription && stop.ms === null &&
    proposedAccessEnd !== null && proposedAccessEnd > Date.now()
  ) {
    return {
      decision: "allow",
      localStopAt: null,
      reason: "active_provider_paid_coverage_without_local_cancel",
    };
  }
  const wouldExtendTerminalAccess = proposedAccessEnd !== null &&
    (currentAccessEnd === null || proposedAccessEnd > currentAccessEnd);

  if (wouldExtendTerminalAccess || paidAt === null || stop.ms === null) {
    return {
      decision: "blocked_ambiguous_terminal_charge",
      localStopAt: stop.iso,
      reason: "terminal_local_state_without_complete_charge_timeline",
    };
  }

  return {
    decision: "allow",
    localStopAt: stop.iso,
    reason: "no_access_extension",
  };
}
