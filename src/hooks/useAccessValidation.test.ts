import { describe, expect, it } from "vitest";
import { isCurrentPurchasedAccess, isCurrentValidAccess } from "./useAccessValidation";

const future = new Date(Date.now() + 86_400_000).toISOString();

describe("purchased access visibility", () => {
  it("keeps a paid active entitlement visible without an access rule", () => {
    const access = {
      status: "active",
      access_end_at: future,
      product_id: "product-club",
      products_v2: { id: "product-club", is_active: true },
    };

    expect(isCurrentPurchasedAccess(access)).toBe(true);
    expect(isCurrentValidAccess(access, new Set())).toBe(false);
  });

  it("does not show expired or inactive access as current", () => {
    expect(isCurrentPurchasedAccess({
      status: "canceled",
      access_end_at: future,
      product_id: "product-club",
    })).toBe(false);

    expect(isCurrentPurchasedAccess({
      status: "active",
      access_end_at: new Date(Date.now() - 86_400_000).toISOString(),
      product_id: "product-club",
    })).toBe(false);
  });
});
