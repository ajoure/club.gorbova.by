import { describe, expect, it } from "vitest";
import {
  buildLocalFiniteCandidateRows,
  buildVirtualInstallmentPayment,
  isFiniteInstallmentModel,
} from "../../supabase/functions/_shared/finite-installment-progress.ts";

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

describe("local finite reminder candidates", () => {
  const localFiniteSubscription = {
    id: "sub-local-1",
    user_id: "user-1",
    status: "active",
    next_charge_at: "2026-09-30T09:00:00.000Z",
    meta: {
      model: "bepaid_finite_subscription",
      billing_cycles: 3,
      recurring_amount: 175,
    },
    orders_v2: {
      currency: "BYN",
      meta: {
        installment_progress: {
          billing_cycles: 3,
          paid_billing_cycles: 1,
          per_payment_byn: 175,
          next_charge_at: "2026-09-30T09:00:00.000Z",
        },
      },
    },
  };

  it("recognizes a finite subscription without provider metadata", () => {
    expect(isFiniteInstallmentModel(null, localFiniteSubscription)).toBe(true);
  });

  it("adds an unlinked finite subscription to the reminder candidates", () => {
    const rows = buildLocalFiniteCandidateRows([], [localFiniteSubscription]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "local:sub-local-1",
      subscription_v2_id: "sub-local-1",
      user_id: "user-1",
      amount_cents: 17500,
      currency: "BYN",
      next_charge_at: "2026-09-30T09:00:00.000Z",
    });
  });

  it("does not duplicate a provider-managed finite subscription", () => {
    const rows = buildLocalFiniteCandidateRows(
      [{ id: "provider-1", subscription_v2_id: "sub-local-1" }],
      [localFiniteSubscription],
    );

    expect(rows).toEqual([]);
  });

  it("does not add ordinary recurring subscriptions", () => {
    const rows = buildLocalFiniteCandidateRows([], [{
      id: "sub-recurring",
      user_id: "user-2",
      status: "active",
      next_charge_at: "2026-09-30T09:00:00.000Z",
      meta: { recurring_amount: 250 },
    }]);

    expect(rows).toEqual([]);
  });
});
