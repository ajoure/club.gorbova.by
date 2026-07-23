import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildComposableQuote } from "./composable-checkout.ts";

const primary = {
  role: "primary" as const,
  product_id: "p1",
  product_name: "Ценный бухгалтер",
  tariff_id: "t1",
  tariff_name: "Премиум",
  offer_id: "o1",
  list_amount: 1500,
};

Deno.test("calculates discounted, free and adjusted composite quote", () => {
  const result = buildComposableQuote([
    primary,
    { ...primary, role: "addon", product_id: "p2", offer_id: "o2", list_amount: 500, pricing_mode: "percent_discount", discount_percent: 20 },
    { ...primary, role: "addon", product_id: "p3", offer_id: "o3", list_amount: 500, pricing_mode: "free" },
  ], -100);
  assertEquals(result.subtotal, 1900);
  assertEquals(result.total, 1800);
  assertEquals(result.items.map((item) => item.final_amount), [1500, 400, 0]);
});

Deno.test("rejects duplicate offers", () => {
  assertThrows(() => buildComposableQuote([primary, { ...primary, role: "addon" }]), Error, "duplicate_offer");
});

Deno.test("fixed price above list does not create a negative discount", () => {
  const result = buildComposableQuote([
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
  assertEquals(result.items[1].discount_amount, 0);
  assertEquals(result.items[1].final_amount, 500);
});

Deno.test("rejects invalid percentage and negative total", () => {
  assertThrows(() => buildComposableQuote([
    primary,
    { ...primary, role: "addon", offer_id: "o2", pricing_mode: "percent_discount", discount_percent: 120 },
  ]), Error, "invalid_final_amount");
  assertThrows(() => buildComposableQuote([primary], -1500.01), Error, "invalid_adjustment");
});
