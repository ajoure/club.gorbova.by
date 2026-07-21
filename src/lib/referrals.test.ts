import { describe, expect, it } from "vitest";
import { buildReferralLink, formatBynMinor, referralStatusLabel } from "./referrals";

describe("referral helpers", () => {
  it("formats minor units as BYN", () => {
    expect(formatBynMinor(50000)).toContain("500");
  });

  it("creates a link with an encoded partner code", () => {
    expect(buildReferralLink("REF-ABC")).toMatch(/\/r\/REF-ABC$/);
  });

  it("uses understandable status labels", () => {
    expect(referralStatusLabel("pending")).toContain("Ожидает");
    expect(referralStatusLabel("available")).toContain("выплате");
  });
});
