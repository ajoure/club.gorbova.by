import { describe, expect, it } from "vitest";
import type { PublicTariff, TariffOffer } from "@/hooks/usePublicProduct";
import {
  resolveCbTariffCardIndex,
  selectAndSortCbOffers,
  sortCbTariffsForDisplay,
} from "../tariffPublicContract";

const tariff = (name: string, code = name): PublicTariff => ({
  id: name,
  code,
  name,
  description: null,
  badge: null,
  subtitle: null,
  price_monthly: null,
  period_label: null,
  access_days: 30,
  features: [],
  offers: [],
  is_popular: false,
});

const offer = (
  id: string,
  offer_type: TariffOffer["offer_type"],
  payment_method: string,
  slot_role?: string,
): TariffOffer => ({
  id,
  tariff_id: "tariff",
  offer_type,
  button_label: id,
  amount: 1,
  trial_days: null,
  auto_charge_after_trial: false,
  auto_charge_amount: null,
  auto_charge_delay_days: null,
  requires_card_tokenization: false,
  sort_order: 0,
  is_active: true,
  payment_method,
  meta: slot_role ? { slot_role } : undefined,
});

describe("/cb public tariff contract", () => {
  it("maps card content by tariff identity instead of database order", () => {
    expect(resolveCbTariffCardIndex(tariff("Главный бухгалтер"), 0)).toBe(1);
    expect(resolveCbTariffCardIndex(tariff("Бухгалтер"), 1)).toBe(0);
    expect(resolveCbTariffCardIndex(tariff("Бизнес-леди"), 0)).toBe(2);
  });

  it("uses the configured site slot key before the fallback index", () => {
    expect(
      resolveCbTariffCardIndex(
        { ...tariff("Служебное название"), meta: { site_slot_key: "gl_buh" } },
        0,
      ),
    ).toBe(1);
  });

  it("renders tariffs in the canonical public order regardless of database order", () => {
    const result = sortCbTariffsForDisplay([
      tariff("Главный бухгалтер"),
      tariff("Бизнес-леди"),
      tariff("Бухгалтер"),
    ]);

    expect(result.map((item) => item.name)).toEqual([
      "Бухгалтер",
      "Главный бухгалтер",
      "Бизнес-леди",
    ]);
  });

  it("shows only site-placed offers once placement is configured", () => {
    const result = selectAndSortCbOffers([
      offer("pay", "pay_now", "full_payment", "button_1"),
      offer("internal-only", "lead", "full_payment"),
      offer("invoice", "invoice", "bank_transfer", "button_2"),
    ]);

    expect(result.map((item) => item.id)).toEqual(["pay", "invoice"]);
  });

  it("keeps the configured actions in their canonical public order", () => {
    const result = selectAndSortCbOffers([
      offer("invoice", "invoice", "bank_transfer", "button_2"),
      offer("lead", "lead", "full_payment", "button_3"),
      offer("bank", "bank_installment", "full_payment", "button_5"),
      // Production contains this same action under both button_3 and button_4.
      offer("installment", "pay_now", "internal_installment", "button_3"),
      offer("pay", "pay_now", "full_payment", "button_1"),
    ]);

    expect(result.map((item) => item.id)).toEqual([
      "pay",
      "bank",
      "installment",
      "invoice",
      "lead",
    ]);
  });
});
