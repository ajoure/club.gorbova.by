export interface StaleAccessPolicyInput {
  canonicalAccessEndAt: Date;
  now: Date;
  context?: string | null;
  shouldAutoRenew: boolean;
}

export function resolveStaleAccessPolicy(input: StaleAccessPolicyInput) {
  const isStale = input.canonicalAccessEndAt.getTime() < input.now.getTime();

  if (isStale && input.context === "historical_payment_recovery") {
    return {
      accessEndAt: input.canonicalAccessEndAt,
      nextChargeAt: null as Date | null,
      status: "expired" as const,
      placeholderApplied: false,
    };
  }

  if (isStale) {
    return {
      accessEndAt: new Date(input.now.getTime() + 48 * 60 * 60 * 1000),
      nextChargeAt: input.canonicalAccessEndAt as Date | null,
      status: "active" as const,
      placeholderApplied: true,
    };
  }

  return {
    accessEndAt: input.canonicalAccessEndAt,
    // Preserve the existing live-flow write contract. This patch changes only
    // explicitly labelled historical recovery.
    nextChargeAt: input.canonicalAccessEndAt,
    status: "active" as const,
    placeholderApplied: false,
  };
}
