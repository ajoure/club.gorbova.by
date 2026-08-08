import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/grant-access-for-order/index.ts"),
  "utf8",
);

describe("grant-access-for-order payment-window contract", () => {
  it("starts an ordinary access window from the confirmed payment date", () => {
    expect(source).toMatch(/else if \(order\.paid_at && !Number\.isNaN\(new Date\(order\.paid_at\)\.getTime\(\)\)\)/);
    expect(source).toContain("baseStartDate = new Date(order.paid_at)");
  });

  it("does not revive access from the order creation date or current time", () => {
    const startWindow = source.slice(source.indexOf("// Determine base start date:"), source.indexOf("// Check for existing active subscription"));
    expect(startWindow).not.toContain("order.created_at");
    expect(startWindow).not.toMatch(/baseStartDate\s*=\s*now/);
    expect(startWindow).toContain("access_window_requires_paid_at");
  });
});
