import { describe, expect, it } from "vitest";
import { resolveProductRenewability } from "../../supabase/functions/_shared/renewal-offer-resolver";

function queryResult(data: unknown[]) {
  type QueryChain = {
    select: () => QueryChain;
    eq: () => QueryChain;
    in: () => QueryChain;
    then: (resolve: (value: unknown) => void) => void;
  };
  const chain = {} as QueryChain;
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    then: (resolve: (value: unknown) => void) => resolve({ data, error: null }),
  });
  return chain;
}

function fakeSupabase(offers: unknown[]) {
  return {
    from(table: string) {
      if (table === "tariffs") {
        return queryResult([{ id: "tariff-1", is_active: true }]);
      }
      if (table === "tariff_offers") {
        return queryResult(offers);
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const baseOffer = {
  id: "offer-1",
  tariff_id: "tariff-1",
  offer_type: "pay_now",
  amount: 175,
  is_active: true,
  is_primary: true,
  visible_from: null,
  visible_to: null,
  meta: {},
};

describe("payment lifecycle renewability", () => {
  it("treats a finite installment as non-renewable", async () => {
    const result = await resolveProductRenewability(
      fakeSupabase([{
        ...baseOffer,
        payment_method: "internal_installment",
        is_installment: true,
        installment_count: 2,
      }]),
      "product-1",
      "tariff-1",
    );

    expect(result.hasInstallment).toBe(true);
    expect(result.renewable).toBe(false);
    expect(result.preferredOffer).toBeNull();
    expect(result.reason).toBe("finite_installment_or_one_time_only");
  });

  it("keeps a real recurring offer renewable", async () => {
    const result = await resolveProductRenewability(
      fakeSupabase([{
        ...baseOffer,
        payment_method: "card",
        is_installment: false,
        installment_count: null,
        meta: { recurring: { is_recurring: true } },
      }]),
      "product-1",
      "tariff-1",
    );

    expect(result.hasRecurring).toBe(true);
    expect(result.renewable).toBe(true);
    expect(result.preferredOffer?.kind).toBe("recurring");
  });

  it("keeps an explicit subscription offer renewable", async () => {
    const result = await resolveProductRenewability(
      fakeSupabase([{
        ...baseOffer,
        offer_type: "subscription",
        payment_method: "card",
        is_installment: false,
        installment_count: null,
      }]),
      "product-1",
      "tariff-1",
    );

    expect(result.hasSubscriptionOffer).toBe(true);
    expect(result.renewable).toBe(true);
  });
});
