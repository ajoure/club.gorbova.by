import { describe, expect, it } from "vitest";
import { redemptionPrice, redemptionStartError } from "./referral-redemption-preview";

describe("referral period estimate", () => {
  const monthly = { amount_minor: 25000, recurring: { is_recurring: true, billing_period_mode: "month" } };
  it("prices three monthly periods and does not prorate unsupported days", () => {
    expect(redemptionPrice(monthly, { price: "", unit: "months", count: 3 })).toBe(75000);
    expect(redemptionPrice(monthly, { price: "", unit: "days", count: 90 })).toBeNull();
    expect(redemptionPrice(monthly, { price: "740,50", unit: "days", count: 90 })).toBe(74050);
  });
  it("does not multiply a fixed one-time offer by the access duration", () => {
    expect(redemptionPrice({ amount_minor: 25000, recurring: {} }, { price: "", unit: "months", count: 3 })).toBe(25000);
  });
  it("requires a future explicit start but never freezes the now mode to the device clock", () => {
    const now = Date.parse("2026-10-02T12:31:30Z");
    expect(redemptionStartError({ startMode: "date", start: "2026-10-02T12:31:00Z" }, now)).toContain("уже прошла");
    expect(redemptionStartError({ startMode: "date", start: "" }, now)).toContain("Укажите дату");
    expect(redemptionStartError({ startMode: "date", start: "2026-10-02T12:32:00Z" }, now)).toBeNull();
    expect(redemptionStartError({ startMode: "now", start: "2026-10-02T12:31:00Z" }, now)).toBeNull();
  });
});
