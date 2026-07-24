import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublicTariff } from "@/hooks/usePublicProduct";
import { CbNativeTariffCard } from "../sections/CbNativeTariffCard";

const tariff = {
  id: "tariff",
  code: "tariff",
  name: "Tariff",
  description: null,
  badge: null,
  subtitle: null,
  price_monthly: null,
  period_label: null,
  access_days: 0,
  features: [],
  offers: [],
  is_popular: false,
} satisfies PublicTariff;

const lockedCount = (index: number) => {
  const { container, unmount } = render(
    <CbNativeTariffCard
      tariff={{ ...tariff, id: `tariff-${index}` }}
      index={index}
      onSelectOffer={() => undefined}
    />,
  );
  const count = container.querySelectorAll('[data-locked="true"]').length;
  unmount();
  return count;
};

describe("CbNative tariff access matrix", () => {
  it("keeps the original locked feature rules for all three tariffs", () => {
    expect(lockedCount(0)).toBe(9);
    expect(lockedCount(1)).toBe(5);
    expect(lockedCount(2)).toBe(0);
  });

  it("does not show club access as included in the first tariff", () => {
    const { container } = render(
      <CbNativeTariffCard tariff={tariff} index={0} onSelectOffer={() => undefined} />,
    );

    const clubRow = Array.from(container.querySelectorAll('[data-locked="true"]')).find(
      (node) => node.textContent?.includes("Доступ к клубу «Буква закона»"),
    );
    expect(clubRow).toBeTruthy();
  });
});
