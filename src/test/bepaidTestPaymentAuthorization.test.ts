import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/bepaid-create-token/index.ts"),
  "utf8",
);

describe("bePaid test payment authorization", () => {
  it("requires an authenticated super admin before the test route can create an order", () => {
    const guard = source.indexOf("test_payment_requires_super_admin");
    const firstWrite = source.indexOf(".from('products_v2')");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(firstWrite);
    expect(source).toContain("if (skipRedirect) {");
    expect(source).toContain("if (!authUserId)");
    expect(source).toContain("supabase.rpc('has_role_v2'");
    expect(source).toContain("_role_code: 'super_admin'");
  });
});
