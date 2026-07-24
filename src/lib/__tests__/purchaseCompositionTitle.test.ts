import { describe, expect, it } from "vitest";
import { buildPurchaseCompositionTitle } from "../purchaseCompositionTitle";

describe("buildPurchaseCompositionTitle", () => {
  it("returns primary only when no addons", () => {
    expect(
      buildPurchaseCompositionTitle({
        primary: { product_name: "Ценный бухгалтер", tariff_name: "Бухгалтер" },
      }),
    ).toBe("Ценный бухгалтер, тариф Бухгалтер");
  });

  it("appends addon modules with proper separators", () => {
    expect(
      buildPurchaseCompositionTitle({
        primary: { product_name: "Ценный бухгалтер", tariff_name: "Бизнес-леди" },
        addons: [
          { product_name: "Учет у ИП" },
          { product_name: "Маркетплейсы" },
        ],
      }),
    ).toBe("Ценный бухгалтер, тариф Бизнес-леди. Модуль Учет у ИП. Модуль Маркетплейсы");
  });

  it("omits tariff clause when tariff_name is empty", () => {
    expect(
      buildPurchaseCompositionTitle({
        primary: { product_name: "Консультация", tariff_name: "" },
      }),
    ).toBe("Консультация");
  });

  it("skips undefined/empty addon names without dangling separators", () => {
    expect(
      buildPurchaseCompositionTitle({
        primary: { product_name: "X", tariff_name: "Y" },
        addons: [
          { product_name: "" },
          { product_name: "  " },
          { product_name: "Строительство" },
        ],
      }),
    ).toBe("X, тариф Y. Модуль Строительство");
  });

  it("returns empty string when primary product_name missing", () => {
    expect(
      buildPurchaseCompositionTitle({ primary: { product_name: "", tariff_name: "T" } }),
    ).toBe("");
  });
});
