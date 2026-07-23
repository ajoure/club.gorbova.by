import { describe, expect, it } from "vitest";
import { buildComposableQuote } from "../../supabase/functions/_shared/composable-checkout";

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
});
