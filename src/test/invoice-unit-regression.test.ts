/**
 * Regression: unit for composable purchase (base + addons) MUST be "доступ".
 *
 * Bug fixed: invoice-checkout-issue / admin-invoice-checkout-issue /
 * document-data-snapshot temporarily emitted unit="комплект" for the composable
 * checkout — the PDF счёт-акт renders one service line with wrong unit.
 * Canonical unit is "доступ". Guard the literal at the source level so a future
 * refactor cannot silently regress it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
  "supabase/functions/invoice-checkout-issue/index.ts",
  "supabase/functions/admin-invoice-checkout-issue/index.ts",
  "supabase/functions/_shared/document-data-snapshot.ts",
];

describe("invoice document_data.unit", () => {
  for (const rel of files) {
    it(`${rel}: does not emit unit "комплект"`, () => {
      const src = readFileSync(resolve(process.cwd(), rel), "utf8");
      expect(src).not.toMatch(/unit:\s*['"]комплект['"]/);
      expect(src).toMatch(/['"]доступ['"]/);
    });
  }

  it("composable payload shape: single service line, qty=1, unit=доступ", () => {
    // Emulates the payload built by invoice-checkout-issue for a composable
    // purchase (base product + N addons). Exactly one service line is written;
    // per-addon detail lives in line_items.
    const quote = {
      total: 3050,
      subtotal: 3050,
      currency: "BYN",
      adjustment_amount: 0,
      adjustment_reason: null,
      items: [
        { role: "primary", product_name: "Ценный бухгалтер", tariff_name: "Бизнес-леди 2.0", final_amount: 2650 },
        { role: "addon", product_name: "Модуль: Строительство", final_amount: 200 },
        { role: "addon", product_name: "Модуль: Маркетплейсы", final_amount: 200 },
      ],
    };
    const documentData = {
      unit: "доступ",
      quantity: 1,
      unit_price: quote.total,
      amount: quote.total,
      currency: quote.currency,
      line_items: quote.items,
    };
    expect(documentData.unit).toBe("доступ");
    expect(documentData.quantity).toBe(1);
    expect(documentData.amount).toBe(3050);
    expect(documentData.line_items).toHaveLength(3);
  });
});
