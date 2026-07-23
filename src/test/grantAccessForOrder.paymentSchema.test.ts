import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/grant-access-for-order/index.ts"),
  "utf8",
);

describe("grant-access-for-order payment schema contract", () => {
  it("does not select the nonexistent payments_v2.parent_payment_id column", () => {
    const selectedColumns = source.match(
      /const paymentsQ[\s\S]*?\.select\('([^']+)'\)/,
    )?.[1] ?? "";

    expect(selectedColumns).toContain("meta");
    expect(selectedColumns).not.toContain("parent_payment_id");
  });
});
