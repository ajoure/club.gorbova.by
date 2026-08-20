import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public tariff visibility contract", () => {
  it("filters hidden tariffs in both public product handlers", () => {
    for (const path of [
      "supabase/functions/public-product/index.ts",
      "supabase/functions/public-product-by-slug/index.ts",
    ]) {
      const source = read(path);
      expect(source).toContain('.eq("is_public", true)');
    }

    const directTariff = read(
      "supabase/functions/public-tariff-by-public-id/index.ts",
    );
    expect(directTariff).toContain("!tariff.is_public");
  });

  it("keeps existing tariffs public when the migration is applied", () => {
    const migration = read(
      "supabase/migrations/20260820102445_add_tariff_public_visibility.sql",
    );
    expect(migration).toMatch(/is_public boolean NOT NULL DEFAULT true/i);
  });
});
