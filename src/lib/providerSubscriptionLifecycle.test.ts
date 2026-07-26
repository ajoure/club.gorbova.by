import { describe, expect, it } from "vitest";
import { isFiniteInstallmentProviderSubscription } from "./providerSubscriptionLifecycle";

describe("isFiniteInstallmentProviderSubscription", () => {
  it("recognizes canonical finite installment metadata on provider row", () => {
    expect(isFiniteInstallmentProviderSubscription({
      meta: {
        payment_method: "internal_installment",
        installment: {
          model: "bepaid_finite_subscription",
          billing_cycles: 2,
        },
      },
    })).toBe(true);
  });

  it("recognizes canonical finite installment metadata on subscriptions_v2", () => {
    expect(isFiniteInstallmentProviderSubscription({
      meta: {},
      subscriptions_v2: {
        meta: {
          installment_progress: {
            model: "bepaid_finite_subscription",
          },
        },
      },
    })).toBe(true);
  });

  it("does not hide a real recurring subscription", () => {
    expect(isFiniteInstallmentProviderSubscription({
      meta: { model: "bepaid_subscription" },
      subscriptions_v2: {
        meta: {
          recurring_snapshot: { is_recurring: true },
        },
      },
    })).toBe(false);
  });
});
