import { describe, expect, it } from "vitest";
import { buildReferralLink, formatBynMinor, parseBynMinor, readCapturedReferral, REFERRAL_STORAGE_KEY, referralStatusLabel, storeCapturedReferral } from "./referrals";

describe("referral helpers", () => {
  it("parses exact kopiykas and rejects ambiguous amounts", () => {
    expect(parseBynMinor("1180,00")).toBe(118000);
    expect(parseBynMinor("0.29")).toBe(29);
    expect(parseBynMinor("50")).toBe(5000);
    for (const value of ["", "NaN", "-50", "1.234", "1e3", "Infinity", "10000001"]) {
      expect(() => parseBynMinor(value)).toThrow();
    }
  });
  it("formats minor units as BYN", () => {
    expect(formatBynMinor(50000)).toContain("500");
  });

  it("creates a link with an encoded partner code", () => {
    expect(buildReferralLink("REF-ABC")).toBe("https://gorbova.by/r/REF-ABC");
  });

  it("never leaks the current Lovable preview origin into a referral link", () => {
    expect(buildReferralLink("REF A/B")).toBe("https://gorbova.by/r/REF%20A%2FB");
  });

  it("uses understandable status labels", () => {
    expect(referralStatusLabel("pending")).toContain("Ожидает");
    expect(referralStatusLabel("available")).toContain("выплате");
  });

  it("stores referral capture time with the code", () => {
    storeCapturedReferral("REF-TIME");
    expect(readCapturedReferral()?.code).toBe("REF-TIME");
    expect(Date.parse(readCapturedReferral()!.capturedAt)).not.toBeNaN();
    localStorage.removeItem(REFERRAL_STORAGE_KEY);
  });
});
