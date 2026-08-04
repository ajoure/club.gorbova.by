import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("access alias payment and auth wiring", () => {
  it.each([
    "supabase/functions/bepaid-create-token/index.ts",
    "supabase/functions/bepaid-create-subscription-checkout/index.ts",
    "supabase/functions/public-checkout/index.ts",
    "supabase/functions/public-charge-saved-card/index.ts",
    "supabase/functions/direct-charge/index.ts",
    "supabase/functions/_shared/create-payment-checkout.ts",
  ])("sanitizes provider return origin in %s", (file) => {
    const source = read(file);
    expect(source).toContain("resolvePublicReturnOrigin");
  });

  it("passes the sanitized request origin into Stripe checkout URL resolution", () => {
    const source = read("supabase/functions/_shared/create-stripe-checkout.ts");
    expect(source).toContain("request_origin: origin");
    expect(read("supabase/functions/_shared/public-app-host.ts"))
      .toContain("getAccessAliasOrigin(args.request_origin)");
  });

  it("preserves the access host in signed auth email links", () => {
    const source = read("supabase/functions/auth-email-hook/index.ts");
    expect(source).toContain("getAccessAliasOrigin(normalized.redirectTo)");
    expect(source).toContain("accessAliasOrigin || SITE_URL");
  });

  it.each([
    "supabase/functions/rr-fulfill-order/index.ts",
    "supabase/functions/submit-lead-request/index.ts",
    "supabase/functions/company-sync-admin/index.ts",
  ])("expands strict CORS origins in %s", (file) => {
    expect(read(file)).toContain("expandWithAccessAliasOrigins");
  });
});
