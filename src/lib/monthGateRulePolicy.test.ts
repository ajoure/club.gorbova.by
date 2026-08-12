import { describe, expect, it } from "vitest";
import {
  isExplicitProductBypassRule,
  isMonthPurchaseRule,
} from "./monthGateRulePolicy";

describe("month gate rule policy", () => {
  it("never treats a monthly tariff rule as a product-entitlement bypass", () => {
    const rule = {
      product_id: "cb20",
      tariff_id: "business-lady",
      conditions: {
        match_purchase_month: true,
        access_mode: "partial",
        allowed_module_ids: ["monthly-webinar"],
      },
    };

    expect(isMonthPurchaseRule(rule)).toBe(true);
    expect(isExplicitProductBypassRule(rule)).toBe(false);
  });

  it("allows only an explicit non-month product allowlist to bypass", () => {
    expect(
      isExplicitProductBypassRule({
        product_id: "historical-product",
        conditions: { allowed_module_ids: ["purchased-module"] },
      }),
    ).toBe(true);

    expect(
      isExplicitProductBypassRule({
        product_id: "club",
        conditions: { access_mode: "full" },
      }),
    ).toBe(false);
  });

  it("does not create a month gate without an exact tariff", () => {
    expect(
      isMonthPurchaseRule({
        product_id: "club",
        tariff_id: null,
        conditions: { match_purchase_month: true },
      }),
    ).toBe(false);
  });
});
