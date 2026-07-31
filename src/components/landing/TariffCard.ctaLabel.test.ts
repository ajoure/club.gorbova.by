import { describe, expect, it } from "vitest";
import tariffCardSource from "./TariffCard.tsx?raw";

describe("TariffCard custom CTA", () => {
  it("does not couple saved CTA wording to the visual button variant", () => {
    expect(tariffCardSource).toContain(
      'cc?.cta_text && offer.offer_type === "pay_now" && index === 0',
    );
    expect(tariffCardSource).not.toContain("index === 0 && !rawVariant");
  });
});
