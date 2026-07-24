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

  it("renders visual prices from the product card configuration", () => {
    const { container } = render(
      <CbNativeTariffCard
        tariff={{
          ...tariff,
          meta: {
            card_config: {
              old_price: 2450,
              price_display: 1950,
              price_suffix: "BYN",
            },
          },
          offers: [
            {
              id: "pay-now",
              tariff_id: tariff.id,
              offer_type: "pay_now",
              button_label: "Оплатить обучение",
              amount: 1950,
              trial_days: null,
              auto_charge_after_trial: false,
              auto_charge_amount: null,
              auto_charge_delay_days: null,
              requires_card_tokenization: false,
              sort_order: 0,
              is_primary: true,
              payment_method: "full_payment",
            },
          ],
        }}
        index={1}
        onSelectOffer={() => undefined}
      />,
    );

    expect(container.querySelector("[data-cb-native-old-price]")?.textContent).toContain(
      "2 450 BYN",
    );
    expect(
      container.querySelector("[data-cb-native-current-price]")?.textContent,
    ).toContain("1 950 BYN");
    expect(
      container.querySelector("[data-cb-native-monthly-price]")?.textContent,
    ).toContain("163 BYN/МЕС");
  });

  it("falls back to the primary payment offer when display pricing is absent", () => {
    const { container } = render(
      <CbNativeTariffCard
        tariff={{
          ...tariff,
          offers: [
            {
              id: "pay-now",
              tariff_id: tariff.id,
              offer_type: "pay_now",
              button_label: "Оплатить обучение",
              amount: 1650,
              trial_days: null,
              auto_charge_after_trial: false,
              auto_charge_amount: null,
              auto_charge_delay_days: null,
              requires_card_tokenization: false,
              sort_order: 0,
              is_primary: true,
              payment_method: "full_payment",
            },
          ],
        }}
        index={0}
        onSelectOffer={() => undefined}
      />,
    );

    expect(
      container.querySelector("[data-cb-native-current-price]")?.textContent,
    ).toContain("1 650 BYN");
    expect(
      container.querySelector("[data-cb-native-monthly-price]")?.textContent,
    ).toContain("138 BYN/МЕС");
  });
});
