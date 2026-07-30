import { describe, expect, it } from "vitest";
import {
  resolveRetryObservability,
  retryAttemptLabel,
  retryAttemptSummaryLabel,
} from "./autoRenewalObservability";

describe("resolveRetryObservability", () => {
  it("uses the finite installment snapshot instead of a hardcoded limit", () => {
    const result = resolveRetryObservability({
      subscriptionAttempts: 1,
      installmentAttempts: 4,
      subscriptionMeta: {
        installment: {
          retry_policy: { mode: "limited", configured_value: 6 },
        },
      },
    });

    expect(retryAttemptLabel(result)).toBe("4/6");
    expect(result.exhausted).toBe(false);
  });

  it("renders a proven unlimited policy as infinity", () => {
    const result = resolveRetryObservability({
      installmentAttempts: 12,
      subscriptionMeta: {
        retry_policy: {
          mode: "unlimited_requested",
          provider_number_payment_attempts: 999,
        },
      },
    });

    expect(retryAttemptLabel(result)).toBe("12/∞");
    expect(result.exhausted).toBe(false);
  });

  it("keeps provider default semantics for legacy subscriptions", () => {
    const result = resolveRetryObservability({ subscriptionAttempts: 3 });
    expect(retryAttemptLabel(result)).toBe("3/3");
    expect(result.exhausted).toBe(true);
  });

  it("shows lifetime attempts when the current retry series was reset", () => {
    const result = resolveRetryObservability({
      subscriptionAttempts: 0,
      subscriptionMeta: {
        retry_observability: {
          current_attempts: 0,
          total_attempts: 7,
          successful_attempts: 5,
          failed_attempts: 2,
        },
      },
    });

    expect(retryAttemptSummaryLabel(result)).toBe("0/3 · всего 7");
  });
});
