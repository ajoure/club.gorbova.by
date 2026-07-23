import { describe, expect, it } from "vitest";
import {
  allocateComposablePayableTotal,
  buildComposableQuote,
} from "../../supabase/functions/_shared/composable-checkout";

const primary = {
  role: "primary" as const,
  product_id: "p1",
  product_name: "Ценный бухгалтер",
  tariff_id: "t1",
  tariff_name: "Премиум",
  offer_id: "o1",
  list_amount: 1500,
};

describe("composable checkout quote", () => {
  it("combines discounted and free modules with a manager adjustment", () => {
    const quote = buildComposableQuote([
      primary,
      { ...primary, role: "addon", product_id: "p2", offer_id: "o2", list_amount: 500, pricing_mode: "percent_discount", discount_percent: 20 },
      { ...primary, role: "addon", product_id: "p3", offer_id: "o3", list_amount: 500, pricing_mode: "free" },
    ], -100);
    expect(quote.subtotal).toBe(1900);
    expect(quote.total).toBe(1800);
    expect(quote.items.map((item) => item.final_amount)).toEqual([1500, 400, 0]);
  });

  it("rejects the same offer twice", () => {
    expect(() => buildComposableQuote([primary, { ...primary, role: "addon" }])).toThrow("duplicate_offer");
  });

  it("supports a fixed module price above list without a negative discount", () => {
    const quote = buildComposableQuote([
      primary,
      {
        ...primary,
        role: "addon",
        product_id: "p2",
        offer_id: "o2",
        list_amount: 400,
        pricing_mode: "fixed_price",
        fixed_amount: 500,
      },
    ]);
    expect(quote.items[1]).toMatchObject({
      list_amount: 400,
      final_amount: 500,
      discount_amount: 0,
    });
    expect(quote.total).toBe(2000);
  });

  it("rejects invalid percentage discounts and totals below zero", () => {
    expect(() => buildComposableQuote([
      primary,
      { ...primary, role: "addon", offer_id: "o2", pricing_mode: "percent_discount", discount_percent: 120 },
    ])).toThrow("invalid_final_amount");
    expect(() => buildComposableQuote([primary], -1500.01)).toThrow("invalid_adjustment");
  });

  it("allocates an order-level discount across all paid items to the exact cent", () => {
    const quote = buildComposableQuote([
      primary,
      { ...primary, role: "addon", product_id: "p2", offer_id: "o2", list_amount: 500 },
      { ...primary, role: "addon", product_id: "p3", offer_id: "o3", list_amount: 250 },
    ]);
    const allocated = allocateComposablePayableTotal(
      quote,
      1000.01,
      "referral_discount_or_customer_credit",
    );

    expect(allocated.items.reduce((sum, item) => sum + item.final_amount, 0)).toBeCloseTo(1000.01, 2);
    expect(allocated.total).toBe(1000.01);
    expect(allocated.adjustment_amount).toBe(-1249.99);
    expect(allocated.original_quote.total).toBe(2250);
  });

  it("uses deterministic largest-remainder rounding for a one-cent payment", () => {
    const tinyPrimary = { ...primary, list_amount: 1 };
    const quote = buildComposableQuote([
      tinyPrimary,
      { ...tinyPrimary, role: "addon", product_id: "p2", offer_id: "o2" },
      { ...tinyPrimary, role: "addon", product_id: "p3", offer_id: "o3" },
    ]);
    const allocated = allocateComposablePayableTotal(quote, 0.01, "credit");

    expect(allocated.items.map((item) => item.final_amount)).toEqual([0.01, 0, 0]);
    expect(() => allocateComposablePayableTotal(quote, 0, "credit")).toThrow("invalid_payable_total");
  });
});
