import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("payment log redaction", () => {
  it("does not log a saved-card token or full bePaid charge payload", () => {
    const directCharge = source("supabase/functions/direct-charge/index.ts");

    expect(directCharge).not.toContain("paymentMethod.provider_token.substring(0, 8)");
    expect(directCharge).not.toMatch(/console\.(log|error|warn)\([^\n]*JSON\.stringify\(chargePayload\)/);
    expect(directCharge).not.toMatch(/console\.(log|error|warn)\([^\n]*JSON\.stringify\(chargeResult\)/);
  });

  it("does not store or log tokenization checkout tokens", () => {
    const tokenize = source("supabase/functions/payment-methods-tokenize/index.ts");

    expect(tokenize).not.toMatch(/console\.(log|error|warn)\([^\n]*JSON\.stringify\(checkoutData\)/);
    expect(tokenize).not.toMatch(/console\.(log|error|warn)\([^\n]*JSON\.stringify\(result\)/);
    expect(tokenize).not.toContain("checkout_token: result.checkout?.token");
    expect(tokenize).toContain("checkout_token_present");
  });

  it("does not include unsubscribe tokens in error logs", () => {
    const unsubscribe = source("supabase/functions/handle-email-unsubscribe/index.ts");

    expect(unsubscribe).not.toContain("{ error: updateError, token }");
  });
});
