import { describe, expect, it } from "vitest";
import {
  isFiniteInstallment,
  resolveInstallmentProgress,
} from "./autoRenewalInstallments";

describe("isFiniteInstallment", () => {
  it("recognizes the canonical finite subscription marker", () => {
    expect(isFiniteInstallment({
      subscriptionMeta: {
        model: "bepaid_finite_subscription",
        billing_cycles: 6,
      },
    })).toBe(true);
  });

  it("recognizes legacy and offer-level installment contracts", () => {
    expect(isFiniteInstallment({
      subscriptionMeta: {
        installment: { as_finite_subscription: true },
      },
    })).toBe(true);
    expect(isFiniteInstallment({
      offerPaymentMethod: "internal_installment",
      offerInstallmentCount: 2,
    })).toBe(true);
  });

  it("does not turn an open-ended recurring subscription into an installment", () => {
    expect(isFiniteInstallment({
      subscriptionMeta: {
        recurring: { is_recurring: true },
      },
    })).toBe(false);
  });
});

describe("resolveInstallmentProgress", () => {
  it("uses the canonical order progress written by the bePaid webhook", () => {
    const progress = resolveInstallmentProgress({
      orderMeta: {
        installment_progress: {
          billing_cycles: 6,
          paid_billing_cycles: 2,
          per_payment_byn: 339,
          effective_total_byn: 2034,
          paid_total_byn: 678,
          remaining_total_byn: 1356,
          next_charge_at: "2026-08-30T09:00:00.000Z",
          status: "active",
        },
      },
    });

    expect(progress).toMatchObject({
      totalPayments: 6,
      paidPayments: 2,
      remainingPayments: 4,
      nextPaymentNumber: 3,
      perPaymentAmount: 339,
      remainingAmount: 1356,
      totalAmount: 2034,
      nextChargeAt: "2026-08-30T09:00:00.000Z",
      completed: false,
    });
  });

  it("falls back to subscription snapshots without inventing paid cycles", () => {
    const progress = resolveInstallmentProgress({
      subscriptionMeta: {
        installment_count: 2,
        installment_per_payment_amount_byn: 195,
        installment_total_amount_byn: 390,
      },
      subscriptionNextChargeAt: "2026-08-25T00:21:00.000Z",
    });

    expect(progress.paidPayments).toBe(0);
    expect(progress.remainingPayments).toBe(2);
    expect(progress.remainingAmount).toBe(390);
    expect(progress.nextPaymentNumber).toBe(1);
  });

  it("does not let legacy nulls hide a later canonical value", () => {
    const progress = resolveInstallmentProgress({
      orderMeta: {
        installment_progress: {
          billing_cycles: 3,
          paid_billing_cycles: null,
          per_payment_byn: null,
        },
      },
      subscriptionMeta: {
        paid_billing_cycles: 1,
        installment_per_payment_amount_byn: 100,
        installment_total_amount_byn: 300,
      },
    });

    expect(progress.paidPayments).toBe(1);
    expect(progress.perPaymentAmount).toBe(100);
    expect(progress.remainingAmount).toBe(200);
  });

  it("closes a completed finite plan", () => {
    const progress = resolveInstallmentProgress({
      orderMeta: {
        installment_progress: {
          billing_cycles: 2,
          paid_billing_cycles: 2,
          per_payment_byn: 195,
          effective_total_byn: 390,
          paid_total_byn: 390,
          status: "completed",
        },
      },
    });

    expect(progress.completed).toBe(true);
    expect(progress.remainingPayments).toBe(0);
    expect(progress.remainingAmount).toBe(0);
    expect(progress.nextChargeAt).toBeNull();
  });
});
