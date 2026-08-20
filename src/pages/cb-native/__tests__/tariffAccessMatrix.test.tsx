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

const paymentOffers = [
  {
    id: "invoice",
    tariff_id: tariff.id,
    offer_type: "invoice" as const,
    button_label: "Оплатить от юрлица",
    amount: 1,
    trial_days: null,
    auto_charge_after_trial: false,
    auto_charge_amount: null,
    auto_charge_delay_days: null,
    requires_card_tokenization: false,
    sort_order: 0,
    is_active: true,
    payment_method: "bank_transfer",
    meta: { slot_role: "button_2", site_button_variant: "legal_entity" },
  },
  {
    id: "installment",
    tariff_id: tariff.id,
    offer_type: "pay_now" as const,
    button_label: "Оплатить в 2 платежа",
    amount: 1,
    trial_days: null,
    auto_charge_after_trial: false,
    auto_charge_amount: null,
    auto_charge_delay_days: null,
    requires_card_tokenization: false,
    sort_order: 0,
    is_active: true,
    payment_method: "internal_installment",
    meta: { slot_role: "button_4", site_button_variant: "installment" },
  },
  {
    id: "bank",
    tariff_id: tariff.id,
    offer_type: "bank_installment" as const,
    button_label: "Рассрочка от банка",
    amount: 1,
    trial_days: null,
    auto_charge_after_trial: false,
    auto_charge_amount: null,
    auto_charge_delay_days: null,
    requires_card_tokenization: false,
    sort_order: 0,
    is_active: true,
    payment_method: "full_payment",
    meta: { slot_role: "button_5", site_button_variant: "installment" },
  },
  {
    id: "full",
    tariff_id: tariff.id,
    offer_type: "pay_now" as const,
    button_label: "Оплатить 100% картой",
    amount: 1,
    trial_days: null,
    auto_charge_after_trial: false,
    auto_charge_amount: null,
    auto_charge_delay_days: null,
    requires_card_tokenization: false,
    sort_order: 0,
    is_active: true,
    payment_method: "full_payment",
    meta: { slot_role: "button_1", site_button_variant: "primary" },
  },
];

describe("CbNative tariff access matrix", () => {
  it("keeps payment actions in the same order and uses their saved visual settings", () => {
    const expectedLabels = [
      "Оплатить 100% картой",
      "Рассрочка от банка",
      "Оплатить в 2 платежа",
      "Оплатить от юрлица",
    ];
    const expectedBackgrounds = [
      "rgb(228, 34, 194)",
      "rgb(249, 115, 22)",
      "rgb(249, 115, 22)",
      "rgb(5, 150, 105)",
    ];

    for (const index of [0, 1, 2]) {
      const { container, unmount } = render(
        <CbNativeTariffCard
          tariff={{ ...tariff, id: `tariff-${index}`, offers: paymentOffers }}
          index={index}
          onSelectOffer={() => undefined}
        />,
      );
      const buttons = Array.from(container.querySelectorAll("button"));

      expect(buttons.map((button) => button.textContent)).toEqual(expectedLabels);
      expect(buttons.map((button) => button.style.background)).toEqual(expectedBackgrounds);
      unmount();
    }
  });

  it("changes a button appearance through site_button_variant without changing its purpose", () => {
    const configurableOffer = {
      ...paymentOffers.find((offer) => offer.id === "full")!,
      meta: { slot_role: "button_1", site_button_variant: "lead" },
    };
    const { getByRole } = render(
      <CbNativeTariffCard
        tariff={{ ...tariff, offers: [configurableOffer] }}
        index={0}
        onSelectOffer={() => undefined}
      />,
    );

    expect(getByRole("button", { name: "Оплатить 100% картой" }).style.background).toBe(
      "rgb(100, 116, 139)",
    );
  });

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

  it("renders compact text badges inline without the legacy transparent PNG assets", () => {
    const { container } = render(
      <CbNativeTariffCard tariff={tariff} index={2} onSelectOffer={() => undefined} />,
    );

    const badges = container.querySelectorAll("[data-cb-native-feature-badge]");
    expect(badges.length).toBeGreaterThan(0);
    expect(Array.from(badges).map((badge) => badge.textContent)).toEqual(
      expect.arrayContaining(["VIP", "GRAND", "BUSINESS"]),
    );
    expect(
      container.querySelector('img[alt="VIP"], img[alt="Grand"], img[alt="Business"]'),
    ).toBeNull();
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
