import { describe, expect, it } from "vitest";
import sheetSource from "./SubscriptionDetailSheet.tsx?raw";
import portalSource from "./StripePortalButton.tsx?raw";

describe("Stripe self-service cancellation", () => {
  it("uses the provider portal instead of the bePaid-only cancellation route", () => {
    expect(portalSource).toContain("onProviderResolved?.(has)");
    expect(portalSource).toContain("onProviderResolved?.(null)");
    expect(sheetSource).toContain("onProviderResolved={setIsStripeSubscription}");
    expect(sheetSource).toContain("isStripeSubscription === false");
  });
});
