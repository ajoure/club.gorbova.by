import { describe, expect, it } from "vitest";
import { hasConfiguredCheckoutAddons } from "./composableCheckoutGate";

describe("hasConfiguredCheckoutAddons", () => {
  it.each(["pay_now", "invoice", "bank_installment"])(
    "opens configured add-ons for %s",
    (offerType) => {
      expect(
        hasConfiguredCheckoutAddons({
          offer_type: offerType,
          has_available_addons: true,
        }),
      ).toBe(true);
    },
  );

  it("does not route lead forms through the composable purchase flow", () => {
    expect(
      hasConfiguredCheckoutAddons({
        offer_type: "lead",
        has_available_addons: true,
      }),
    ).toBe(false);
  });

  it("keeps offers without configured add-ons on their direct flow", () => {
    expect(
      hasConfiguredCheckoutAddons({
        offer_type: "bank_installment",
        has_available_addons: false,
      }),
    ).toBe(false);
  });
});
