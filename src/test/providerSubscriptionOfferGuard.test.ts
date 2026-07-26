import { describe, expect, it } from "vitest";
import { guardProviderSubscriptionOffer } from "../../supabase/functions/_shared/provider-subscription-offer-guard";

describe("provider subscription offer guard", () => {
  it("fails closed for a finite internal installment", () => {
    expect(guardProviderSubscriptionOffer({
      id: "offer-installment",
      tariff_id: "tariff-1",
      is_active: true,
      payment_method: "internal_installment",
      is_installment: false,
      installment_count: 2,
    }, "tariff-1")).toEqual({
      ok: false,
      code: "FINITE_INSTALLMENT_REQUIRES_INSTALLMENT_CHECKOUT",
      status: 409,
    });
  });

  it("also blocks inconsistent installment markers", () => {
    expect(guardProviderSubscriptionOffer({
      id: "offer-installment",
      tariff_id: "tariff-1",
      is_active: true,
      payment_method: "full_payment",
      is_installment: false,
      installment_count: 2,
    }, "tariff-1").ok).toBe(false);
  });

  it("allows an active recurring offer for the expected tariff", () => {
    expect(guardProviderSubscriptionOffer({
      id: "offer-recurring",
      tariff_id: "tariff-1",
      is_active: true,
      payment_method: "full_payment",
      is_installment: false,
      installment_count: null,
    }, "tariff-1")).toEqual({ ok: true });
  });

  it("rejects an offer from another tariff", () => {
    expect(guardProviderSubscriptionOffer({
      id: "offer-recurring",
      tariff_id: "tariff-2",
      is_active: true,
    }, "tariff-1")).toEqual({
      ok: false,
      code: "INVALID_OFFER",
      status: 400,
    });
  });
});
