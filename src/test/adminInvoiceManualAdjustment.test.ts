import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("admin invoice manual amount contract", () => {
  const dialog = read("src/components/admin/AdminPaymentLinkDialog.tsx");
  const writer = read("supabase/functions/admin-invoice-checkout-issue/index.ts");

  it("sends the calculated adjustment and requires an audit reason", () => {
    expect(dialog).toContain("adjustment_amount: composableAdjustment");
    expect(dialog).toContain("Укажите причину скидки или наценки");
  });

  it("recalculates the server quote and allocates the manual total to order items", () => {
    expect(writer).toContain("adjustment_amount?: number");
    expect(writer).toContain("invalid_adjustment_amount");
    expect(writer).toContain("adjustment_reason_required");
    expect(writer).toContain("allocateComposablePayableTotal(");
    expect(writer).toContain("baseQuote.subtotal + requestedAdjustment");
    expect(writer).toContain("adjustment_amount: composableQuote.adjustment_amount");
  });
});
