import { describe, expect, it } from "vitest";
import { resolvePriorPurchaseOwner } from "../../supabase/functions/_shared/prior-purchase-identity";

describe("prior purchase identity", () => {
  const allowed = new Set(["auth-user"]);
  const profileMap = new Map([["profile-row", "auth-user"]]);

  it("keeps the canonical auth user on modern orders", () => {
    expect(
      resolvePriorPurchaseOwner(
        { user_id: "auth-user", profile_id: "profile-row" },
        allowed,
        profileMap,
      ),
    ).toBe("auth-user");
  });

  it("recovers a historical profile-only order", () => {
    expect(
      resolvePriorPurchaseOwner(
        { user_id: null, profile_id: "profile-row" },
        allowed,
        profileMap,
      ),
    ).toBe("auth-user");
  });

  it("does not attribute an unrelated order", () => {
    expect(
      resolvePriorPurchaseOwner(
        { user_id: "another-user", profile_id: "unknown-profile" },
        allowed,
        profileMap,
      ),
    ).toBeNull();
  });
});
