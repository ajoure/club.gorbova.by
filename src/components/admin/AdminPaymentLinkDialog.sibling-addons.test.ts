import { describe, expect, it } from "vitest";
import { mapSiblingAddonOfferIds } from "@/utils/mapSiblingAddonOfferIds";

describe("mapSiblingAddonOfferIds", () => {
  const payNowAddons = [
    {
      addon_offer_id: "pay-marketplaces",
      addon_product_id: "product-marketplaces",
      addon_product_name: "Маркетплейсы",
    },
    {
      addon_offer_id: "pay-management",
      addon_product_id: "product-management",
      addon_product_name: "Управленческий учёт",
    },
  ];

  it("translates pay_now selections to sibling offer ids by product", () => {
    const result = mapSiblingAddonOfferIds(
      payNowAddons,
      [
        {
          addon_offer_id: "rr-marketplaces",
          addon_product_id: "product-marketplaces",
          addon_product_name: "Маркетплейсы",
        },
        {
          addon_offer_id: "rr-management",
          addon_product_id: "product-management",
          addon_product_name: "Управленческий учёт",
        },
      ],
      ["pay-marketplaces", "pay-management"],
    );

    expect(result).toEqual({
      addonOfferIds: ["rr-marketplaces", "rr-management"],
      missingAddonNames: [],
    });
  });

  it("blocks a selected addon that has no sibling equivalent", () => {
    const result = mapSiblingAddonOfferIds(
      payNowAddons,
      [
        {
          addon_offer_id: "rr-marketplaces",
          addon_product_id: "product-marketplaces",
          addon_product_name: "Маркетплейсы",
        },
      ],
      ["pay-marketplaces", "pay-management"],
    );

    expect(result).toEqual({
      addonOfferIds: ["rr-marketplaces"],
      missingAddonNames: ["Управленческий учёт"],
    });
  });
});
