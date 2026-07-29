import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoiceFunctions = [
  "supabase/functions/invoice-delivery-status/index.ts",
  "supabase/functions/invoice-delivery-retry/index.ts",
  "supabase/functions/invoice-pdf-retry/index.ts",
  "supabase/functions/canonical-document-send/index.ts",
  "supabase/functions/canonical-document-generate-strict/index.ts",
];

const elevatedRoleFunctions = [
  "supabase/functions/invoice-delivery-status/index.ts",
  "supabase/functions/invoice-delivery-retry/index.ts",
  "supabase/functions/invoice-pdf-retry/index.ts",
  "supabase/functions/canonical-document-send/index.ts",
  "supabase/functions/activate-scheduled-product-access/index.ts",
];

describe("invoice caller authentication", () => {
  it.each(invoiceFunctions)("%s uses the signing-key-safe shared helper", (file) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(source).toContain('../_shared/caller-user.ts');
    expect(source).not.toMatch(
      /createClient\([^)]*ANON_KEY[\s\S]{0,180}global:\s*\{\s*headers:\s*\{\s*Authorization/,
    );
  });

  it("validates the explicit token without a duplicated global Authorization header", () => {
    const source = readFileSync(
      resolve(process.cwd(), "supabase/functions/_shared/caller-user.ts"),
      "utf8",
    );
    expect(source).toContain("authClient.auth.getUser(token)");
    expect(source).not.toContain("global:");
    expect(source).toContain("auth_rejected");
    expect(source).not.toMatch(/console\.(?:warn|error)\([^)]*token/);
  });

  it("turns an old document with no delivery metadata into a retryable error", () => {
    const source = readFileSync(
      resolve(process.cwd(), "supabase/functions/invoice-delivery-status/index.ts"),
      "utf8",
    );
    expect(source).toContain('ageMs >= 60_000 ? "error" : "queued"');
    expect(source).toContain('email.error = "delivery_not_started"');
    expect(source).toContain('telegram.error = "delivery_not_started"');
  });

  it.each(elevatedRoleFunctions)(
    "%s calls has_role_v2 with its deployed _role_code argument",
    (file) => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).toContain('"has_role_v2"');
      expect(source).toContain("_role_code:");
      expect(source).not.toMatch(/\b_role\s*:/);
    },
  );
});
