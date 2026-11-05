import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import { matchesBonusRequest, parseBonusMinor, type BonusRequest, type BonusWallet } from "./customer-bonus";

describe("customer bonus amounts and exact durable readback", () => {
  it.each([["150", 15000], ["150,5", 15050], ["150.05", 15005], [" 0,01 ", 1]])("parses %s exactly in minor units", (value, minor) => {
    expect(parseBonusMinor(value as string)).toBe(minor);
  });
  it.each(["", "0", "-10", "1.005", "1e3", "Infinity", "NaN", "150 BYN", "1 500", "9007199254740992"])("rejects invalid decimal %s", (value) => {
    expect(parseBonusMinor(value)).toBeNull();
  });
  it("requires the same contact, amount, reason, source payment and posted entry", () => {
    const request: BonusRequest = { requestId: "request", profileId: "profile", amountMinor: 15000, reason: "reason", paymentId: "payment" };
    const result: BonusWallet = { available_minor: 15000, currency: "BYN", entries: [], request: {
      entry_id: "entry", profile_id: "profile", amount_minor: 15000, reason: "reason", source_payment_id: "payment", status: "posted",
    } };
    expect(matchesBonusRequest(result, request, "entry")).toBe(true);
    for (const delta of [{ profile_id: "other" }, { amount_minor: 1 }, { reason: "other" }, { source_payment_id: null }, { status: "released" }]) {
      expect(matchesBonusRequest({ ...result, request: { ...result.request!, ...delta } }, request)).toBe(false);
    }
    expect(matchesBonusRequest(result, request, "other")).toBe(false);
    expect(matchesBonusRequest({ ...result, request: null }, request)).toBe(false);
  });
});
