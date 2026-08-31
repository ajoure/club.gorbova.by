import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/grant-access-for-order/index.ts"),
  "utf8",
);

describe("grant-access-for-order payment-window contract", () => {
  it("starts an ordinary access window from the confirmed payment date", () => {
    expect(source).toContain('.from("payments_v2")');
    expect(source).toContain('.eq("status", "succeeded")');
    expect(source).toContain('.order("paid_at", { ascending: true })');
    expect(source).toContain("baseStartDate = paymentWindow.start");
    expect(source.indexOf('resolveGrantPaymentWindow({')).toBeLessThan(source.indexOf('// ── IDEMPOTENCY HARD GUARD'));
  });

  it("does not revive access from the order date or current time", () => {
    const startWindow = source.slice(source.indexOf("const baseStartDate = paymentWindow.start"), source.indexOf("// Check for existing active subscription"));
    expect(startWindow).not.toContain("order.created_at");
    expect(startWindow).not.toContain("order.paid_at");
    expect(startWindow).not.toMatch(/baseStartDate\s*=\s*now/);
    expect(startWindow).toContain("access_window_requires_paid_at");
  });
});
