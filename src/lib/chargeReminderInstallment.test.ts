import { describe, expect, it } from "vitest";
import { buildVirtualInstallmentPayment } from "../../supabase/functions/_shared/finite-installment-progress.ts";

describe("buildVirtualInstallmentPayment", () => {
  it("reconstructs the next finite payment from order progress", () => {
    const payment = buildVirtualInstallmentPayment(
      {
        amount_cents: 33900,
        currency: "BYN",
        next_charge_at: "2026-09-01T09:00:00.000Z",
        meta: { model: "bepaid_finite_subscription" },
      },
      {
        id: "sub-1",
        next_charge_at: "2026-09-01T09:00:00.000Z",
        meta: {
          model: "bepaid_finite_subscription",
          billing_cycles: 6,
        },
        orders_v2: {
          currency: "BYN",
          meta: {
            installment_progress: {
              billing_cycles: 6,
              paid_billing_cycles: 2,
              per_payment_byn: 339,
              next_charge_at: "2026-08-30T09:00:00.000Z",
              status: "active",
            },
          },
        },
      },
    );

    expect(payment).toMatchObject({
      payment_number: 3,
      total_payments: 6,
      amount: 339,
      currency: "BYN",
      due_date: "2026-08-30T09:00:00.000Z",
      virtual: true,
    });
    expect(payment.id).toContain("virtual:sub-1:3:");
  });

  it("does not invent a scheduled payment for a completed plan", () => {
    const payment = buildVirtualInstallmentPayment(
      { amount_cents: 19500, currency: "BYN" },
      {
        id: "sub-2",
        meta: { billing_cycles: 2 },
        orders_v2: {
          meta: {
            installment_progress: {
              billing_cycles: 2,
              paid_billing_cycles: 2,
              status: "completed",
            },
          },
        },
      },
    );

    expect(payment).toBeNull();
  });

  it("requires a real next-charge date", () => {
    const payment = buildVirtualInstallmentPayment(
      { amount_cents: 19500, currency: "BYN" },
      {
        id: "sub-3",
        meta: {
          model: "bepaid_finite_subscription",
          billing_cycles: 2,
        },
      },
    );

    expect(payment).toBeNull();
  });

  it("does not let a null progress counter hide provider evidence", () => {
    const payment = buildVirtualInstallmentPayment(
      {
        amount_cents: 10000,
        currency: "BYN",
        next_charge_at: "2026-09-30T09:00:00.000Z",
        meta: {
          retry_observability: { successful_attempts: 1 },
        },
      },
      {
        id: "sub-4",
        meta: { billing_cycles: 3 },
        orders_v2: {
          meta: {
            installment_progress: {
              billing_cycles: 3,
              paid_billing_cycles: null,
              next_charge_at: "2026-09-30T09:00:00.000Z",
            },
          },
        },
      },
    );

    expect(payment?.payment_number).toBe(2);
  });
});
