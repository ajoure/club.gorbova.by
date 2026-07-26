import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdvantagesSection } from "../sections/AdvantagesSection";

describe("CbNative industry module cards", () => {
  it("keeps a tariff CTA on every included and paid module card", () => {
    const onCta = vi.fn();
    const { container } = render(<AdvantagesSection onCta={onCta} />);
    const priceCtas = container.querySelectorAll(
      "[data-cb-native-module-price-cta]",
    );
    const includedCtas = container.querySelectorAll(
      "[data-cb-native-module-included-cta]",
    );

    expect(priceCtas).toHaveLength(9);
    expect(includedCtas).toHaveLength(2);

    fireEvent.click(priceCtas[0]);
    fireEvent.click(includedCtas[0]);
    expect(onCta).toHaveBeenCalledTimes(2);
  });
});
