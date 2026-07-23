import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/training-copy-move/index.ts"),
  "utf8",
);

describe("training-copy-move module copy contract", () => {
  it("does not copy the unique public_id into a duplicated module", () => {
    expect(source).toMatch(
      /const\s*\{[\s\S]*?public_id:\s*_publicId,[\s\S]*?\.\.\.rest[\s\S]*?\}\s*=\s*mod;/,
    );
  });

  it("lets the database generate the copied module public_id", () => {
    const moduleInsert = source.match(
      /\.from\("training_modules"\)[\s\S]*?\.insert\(\{([\s\S]*?)\}\)[\s\S]*?\.select\("id"\)/,
    );

    expect(moduleInsert).not.toBeNull();
    expect(moduleInsert?.[1]).not.toContain("public_id:");
  });
});
