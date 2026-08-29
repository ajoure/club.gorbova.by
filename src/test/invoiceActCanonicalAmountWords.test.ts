import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { formatAmountWithWordsByRublesAndKopecks } from "../../supabase/functions/_shared/amount-with-words";

const root = process.cwd();

describe("canonical invoice-act amount in words", () => {
  it.each([
    [100.74, "100 (сто) рублей, 74 копейки"],
    [100.01, "100 (сто) рублей, 01 копейка"],
    [100.11, "100 (сто) рублей, 11 копеек"],
    [100, "100 (сто) рублей, 00 копеек"],
  ])("formats %s BYN with an explicit, correctly inflected kopeck unit", (amount, expected) => {
    expect(formatAmountWithWordsByRublesAndKopecks(amount, "BYN")).toBe(expected);
  });

  it("uses the shared formatter in every remaining invoice-act rendering path", () => {
    const files = [
      "supabase/functions/generate-from-template/index.ts",
      "supabase/functions/document-auto-generate/index.ts",
      "supabase/functions/_shared/document-render.ts",
      "supabase/functions/canonical-document-generate-strict/index.ts",
    ];

    for (const file of files) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source, file).toContain("formatAmountWithWordsByRublesAndKopecks");
      expect(source, file).not.toMatch(/amount_words\s*:\s*`[^`]*копеек/);
    }
  });

  it("does not keep the two embedded legacy invoice-act generators or their archived DOCX", () => {
    expect(existsSync(resolve(root, "supabase/functions/generate-invoice-act"))).toBe(false);
    expect(existsSync(resolve(root, "supabase/functions/generate-document-pdf"))).toBe(false);
  });
});
